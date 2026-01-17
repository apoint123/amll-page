import {
	AUDIT_PLAYLIST_ID,
	db,
	type Playlist,
	type Song,
} from "../../../dexie";
import { extractMusicMetadata } from "../../../utils/music-file";
import { parseTTML } from "../../../utils/parseTTML";
import {
	type AudioSourceType,
	fetchAudioSource,
	type StandardMetadata,
} from "./music-provider";

const MAX_AUDIT_CACHE_SIZE = 20;

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export interface GitHubPR {
	id: number;
	number: number;
	title: string;
	state: string;
	created_at: string;
	user: {
		login: string;
	};
	head: {
		sha: string;
	};
	body: string;
	html_url: string;
	labels: {
		id: number;
		name: string;
		color: string;
		description: string;
	}[];
}

interface GitHubFile {
	filename: string;
	raw_url: string;
	status: string;
}

export class AuditService {
	private token: string;
	private owner: string;
	private repo: string;

	constructor(token: string, owner: string, repo: string) {
		this.token = token;
		this.owner = owner;
		this.repo = repo;
	}

	private get authHeaders(): Record<string, string> {
		const headers: Record<string, string> = {};
		if (this.token) {
			headers.Authorization = `token ${this.token}`;
		}
		return headers;
	}

	private ensureAuthenticated() {
		if (!this.token) {
			throw new Error("此操作需要 GitHub Token，请在设置中配置。");
		}
	}

	get repoUrl(): string {
		return `https://github.com/${this.owner}/${this.repo}`;
	}

	async fetchPullRequests(page: number = 1): Promise<GitHubPR[]> {
		const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls?state=open&sort=created&direction=desc&page=${page}&per_page=30`;

		const res = await fetch(url, {
			headers: this.authHeaders,
			cache: "no-store",
		});

		if (!res.ok) throw new Error(`GitHub API Error: ${res.statusText}`);
		return await res.json();
	}

	async fetchPRFiles(prNumber: number): Promise<GitHubFile[]> {
		const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${prNumber}/files`;
		const res = await fetch(url, {
			headers: this.authHeaders,
			cache: "no-store",
		});
		if (!res.ok) throw new Error(`GitHub API Error: ${res.statusText}`);
		return await res.json();
	}

	async fetchOpenPRCount(): Promise<number> {
		const query = `repo:${this.owner}/${this.repo} is:pr is:open`;
		const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
		const res = await fetch(url, { headers: this.authHeaders });
		if (!res.ok) return 0;
		const data = await res.json();
		return data.total_count;
	}

