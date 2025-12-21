import {
	AudioQualityType,
	isLyricPageOpenedAtom,
	musicArtistsAtom,
	musicCoverAtom,
	musicIdAtom,
	musicNameAtom,
	musicPlayingAtom,
	musicQualityAtom,
} from "@applemusic-like-lyrics/react-full";
import { useSetAtom, useStore } from "jotai";
import { type FC, useEffect, useRef } from "react";
import { toast } from "react-toastify";
import { db } from "../../dexie.ts";
import {
	currentMusicIndexAtom,
	currentMusicQueueAtom,
} from "../../states/appAtoms.ts";
import { extractMusicMetadata } from "../../utils/music-file.ts";
import { mapMetadataToQuality } from "../../utils/quality.ts";
import {
	hasURLParams,
	loadFileFromURL,
	parseURLParams,
} from "../../utils/url-params.ts";
import { webPlayer } from "../../utils/web-player.ts";

/**
 * 根据URL或内容检测歌词格式
 */
function detectLyricFormat(url: string, content: string): string {
	// 根据URL扩展名判断
	const urlLower = url.toLowerCase();
	if (urlLower.endsWith(".ttml")) {
		return "ttml";
	}
	if (urlLower.endsWith(".lrc")) {
		return "lrc";
	}
	if (urlLower.endsWith(".yrc")) {
		return "yrc";
	}
	if (urlLower.endsWith(".qrc")) {
		return "qrc";
	}
	if (urlLower.endsWith(".lys")) {
		return "lys";
	}

	// 根据内容判断
	const contentTrimmed = content.trim();
	if (contentTrimmed.startsWith("<?xml") || contentTrimmed.includes("<tt")) {
		return "ttml";
	}
	if (contentTrimmed.includes("[") && contentTrimmed.includes("]")) {
		// 可能是LRC格式
		return "lrc";
	}

	// 默认返回lrc
	return "lrc";
}

/**
 * URL参数处理器组件
 * 处理URL参数，创建/更新歌曲，并打开歌词页面
 */
export const URLParamsHandler: FC = () => {
	const store = useStore();
	const setLyricPageOpened = useSetAtom(isLyricPageOpenedAtom);
	const processedRef = useRef(false);

	useEffect(() => {
		// 只处理一次
		if (processedRef.current) return;
		if (!hasURLParams()) return;

		processedRef.current = true;

		const handleURLParams = async () => {
			try {
				const params = parseURLParams();

				// 必须有音乐链接
				if (!params.music) {
					console.warn("URL参数中缺少music参数");
					return;
				}

				// 生成歌曲ID（基于音乐URL的hash）
				const musicUrlHash = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(params.music),
				);
				const hashArray = Array.from(new Uint8Array(musicUrlHash));
				const hashHex = hashArray
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
				const songId = `url-${hashHex.substring(0, 16)}`;

				// 加载音乐文件
				toast.info("正在加载音乐文件...");
				const musicBlob = await loadFileFromURL(params.music);

				// 加载封面文件（如果有）
				let coverBlob = new Blob([], { type: "image/png" });
				if (params.cover) {
					try {
						coverBlob = await loadFileFromURL(params.cover);
					} catch (e) {
						console.warn("加载封面失败", e);
					}
				}

				// 加载歌词文件（如果有）
				let lyricContent = "";
				let lyricFormat = "none";
				if (params.lyric) {
					try {
						const lyricBlob = await loadFileFromURL(params.lyric);
						lyricContent = await lyricBlob.text();
						lyricFormat = detectLyricFormat(params.lyric, lyricContent);
					} catch (e) {
						console.warn("加载歌词失败", e);
					}
				}

				// 提取音乐元数据
				let extractedMetadata;
				try {
					extractedMetadata = await extractMusicMetadata(musicBlob);
				} catch (e) {
					console.warn("提取音乐元数据失败", e);
					extractedMetadata = {
						title: "",
						artist: "Unknown Artist",
						album: "Unknown Album",
						cover: coverBlob,
						lyric: "",
						duration: 0,
						metadata: {} as any,
					};
				}

				// 使用URL参数中的信息覆盖元数据
				const songName =
					params.title || extractedMetadata.title || "Unknown Title";
				const songArtists =
					params.artist || extractedMetadata.artist || "Unknown Artist";
				const songAlbum = extractedMetadata.album || "Unknown Album";
				const finalCover =
					coverBlob.size > 0 ? coverBlob : extractedMetadata.cover;
				const finalDuration = extractedMetadata.duration || 0;

				// 如果URL参数中有歌词，使用URL参数中的歌词
				if (params.lyric && lyricContent) {
					// 使用从URL加载的歌词
				} else if (extractedMetadata.lyric) {
					// 使用从音乐文件提取的歌词
					lyricContent = extractedMetadata.lyric;
					lyricFormat = "lrc";
				}

				// 创建或更新歌曲
				const song = {
					id: songId,
					filePath: params.music,
					songName,
					songArtists,
					songAlbum,
					cover: finalCover,
					file: musicBlob,
					duration: finalDuration,
					lyricFormat,
					lyric: lyricContent,
					translatedLrc: "",
					romanLrc: "",
				};

				await db.songs.put(song);

				// 设置播放器状态
				try {
					const { metadata } = await extractMusicMetadata(musicBlob);
					const qualityState = mapMetadataToQuality(metadata);
					store.set(musicQualityAtom, qualityState);
				} catch (e) {
					console.warn("解析音频质量失败", e);
					store.set(musicQualityAtom, {
						type: AudioQualityType.None,
						codec: "Unknown",
						channels: 2,
						sampleRate: 44100,
						sampleFormat: "16-bit",
					});
				}

				store.set(musicNameAtom, songName);
				store.set(
					musicArtistsAtom,
					songArtists.split(",").map((v) => ({ name: v.trim(), id: v.trim() })),
				);
				store.set(musicCoverAtom, URL.createObjectURL(finalCover));
				store.set(musicIdAtom, songId);

				// 设置播放队列
				store.set(currentMusicQueueAtom, [songId]);
				store.set(currentMusicIndexAtom, 0);

				// 加载并播放音乐
				const file = new File(
					[musicBlob],
					params.music.split("/").pop() || "music",
					{
						type: musicBlob.type || "audio/mpeg",
					},
				);
				await webPlayer.load(file);
				await webPlayer.play();
				store.set(musicPlayingAtom, true);

				// 打开歌词页面
				setLyricPageOpened(true);

				toast.success("音乐加载成功！");

				// 清除URL参数（可选）
				// window.history.replaceState({}, "", window.location.pathname);
			} catch (error) {
				console.error("处理URL参数失败", error);
				toast.error(
					`加载失败: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		};

		handleURLParams();
	}, [store, setLyricPageOpened]);

	return null;
};
