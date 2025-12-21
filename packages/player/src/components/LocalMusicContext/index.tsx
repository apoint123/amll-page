import type { LyricLine as CoreLyricLine } from "@applemusic-like-lyrics/core";
import {
	type LyricLine,
	parseEslrc,
	parseLrc,
	parseLys,
	parseQrc,
	parseYrc,
} from "@applemusic-like-lyrics/lyric";
import {
	AudioQualityType,
	fftDataRangeAtom,
	hideLyricViewAtom,
	isLyricPageOpenedAtom,
	type MusicQualityState,
	musicArtistsAtom,
	musicCoverAtom,
	musicDurationAtom,
	musicIdAtom,
	musicLyricLinesAtom,
	musicNameAtom,
	musicPlayingAtom,
	musicPlayingPositionAtom,
	musicQualityAtom,
	musicQualityTagAtom,
	musicVolumeAtom,
	onChangeVolumeAtom,
	onClickControlThumbAtom,
	onClickLeftFunctionButtonAtom,
	onClickRightFunctionButtonAtom,
	onLyricLineClickAtom,
	onPlayOrResumeAtom,
	onRequestNextSongAtom,
	onRequestOpenMenuAtom,
	onRequestPrevSongAtom,
	onSeekPositionAtom,
} from "@applemusic-like-lyrics/react-full";
import chalk from "chalk";
import { useLiveQuery } from "dexie-react-hooks";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { type FC, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { db } from "../../dexie.ts";
import {
	advanceLyricDynamicLyricTimeAtom,
	currentMusicIndexAtom,
	currentMusicQueueAtom,
	onRequestPlaySongByIndexAtom,
} from "../../states/appAtoms.ts";
import { extractMusicMetadata } from "../../utils/music-file.ts";
import { parseTTML } from "../../utils/parseTTML.ts";
import { mapMetadataToQuality } from "../../utils/quality.ts";
import { webPlayer } from "../../utils/web-player.ts";

export const FFTToLowPassContext: FC = () => {
	const fftDataRange = useAtomValue(fftDataRangeAtom);

	useEffect(() => {
		// This is a placeholder, as FFT is not implemented in WebPlayer yet.
	}, [fftDataRange]);

	return null;
};

type TransLine = {
	[K in keyof CoreLyricLine]: CoreLyricLine[K] extends string ? K : never;
}[keyof CoreLyricLine];

function pairLyric(line: LyricLine, lines: CoreLyricLine[], key: TransLine) {
	if (
		line.words
			.map((v) => v.word)
			.join("")
			.trim().length === 0
	)
		return;
	interface PairedLine {
		startTime: number;
		lineText: string;
		origIndex: number;
		original: CoreLyricLine;
	}
	const processed: PairedLine[] = lines.map((v, i) => ({
		startTime: Math.min(v.startTime, ...v.words.map((v) => v.startTime)),
		origIndex: i,
		lineText: v.words
			.map((v) => v.word)
			.join("")
			.trim(),
		original: v,
	}));
	let nearestLine: PairedLine | undefined;
	for (const coreLine of processed) {
		if (coreLine.lineText.length > 0) {
			if (coreLine.startTime === line.words[0].startTime) {
				nearestLine = coreLine;
				break;
			}
			if (
				nearestLine &&
				Math.abs(nearestLine.startTime - line.words[0].startTime) >
					Math.abs(coreLine.startTime - line.words[0].startTime)
			) {
				nearestLine = coreLine;
			} else if (nearestLine === undefined) {
				nearestLine = coreLine;
			}
		}
	}
	if (nearestLine) {
		const joined = line.words.map((w) => w.word).join("");
		if (nearestLine.original[key].length > 0)
			nearestLine.original[key] += joined;
		else nearestLine.original[key] = joined;
	}
}

const MusicQualityTagText: FC = () => {
	const { t } = useTranslation();
	const musicQuality = useAtomValue<MusicQualityState>(musicQualityAtom);
	const setMusicQualityTag = useSetAtom(musicQualityTagAtom);

	useLayoutEffect(() => {
		switch (musicQuality.type) {
			case AudioQualityType.None:
				return setMusicQualityTag(null);

			case AudioQualityType.Lossless:
				return setMusicQualityTag({
					tagIcon: true,
					tagText: t("amll.qualityTag.lossless", "无损"),
					isDolbyAtmos: false,
				});

			case AudioQualityType.HiResLossless:
				return setMusicQualityTag({
					tagIcon: true,
					tagText: t("amll.qualityTag.hires", "高解析度无损"),
					isDolbyAtmos: false,
				});

			case AudioQualityType.DolbyAtmos:
				return setMusicQualityTag({
					tagIcon: false,
					tagText: "",
					isDolbyAtmos: true,
				});

			default:
				return setMusicQualityTag(null);
		}
	}, [t, musicQuality, setMusicQualityTag]);

	return null;
};

const TTML_LOG_TAG = chalk.bgHex("#FF5577").hex("#FFFFFF")(" TTML DB ");
const LYRIC_LOG_TAG = chalk.bgHex("#FF4444").hex("#FFFFFF")(" LYRIC ");

interface GitHubContent {
	name: string;
	path: string;
	type: "file" | "dir";
	sha: string;
}

const LyricContext: FC = () => {
	const musicId = useAtomValue(musicIdAtom);
	const advanceLyricDynamicLyricTime = useAtomValue(
		advanceLyricDynamicLyricTimeAtom,
	);
	const setLyricLines = useSetAtom(musicLyricLinesAtom);
	const setHideLyricView = useSetAtom(hideLyricViewAtom);
	const song = useLiveQuery(() => db.songs.get(musicId), [musicId]);

	useEffect(() => {
		const sig = new AbortController();

		console.log(TTML_LOG_TAG, "同步 TTML DB 歌词库中");

		(async () => {
			const fileListRes = await fetch(
				"https://api.github.com/repos/Steve-xmh/amll-ttml-db/contents",
				{
					signal: sig.signal,
					redirect: "follow",
				},
			);

			if (fileListRes.status < 200 || fileListRes.status > 399) {
				console.warn(
					TTML_LOG_TAG,
					"TTML DB 歌词库同步失败：获取根目录文件列表失败",
					fileListRes.status,
					fileListRes.statusText,
				);
				return;
			}

			const fileList: GitHubContent[] = await fileListRes.json();
			const rawLyricsEntry = fileList.find(
				(v) => v.name === "raw-lyrics" && v.type === "dir",
			);

			if (!rawLyricsEntry) {
				console.warn(TTML_LOG_TAG, "未找到 raw-lyrics 目录");
				return;
			}
			console.log(
				TTML_LOG_TAG,
				"raw-lyric 目录已找到，SHA 为",
				rawLyricsEntry.sha,
			);

			const lyricFileListRes = await fetch(
				`https://api.github.com/repos/Steve-xmh/amll-ttml-db/git/trees/${rawLyricsEntry.sha}`,
				{
					signal: sig.signal,
					redirect: "follow",
				},
			);

			if (lyricFileListRes.status < 200 || lyricFileListRes.status > 399) {
				console.warn(
					TTML_LOG_TAG,
					"TTML DB 歌词库同步失败：获取 raw-lyrics 文件夹下的文件列表失败",
					lyricFileListRes.status,
					lyricFileListRes.statusText,
				);
				return;
			}

			const lyricFileList: { tree: GitHubContent[] } =
				await lyricFileListRes.json();

			const fileMap = Object.fromEntries(
				lyricFileList.tree.map((v) => [v.path, v]),
			);
			console.log(fileMap);

			const localFileList = new Set<string>();
			const remoteFileList = new Set<string>(
				lyricFileList.tree.map((v) => v.path),
			);

			await db.ttmlDB.each((obj) => {
				localFileList.add(obj.name);
			});

			console.log(TTML_LOG_TAG, "本地已同步歌词数量", localFileList.size);
			console.log(TTML_LOG_TAG, "远程仓库歌词数量", remoteFileList.size);

			const shouldFetchList = remoteFileList.difference(localFileList);

			console.log(
				TTML_LOG_TAG,
				"需要下载的歌词数量",
				shouldFetchList.size,
				shouldFetchList,
			);

			let synced = 0;
			let errored = 0;

			const fetchTasks = [];

			// Safari 目前不支持对迭代器对象使用 map 方法
			for (const fileName of shouldFetchList.keys()) {
				if (!(fileName in fileMap)) continue;
				fetchTasks.push(
					(async () => {
						const lyricRes = await fetch(
							`https://raw.githubusercontent.com/Steve-xmh/amll-ttml-db/main/raw-lyrics/${fileMap[fileName].path}`,
							{
								signal: sig.signal,
								redirect: "follow",
							},
						);

						if (fileListRes.status < 200 || fileListRes.status > 399) {
							console.warn(
								"同步歌词文件",
								fileName,
								"失败",
								fileListRes.status,
								fileListRes.statusText,
							);
							errored++;
							return;
						}

						const lyricContent = await lyricRes.text();

						try {
							const ttml = parseTTML(lyricContent);
							db.ttmlDB.add({
								name: fileName,
								content: ttml,
								raw: lyricContent,
							});
							synced++;
						} catch (err) {
							console.warn("下载并解析歌词文件", fileName, "失败", err);
							errored++;
						}
					})(),
				);
			}

			await Promise.all(fetchTasks);

			console.log(
				TTML_LOG_TAG,
				"歌词同步完成，已同步 ",
				synced,
				" 首歌曲，有 ",
				errored,
				" 首歌词导入失败",
			);
		})();

		return () => {
			sig.abort("useEffect Cleared");
		};
	}, []);

	useEffect(() => {
		if (song) {
			try {
				let parsedLyricLines: LyricLine[] = [];
				switch (song.lyricFormat) {
					case "lrc": {
						parsedLyricLines = parseLrc(song.lyric);
						console.log(LYRIC_LOG_TAG, "解析出 LyRiC 歌词", parsedLyricLines);
						break;
					}
					case "eslrc": {
						parsedLyricLines = parseEslrc(song.lyric);
						console.log(LYRIC_LOG_TAG, "解析出 ESLyRiC 歌词", parsedLyricLines);
						break;
					}
					case "yrc": {
						parsedLyricLines = parseYrc(song.lyric);
						console.log(LYRIC_LOG_TAG, "解析出 YRC 歌词", parsedLyricLines);
						break;
					}
					case "qrc": {
						parsedLyricLines = parseQrc(song.lyric);
						console.log(LYRIC_LOG_TAG, "解析出 QRC 歌词", parsedLyricLines);
						break;
					}
					case "lys": {
						parsedLyricLines = parseLys(song.lyric);
						console.log(
							LYRIC_LOG_TAG,
							"解析出 Lyricify Syllable 歌词",
							parsedLyricLines,
						);
						break;
					}
					case "ttml": {
						parsedLyricLines = parseTTML(song.lyric).lines;
						console.log(LYRIC_LOG_TAG, "解析出 TTML 歌词", parsedLyricLines);
						break;
					}
					default: {
						setLyricLines([]);
						setHideLyricView(true);
						return;
					}
				}
				const compatibleLyricLines: CoreLyricLine[] = parsedLyricLines.map(
					(line) => ({
						...line,
						words: line.words.map((word) => ({
							...word,
							obscene: false,
						})),
					}),
				);
				if (song.translatedLrc) {
					try {
						const translatedLyricLines = parseLrc(song.translatedLrc);
						for (const line of translatedLyricLines) {
							pairLyric(
								{
									...line,
									words: line.words.map((word) => ({
										...word,
										obscene: false,
									})),
								},
								compatibleLyricLines,
								"translatedLyric",
							);
						}
						console.log(LYRIC_LOG_TAG, "已匹配翻译歌词");
					} catch (err) {
						console.warn(LYRIC_LOG_TAG, "解析翻译歌词时出现错误", err);
					}
				}
				if (song.romanLrc) {
					try {
						const romanLyricLines = parseLrc(song.romanLrc);
						for (const line of romanLyricLines) {
							pairLyric(
								{
									...line,
									words: line.words.map((word) => ({
										...word,
										obscene: false,
									})),
								},
								compatibleLyricLines,
								"romanLyric",
							);
						}
						console.log(LYRIC_LOG_TAG, "已匹配音译歌词");
					} catch (err) {
						console.warn(LYRIC_LOG_TAG, "解析音译歌词时出现错误", err);
					}
				}
				const processedLines: CoreLyricLine[] = compatibleLyricLines;
				if (advanceLyricDynamicLyricTime) {
					for (const line of processedLines) {
						line.startTime = Math.max(0, line.startTime - 400);
						line.endTime = Math.max(0, line.endTime - 400);
					}
				}
				setLyricLines(processedLines);
				setHideLyricView(processedLines.length === 0);
			} catch (e) {
				console.warn("解析歌词时出现错误", e);
				setLyricLines([]);
				setHideLyricView(true);
			}
		} else {
			setLyricLines([]);
			setHideLyricView(true);
		}
	}, [song, advanceLyricDynamicLyricTime, setLyricLines, setHideLyricView]);

	return null;
};

export const LocalMusicContext: FC = () => {
	const store = useStore();
	const { t } = useTranslation();
	const [musicPlaying, setMusicPlaying] = useAtom(musicPlayingAtom);

	useEffect(() => {
		const toEmit = <T,>(onEmit: T) => ({ onEmit });

		const playSongByIndex = async (index: number) => {
			const queue = store.get(currentMusicQueueAtom);
			if (!queue || queue.length === 0) return;

			let targetIndex = index;
			if (targetIndex >= queue.length) targetIndex = 0;
			if (targetIndex < 0) targetIndex = queue.length - 1;

			const songId = queue[targetIndex];
			const song = await db.songs.get(songId);

			if (!song || !(song.file instanceof Blob)) {
				toast.error("无法播放，找不到歌曲文件。");
				return;
			}

			try {
				const { metadata } = await extractMusicMetadata(song.file);
				const qualityState = mapMetadataToQuality(metadata);

				store.set(musicQualityAtom, qualityState);

				console.log("音频质量", qualityState);
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

			store.set(musicNameAtom, song.songName);
			store.set(
				musicArtistsAtom,
				song.songArtists.split(",").map((v) => ({ name: v, id: v })),
			);
			store.set(musicCoverAtom, URL.createObjectURL(song.cover));
			store.set(musicIdAtom, song.id);
			store.set(currentMusicIndexAtom, targetIndex);

			const file = new File([song.file], song.filePath, {
				type: song.file.type,
			});
			await webPlayer.load(file);
			await webPlayer.play();
			store.set(musicPlayingAtom, true);
		};

		const playNext = () => {
			const currentIndex = store.get(currentMusicIndexAtom);
			playSongByIndex(currentIndex + 1);
		};

		const playPrev = () => {
			const currentIndex = store.get(currentMusicIndexAtom);
			playSongByIndex(currentIndex - 1);
		};

		store.set(
			onPlayOrResumeAtom,
			toEmit(() => {
				if (musicPlaying) {
					webPlayer.pause();
				} else {
					webPlayer.play();
				}
			}),
		);

		store.set(onRequestNextSongAtom, toEmit(playNext));
		store.set(onRequestPrevSongAtom, toEmit(playPrev));

		store.set(
			onClickControlThumbAtom,
			toEmit(() => {
				store.set(isLyricPageOpenedAtom, false);
			}),
		);
		store.set(
			onSeekPositionAtom,
			toEmit((time: number) => {
				webPlayer.seek(time / 1000);
			}),
		);
		store.set(
			onLyricLineClickAtom,
			toEmit((evt) => {
				webPlayer.seek(evt.line.getLine().startTime / 1000);
			}),
		);
		store.set(
			onChangeVolumeAtom,
			toEmit((volume: number) => {
				webPlayer.setVolume(volume);
			}),
		);
		store.set(
			onRequestPlaySongByIndexAtom,
			toEmit((index: number) => {
				playSongByIndex(index);
			}),
		);
		store.set(
			onRequestOpenMenuAtom,
			toEmit(() => {
				toast.info(
					t("amll.openMenuViaRightClick", "请右键歌词页任意位置来打开菜单哦！"),
				);
			}),
		);
		store.set(
			onClickLeftFunctionButtonAtom,
			toEmit(() => {
				toast.info(
					t("amll.buttonForDisplayOnly", "此按钮仅供展示用途，暂无实际功能"),
				);
			}),
		);
		store.set(
			onClickRightFunctionButtonAtom,
			toEmit(() => {
				toast.info(
					t("amll.buttonForDisplayOnly", "此按钮仅供展示用途，暂无实际功能"),
				);
			}),
		);

		const handleLoaded = async () => {
			const durationSec = webPlayer.duration;
			const durationMs = (durationSec * 1000) | 0;

			if (Number.isFinite(durationSec)) {
				store.set(musicDurationAtom, durationMs);

				const currentMusicId = store.get(musicIdAtom);
				if (currentMusicId) {
					try {
						await db.songs.update(currentMusicId, { duration: durationSec });
					} catch (e) {
						console.warn("更新歌曲时长失败", e);
					}
				}
			}
		};

		const handlePlay = () => {
			setMusicPlaying(true);
			startRafLoop();
		};

		const handlePause = () => {
			setMusicPlaying(false);
			stopRafLoop();
		};

		const handleEnded = () => {
			playNext();
		};

		const handleVolumeChange = (e: CustomEvent<number>) => {
			store.set(musicVolumeAtom, e.detail);
		};

		let rafId: number;

		const updatePositionLoop = () => {
			const currentTime = webPlayer.currentTime;
			store.set(musicPlayingPositionAtom, (currentTime * 1000) | 0);
			rafId = requestAnimationFrame(updatePositionLoop);
		};

		const startRafLoop = () => {
			cancelAnimationFrame(rafId);
			updatePositionLoop();
		};

		const stopRafLoop = () => {
			cancelAnimationFrame(rafId);
		};

		webPlayer.addEventListener("play", handlePlay);
		webPlayer.addEventListener("pause", handlePause);
		webPlayer.addEventListener("ended", handleEnded);
		webPlayer.addEventListener("volumechange", handleVolumeChange);
		webPlayer.addEventListener("loaded", handleLoaded);

		if (!webPlayer.getInternalSourceNode().mediaElement.paused) {
			startRafLoop();
		}

		return () => {
			stopRafLoop();
			webPlayer.removeEventListener("play", handlePlay);
			webPlayer.removeEventListener("pause", handlePause);
			webPlayer.removeEventListener("ended", handleEnded);
			webPlayer.removeEventListener("volumechange", handleVolumeChange);
			webPlayer.removeEventListener("loaded", handleLoaded);

			const doNothing = toEmit(() => {});
			store.set(onRequestNextSongAtom, doNothing);
			store.set(onRequestPrevSongAtom, doNothing);
			store.set(onPlayOrResumeAtom, doNothing);
			store.set(onClickControlThumbAtom, doNothing);
			store.set(onSeekPositionAtom, doNothing);
			store.set(onLyricLineClickAtom, doNothing);
			store.set(onChangeVolumeAtom, doNothing);
			store.set(onRequestPlaySongByIndexAtom, doNothing);
			store.set(onRequestOpenMenuAtom, doNothing);
			store.set(onClickLeftFunctionButtonAtom, doNothing);
			store.set(onClickRightFunctionButtonAtom, doNothing);
		};
	}, [store, t, musicPlaying, setMusicPlaying]);

	return (
		<>
			<LyricContext />
			<FFTToLowPassContext />
			<MusicQualityTagText />
		</>
	);
};