	async processPR(pr: GitHubPR): Promise<string> {
		const existingMeta = await db.auditMetadata
			.where({ prId: pr.number })
			.first();
		if (existingMeta && existingMeta.prHeadSha === pr.head.sha) {
			await this.addToAuditPlaylist(existingMeta.songId);
			await this.touchSong(existingMeta.songId);
			return existingMeta.songId;
		}

		const files = await this.fetchPRFiles(pr.number);
		const ttmlFile = files.find((f) => f.filename.endsWith(".ttml"));

		if (!ttmlFile) {
			throw new Error("该 PR 中未找到 TTML 文件");
		}

		const contentUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${ttmlFile.filename}?ref=${pr.head.sha}`;

		const ttmlContent = await this.fetchAndDecodeFile(contentUrl);

		const candidateIds = this.extractNeteaseIds(ttmlContent);

		return await this.registerAuditSong(
			pr,
			ttmlContent,
			ttmlFile.filename,
			candidateIds,
		);
	}

	private async enforceCacheLimit() {
		const allKeys = await db.songs.orderBy("accessTime").primaryKeys();

		const auditKeys = allKeys.filter(
			(k) => typeof k === "string" && k.startsWith("audit-"),
		);

		const excessCount = auditKeys.length - MAX_AUDIT_CACHE_SIZE;

		if (excessCount > 0) {
			const keysToDelete = auditKeys.slice(0, excessCount + 1);

			console.log(`清理 ${keysToDelete.length} 首歌曲`);

			await db.transaction(
				"rw",
				db.songs,
				db.auditMetadata,
				db.playlists,
				async () => {
					await db.songs.bulkDelete(keysToDelete);
					await db.auditMetadata.where("songId").anyOf(keysToDelete).delete();
					const playlist = await db.playlists.get(AUDIT_PLAYLIST_ID);
					if (playlist) {
						playlist.songIds = playlist.songIds.filter(
							(id) => !keysToDelete.includes(id),
						);
						await db.playlists.put(playlist);
					}
				},
			);
		}
	}

	async touchSong(songId: string) {
		try {
			await db.songs.update(songId, {
				accessTime: Date.now(),
			});
		} catch (e) {
			console.warn("更新歌曲访问时间失败", e);
		}
	}

	async fetchAndBindAudio(
		oldSongId: string,
		platformId: string,
		source: AudioSourceType = "TOUBIEC",
	): Promise<string> {
		await this.enforceCacheLimit();

		const newSongId = `audit-netease-${platformId}`;

		const existingSong = await db.songs.get(newSongId);

		if (existingSong?.file && existingSong.file.size > 0) {
			console.log(`命中缓存: ${newSongId}`);
			await this.touchSong(newSongId);
		} else {
			const sourceResult = await fetchAudioSource(platformId, source);

			const finalMetadata: StandardMetadata = {
				name: sourceResult.metadata?.name || "Unknown Title",
				artist: sourceResult.metadata?.artist || "Unknown Artist",
				album: sourceResult.metadata?.album || "Unknown Album",
				coverUrl: sourceResult.metadata?.coverUrl || "",
			};

			const downloadPromises: Promise<Blob>[] = [
				fetch(sourceResult.audioUrl).then((r) => r.blob()),
			];

			if (finalMetadata.coverUrl) {
				downloadPromises.push(
					fetch(finalMetadata.coverUrl).then((r) => r.blob()),
				);
			} else {
				downloadPromises.push(Promise.resolve(new Blob()));
			}

			const [audioBlob, coverBlob] = await Promise.all(downloadPromises);

			const oldSong = await db.songs.get(oldSongId);
			if (!oldSong) throw new Error("Base song not found");

			const newSong: Song = {
				...oldSong,
				id: newSongId,
				songName: finalMetadata.name,
				songArtists: finalMetadata.artist,
				songAlbum: finalMetadata.album,
				cover: coverBlob,
				file: audioBlob,
				accessTime: Date.now(),
			};

			await db.songs.put(newSong);
		}

		await db.transaction("rw", db.auditMetadata, db.playlists, async () => {
			const oldMeta = await db.auditMetadata.get(oldSongId);
			if (oldMeta) {
				await db.auditMetadata.delete(oldSongId);
				await db.auditMetadata.put({
					...oldMeta,
					songId: newSongId,
					platformId: platformId,
				});
			}

			await this.addToAuditPlaylist(newSongId);
		});

		return newSongId;
	}

	private extractNeteaseIds(ttml: string): string[] {
		try {
			const ttmlResult = parseTTML(ttml);

			const ncmMeta = ttmlResult.metadata.find(([key]) => key === "ncmMusicId");

			return ncmMeta ? ncmMeta[1] : [];
		} catch (error) {
			console.error("TTML 解析失败:", error);
			return [];
		}
	}

	async fetchPRTtml(
		pr: GitHubPR,
	): Promise<{ content: string; filename: string; rawUrl: string }> {
		const files = await this.fetchPRFiles(pr.number);
		const ttmlFile = files.find(
			(f) => f.filename.endsWith(".ttml") || f.filename.endsWith(".tm"),
		);

		if (!ttmlFile) {
			throw new Error("该 PR 中未找到 TTML 文件");
		}

		const contentUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${ttmlFile.filename}?ref=${pr.head.sha}`;

		const ttmlContent = await this.fetchAndDecodeFile(contentUrl);

		return {
			content: ttmlContent,
			filename: ttmlFile.filename,
			rawUrl: ttmlFile.raw_url || contentUrl,
		};
	}

