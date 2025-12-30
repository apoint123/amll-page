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
	isShuffleActiveAtom,
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
	onCycleRepeatModeAtom,
	onLyricLineClickAtom,
	onPlayOrResumeAtom,
	onRequestNextSongAtom,
	onRequestOpenMenuAtom,
	onRequestPrevSongAtom,
	onSeekPositionAtom,
	onToggleShuffleAtom,
	originalQueueAtom,
	RepeatMode,
	repeatModeAtom,
} from "@applemusic-like-lyrics/react-full";
import chalk from "chalk";
import { useLiveQuery } from "dexie-react-hooks";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { type FC, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { db } from "../../dexie.ts";
import { useMediaSession } from "../../hooks/useMediaSession.ts";
import {
	advanceLyricDynamicLyricTimeAtom,
	currentMusicIndexAtom,
	currentMusicQueueAtom,
	onRequestPlaySongByIndexAtom,
} from "../../states/appAtoms.ts";
import {
	SyncStatus,
	syncLyricsDatabase,
} from "../../utils/lyric-sync-manager.ts";
import { extractMusicMetadata } from "../../utils/music-file.ts";
import { parseTTML } from "../../utils/parseTTML.ts";
import { mapMetadataToQuality } from "../../utils/quality.ts";
import { webPlayer } from "../../utils/web-player.ts";

function shuffleArray<T>(array: T[]): T[] {
	const arr = [...array];
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

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

const LYRIC_LOG_TAG = chalk.bgHex("#FF4444").hex("#FFFFFF")(" LYRIC ");

const LyricContext: FC = () => {
	const musicId = useAtomValue(musicIdAtom);
	const advanceLyricDynamicLyricTime = useAtomValue(
		advanceLyricDynamicLyricTimeAtom,
	);
	const setLyricLines = useSetAtom(musicLyricLinesAtom);
	const setHideLyricView = useSetAtom(hideLyricViewAtom);
	const song = useLiveQuery(
		() => (musicId ? db.songs.get(musicId) : undefined),
		[musicId],
	);
	const store = useStore();

	useEffect(() => {
		syncLyricsDatabase(store).then((result) => {
			switch (result.status) {
				case SyncStatus.Updated:
					console.log(
						LYRIC_LOG_TAG,
						`歌词库更新完成，新增 ${result.count} 个歌词`,
					);
					break;
				// case SyncStatus.Skipped:
				// 	console.log(LYRIC_LOG_TAG, "歌词库已是最新");
				// 	break;
				// case SyncStatus.Failed:
				// 	console.warn(LYRIC_LOG_TAG, "歌词库同步失败", result.error);
				// 	break;
				// case SyncStatus.Empty:
				// 	console.log(LYRIC_LOG_TAG, "远程歌词库为空");
				// 	break;
			}
		});
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
	const [, setOriginalQueue] = useAtom(originalQueueAtom);

	const savedMusicId = useAtomValue(musicIdAtom);
	const savedPosition = useAtomValue(musicPlayingPositionAtom);
	const savedVolume = useAtomValue(musicVolumeAtom);
	const [hasRestored, setHasRestored] = useState(false);

	useMediaSession();

	useEffect(() => {
		webPlayer.setVolume(savedVolume);
	}, [savedVolume]);

	useEffect(() => {
		if (hasRestored) return;

		const restorePlaybackState = async () => {
			if (savedMusicId) {
				const song = await db.songs.get(savedMusicId);
				if (song && song.file instanceof Blob) {
					try {
						const file = new File([song.file], song.filePath, {
							type: song.file.type,
						});

						store.set(musicNameAtom, song.songName);
						store.set(
							musicArtistsAtom,
							song.songArtists.split(",").map((v) => ({ name: v, id: v })),
						);

						const oldCover = store.get(musicCoverAtom);
						if (oldCover?.startsWith("blob:")) {
							URL.revokeObjectURL(oldCover);
						}

						store.set(musicCoverAtom, URL.createObjectURL(song.cover));
						store.set(musicDurationAtom, (song.duration || 0) * 1000);

						await webPlayer.load(file);

						if (savedPosition > 0) {
							webPlayer.seek(savedPosition / 1000);
						}

						store.set(musicPlayingAtom, false);
					} catch (e) {
						console.warn("恢复播放状态失败:", e);
					}
				}
			}
		};

		if (savedPosition) {
			restorePlaybackState();
			setHasRestored(true);
		} else {
			const timer = setTimeout(() => {
				setHasRestored(true);
			}, 500);
			return () => clearTimeout(timer);
		}
	}, [savedMusicId, savedPosition, hasRestored, store]);

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

			const currentCover = store.get(musicCoverAtom);
			if (currentCover?.startsWith("blob:")) {
				URL.revokeObjectURL(currentCover);
			}

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

		const playNextManual = () => {
			const currentIndex = store.get(currentMusicIndexAtom);
			playSongByIndex(currentIndex + 1);
		};

		const playPrevManual = () => {
			const currentIndex = store.get(currentMusicIndexAtom);
			playSongByIndex(currentIndex - 1);
		};

		const handleEnded = () => {
			const repeatMode = store.get(repeatModeAtom);
			const currentIndex = store.get(currentMusicIndexAtom);
			const queue = store.get(currentMusicQueueAtom);

			if (repeatMode === RepeatMode.One) {
				playSongByIndex(currentIndex);
			} else if (repeatMode === RepeatMode.All) {
				playSongByIndex(currentIndex + 1);
			} else {
				if (currentIndex < queue.length - 1) {
					playSongByIndex(currentIndex + 1);
				} else {
					setMusicPlaying(false);
					store.set(musicPlayingAtom, false);
					webPlayer.seek(0);
					store.set(musicPlayingPositionAtom, 0);
				}
			}
		};

		store.set(
			onToggleShuffleAtom,
			toEmit(() => {
				const isShuffle = store.get(isShuffleActiveAtom);
				const nextShuffleState = !isShuffle;

				const currentQueue = store.get(currentMusicQueueAtom);
				const currentSongId = store.get(musicIdAtom);

				if (nextShuffleState) {
					setOriginalQueue([...currentQueue]);

					const shuffledQueue = shuffleArray(currentQueue);
					store.set(currentMusicQueueAtom, shuffledQueue);

					if (currentSongId) {
						const newIndex = shuffledQueue.indexOf(currentSongId);
						if (newIndex !== -1) store.set(currentMusicIndexAtom, newIndex);
					}
				} else {
					const savedOriginalQueue = store.get(originalQueueAtom);

					if (savedOriginalQueue) {
						store.set(currentMusicQueueAtom, savedOriginalQueue);

						if (currentSongId) {
							const newIndex = savedOriginalQueue.indexOf(currentSongId);
							if (newIndex !== -1) store.set(currentMusicIndexAtom, newIndex);
						}

						setOriginalQueue(null);
					}
				}
				store.set(isShuffleActiveAtom, nextShuffleState);
			}),
		);

		store.set(
			onCycleRepeatModeAtom,
			toEmit(() => {
				const currentMode = store.get(repeatModeAtom);
				let nextMode: RepeatMode;
				switch (currentMode) {
					case RepeatMode.Off:
						nextMode = RepeatMode.All;
						break;
					case RepeatMode.All:
						nextMode = RepeatMode.One;
						break;
					case RepeatMode.One:
						nextMode = RepeatMode.Off;
						break;
					default:
						nextMode = RepeatMode.Off;
				}
				store.set(repeatModeAtom, nextMode);
			}),
		);

		store.set(onRequestNextSongAtom, toEmit(playNextManual));
		store.set(onRequestPrevSongAtom, toEmit(playPrevManual));

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
			store.set(onToggleShuffleAtom, doNothing);
			store.set(onCycleRepeatModeAtom, doNothing);
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
