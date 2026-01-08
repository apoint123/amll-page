import {
	musicArtistsAtom,
	musicCoverAtom,
	musicNameAtom,
	musicPlayingAtom,
	onPlayOrResumeAtom,
	onRequestNextSongAtom,
	onRequestPrevSongAtom,
	onSeekPositionAtom,
} from "@applemusic-like-lyrics/react-full";
import { useAtomValue } from "jotai";
import { useCallback, useEffect } from "react";
import { audioPlayer } from "../utils/ffmpeg-engine/FFmpegAudioPlayer";

export const useMediaSession = () => {
	const musicName = useAtomValue(musicNameAtom);
	const musicArtists = useAtomValue(musicArtistsAtom);
	const musicCover = useAtomValue(musicCoverAtom);

	const isPlaying = useAtomValue(musicPlayingAtom);

	const requestNext = useAtomValue(onRequestNextSongAtom);
	const requestPrev = useAtomValue(onRequestPrevSongAtom);
	const playOrResume = useAtomValue(onPlayOrResumeAtom);
	const seekTo = useAtomValue(onSeekPositionAtom);

	useEffect(() => {
		if (!("mediaSession" in navigator)) return;

		const artistNames = musicArtists.map((a) => a.name).join(" / ");

		navigator.mediaSession.metadata = new MediaMetadata({
			title: musicName,
			artist: artistNames,
			// artwork: musicCover
			// 	? [
			// 			{
			// 				src: musicCover,
			// 				sizes: "128x128",
			// 				type: "image/png",
			// 			},
			// 		]
			// 	: [],
		});
	}, [musicName, musicArtists, musicCover]);

	useEffect(() => {
		if (!("mediaSession" in navigator)) return;
		navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
	}, [isPlaying]);

	const updatePosition = useCallback(() => {
		if (!("mediaSession" in navigator)) return;

		const duration = audioPlayer.duration;
		const position = audioPlayer.currentTime;

		if (duration > 0 && Number.isFinite(duration)) {
			try {
				navigator.mediaSession.setPositionState({
					duration: duration,
					playbackRate: 1.0,
					position: position,
				});
			} catch (e) {
				console.warn("更新 MediaSession 失败", e);
			}
		}
	}, []);

	useEffect(() => {
		if (!("mediaSession" in navigator)) return;

		audioPlayer.addEventListener("play", updatePosition);
		audioPlayer.addEventListener("pause", updatePosition);
		audioPlayer.addEventListener("loaded", updatePosition);
		audioPlayer.addEventListener("seeked", updatePosition);

		updatePosition();

		return () => {
			audioPlayer.removeEventListener("play", updatePosition);
			audioPlayer.removeEventListener("pause", updatePosition);
			audioPlayer.removeEventListener("loaded", updatePosition);
			audioPlayer.removeEventListener("seeked", updatePosition);
		};
	}, [updatePosition]);

	useEffect(() => {
		if (!isPlaying || !("mediaSession" in navigator)) return;

		updatePosition();

		const intervalId = setInterval(updatePosition, 1000);

		return () => {
			clearInterval(intervalId);
		};
	}, [isPlaying, updatePosition]);

	useEffect(() => {
		if (!("mediaSession" in navigator)) return;

		const actionHandlers = [
			[
				"play",
				() => {
					playOrResume?.onEmit?.();
				},
			],
			[
				"pause",
				() => {
					playOrResume?.onEmit?.();
				},
			],
			[
				"previoustrack",
				() => {
					requestPrev?.onEmit?.();
				},
			],
			[
				"nexttrack",
				() => {
					requestNext?.onEmit?.();
				},
			],
			[
				"seekto",
				(details: MediaSessionActionDetails) => {
					if (details.seekTime !== undefined && seekTo?.onEmit) {
						seekTo.onEmit(details.seekTime * 1000);
					}
				},
			],
		] as const;

		for (const [action, handler] of actionHandlers) {
			try {
				navigator.mediaSession.setActionHandler(action, handler);
			} catch (e) {
				console.warn(`注册 ${action} 失败`, e);
			}
		}

		return () => {
			for (const [action] of actionHandlers) {
				try {
					navigator.mediaSession.setActionHandler(action, null);
				} catch (e) {
					console.warn(`清理 ${action} 失败`, e);
				}
			}
		};
	}, [requestNext, requestPrev, playOrResume, seekTo, updatePosition]);
};