	private async registerAuditSong(
		pr: GitHubPR,
		ttmlContent: string,
		filename: string,
		candidateIds: string[],
	): Promise<string> {
		await this.enforceCacheLimit();

		const primaryId =
			candidateIds.length > 0 ? candidateIds[0] : `manual-pr-${pr.number}`;

		const songId = `audit-netease-${primaryId}`;

		const now = Date.now();

		const song: Song = {
			id: songId,
			filePath: `audit/${pr.number}/${filename}`,
			songName: `PR #${pr.number}: ${pr.title}`,
			songArtists: pr.user.login,
			songAlbum: "Audit Queue",
			cover: new Blob(),
			file: new Blob(),
			duration: 0,
			lyricFormat: "ttml",
			lyric: ttmlContent,
			translatedLrc: "",
			romanLrc: "",
			addTime: now,
			accessTime: now,
		};

		await db.auditMetadata.where({ prId: pr.number }).delete();

		await db.songs.put(song);

		await db.auditMetadata.put({
			songId,
			prId: pr.number,
			prNumber: pr.number,
			prTitle: pr.title,
			prAuthor: pr.user.login,
			prHeadSha: pr.head.sha,
			platformId: undefined,
			candidateIds: candidateIds,
			status: "pending",
			rawTtmlUrl: `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${pr.head.sha}/${filename}`,
		});

		await this.addToAuditPlaylist(songId);

		return songId;
	}

	async submitReview(prNumber: number, event: ReviewEvent, body: string = "") {
		this.ensureAuthenticated();
		const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews`;

		const res = await fetch(url, {
			method: "POST",
			headers: {
				...this.authHeaders,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ event, body }),
		});

		if (!res.ok) {
			const err = await res.json();
			throw new Error(err.message || `Review failed: ${res.statusText}`);
		}

		return res.json();
	}

	async mergePullRequest(
		prNumber: number,
		method: "merge" | "squash" | "rebase" = "squash",
	) {
		this.ensureAuthenticated();
		const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${prNumber}/merge`;

		const res = await fetch(url, {
			method: "PUT",
			headers: {
				...this.authHeaders,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				merge_method: method,
				commit_title: `Merge pull request #${prNumber}`,
			}),
		});

		if (!res.ok) {
			const err = await res.json();
			throw new Error(err.message || `Merge failed: ${res.statusText}`);
		}

		return res.json();
	}

	async linkLocalFile(songId: string, file: File) {
		const existSong = await db.songs.get(songId);
		if (!existSong) throw new Error("Song entry not found");

		const extracted = await extractMusicMetadata(file);

		await db.songs.update(songId, {
			file: file,
			songName: extracted.title || file.name,
			songArtists: extracted.artist,
			songAlbum: extracted.album,
			cover: extracted.cover,
			duration: extracted.duration,
			accessTime: Date.now(),
		});

		await db.auditMetadata.update(songId, {
			platformId: "manual",
		});

		await this.addToAuditPlaylist(songId);
	}

	private async addToAuditPlaylist(songId: string) {
		await db.transaction("rw", db.playlists, async () => {
			let playlist = await db.playlists.get(AUDIT_PLAYLIST_ID);

			if (!playlist) {
				playlist = {
					id: AUDIT_PLAYLIST_ID,
					name: "Audit Queue",
					createTime: Date.now(),
					updateTime: Date.now(),
					playTime: 0,
					songIds: [],
				} as Playlist;
				await db.playlists.add(playlist);
			}

			if (!playlist.songIds.includes(songId)) {
				playlist.songIds.push(songId);
				await db.playlists.put(playlist);
			}
		});
	}

	private async fetchAndDecodeFile(url: string): Promise<string> {
		const res = await fetch(url, { headers: this.authHeaders });

		if (!res.ok) {
			throw new Error(`无法获取文件内容: ${res.statusText}`);
		}

		const json = await res.json();
		const base64Content = json.content.replace(/\n/g, "");

		const binaryString = window.atob(base64Content);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return new TextDecoder("utf-8").decode(bytes);
	}
}
