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
import { useLyricParser } from "../../hooks/useLyricParser.ts";
import { useMediaSession } from "../../hooks/useMediaSession.ts";
import {
	currentMusicIndexAtom,
	currentMusicQueueAtom,
	onRequestPlaySongByIndexAtom,
	originalQueueAtom,
} from "../../states/appAtoms.ts";
import { audioPlayer } from "../../utils/ffmpeg-engine/FFmpegAudioPlayer";
import {
	SyncStatus,
	syncLyricsDatabase,
} from "../../utils/lyric-sync-manager.ts";
import { extractMusicMetadata } from "../../utils/music-file.ts";
import { mapMetadataToQuality } from "../../utils/quality.ts";

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
		// This is a placeholder, as FFT is not implemented in audioPlayer yet.
	}, [fftDataRange]);

	return null;
};

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

	const { lyricLines, hasLyrics } = useLyricParser(
		song?.lyric,
		song?.lyricFormat,
		song?.translatedLrc,
		song?.romanLrc,
	);

	useEffect(() => {
		setLyricLines(lyricLines);
		setHideLyricView(!hasLyrics);
	}, [lyricLines, hasLyrics, setLyricLines, setHideLyricView]);

	return null;
};

export const LocalMusicContext: FC = () => {
	const store = useStore();
	const { t } = useTranslation();
	const [musicPlaying, setMusicPlaying] = useAtom(musicPlayingAtom);
	const setOriginalQueue = useSetAtom(originalQueueAtom);

	const savedMusicId = useAtomValue(musicIdAtom);
	const savedPosition = useAtomValue(musicPlayingPositionAtom);
	const savedVolume = useAtomValue(musicVolumeAtom);
	const [hasRestored, setHasRestored] = useState(false);

	useMediaSession();

	useEffect(() => {
		audioPlayer.setVolume(savedVolume);
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

						await audioPlayer.load(file);

						if (savedPosition > 0) {
							audioPlayer.seek(savedPosition / 1000);
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
			await audioPlayer.load(file);
			await audioPlayer.play();
			store.set(musicPlayingAtom, true);
		};

		store.set(
			onPlayOrResumeAtom,
			toEmit(() => {
				if (musicPlaying) {
					audioPlayer.pause();
				} else {
					audioPlayer.play();
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
				audioPlayer.seek(time / 1000);
			}),
		);
		store.set(
			onLyricLineClickAtom,
			toEmit((evt) => {
				audioPlayer.seek(evt.line.getLine().startTime / 1000);
			}),
		);
		store.set(
			onChangeVolumeAtom,
			toEmit((volume: number) => {
				audioPlayer.setVolume(volume);
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
			const durationSec = audioPlayer.duration;
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
		};

		const handlePause = () => {
			setMusicPlaying(false);
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
					audioPlayer.seek(0);
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

		const handleTimeUpdate = (e: CustomEvent<number>) => {
			store.set(musicPlayingPositionAtom, (e.detail * 1000) | 0);
		};

		audioPlayer.addEventListener("play", handlePlay);
		audioPlayer.addEventListener("pause", handlePause);
		audioPlayer.addEventListener("ended", handleEnded);
		audioPlayer.addEventListener("volumechange", handleVolumeChange);
		audioPlayer.addEventListener("loaded", handleLoaded);
		audioPlayer.addEventListener("timeupdate", handleTimeUpdate);

		return () => {
			audioPlayer.removeEventListener("play", handlePlay);
			audioPlayer.removeEventListener("pause", handlePause);
			audioPlayer.removeEventListener("ended", handleEnded);
			audioPlayer.removeEventListener("volumechange", handleVolumeChange);
			audioPlayer.removeEventListener("loaded", handleLoaded);
			audioPlayer.removeEventListener("timeupdate", handleTimeUpdate);

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
