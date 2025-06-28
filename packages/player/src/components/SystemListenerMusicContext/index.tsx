import { type FC, useEffect } from "react";

import { invoke } from '@tauri-apps/api/core';
import { listen } from "@tauri-apps/api/event";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { FFTToLowPassContext } from "../LocalMusicContext/index.tsx";
import {
	musicAlbumNameAtom,
	musicArtistsAtom,
	musicCoverAtom,
	musicCoverIsVideoAtom,
	musicDurationAtom,
	musicIdAtom,
	musicLyricLinesAtom,
	musicNameAtom,
	musicPlayingAtom,
	musicPlayingPositionAtom,
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
	RepeatMode,
	smtcRepeatModeAtom,
	smtcSessionsAtom,
	smtcShuffleStateAtom,
	smtcTextConversionModeAtom,
	smtcTrackIdAtom,
	musicVolumeAtom,
	isLyricPageOpenedAtom,
} from "@applemusic-like-lyrics/states";
import { FFTPlayer } from "@applemusic-like-lyrics/fft";
import { fftDataAtom } from "@applemusic-like-lyrics/states";
type SmtcEvent =
	| { type: "trackMetadata"; data: { title: string | null; artist: string | null; albumTitle: string | null; durationMs: number | null; } }
	| { type: "coverData"; data: number[] | null }
	| { type: "playbackStatus"; data: { isPlaying: boolean; positionMs: number; isShuffleActive: boolean; repeatMode: RepeatMode; } }
	| { type: "volumeChanged"; data: { volume: number; isMuted: boolean } }
	| { type: "sessionsChanged"; data: { sessionId: string; displayName: string }[] }
	| { type: "selectedSessionVanished"; data: string }
	| { type: "error"; data: string }
	| { type: "audioData"; data: number[] };

export const SystemListenerMusicContext: FC = () => {
	const store = useStore();
	const { t } = useTranslation();
	const setMusicId = useSetAtom(musicIdAtom);
	const setSmtcTrackId = useSetAtom(smtcTrackIdAtom);
	const setSmtcSessions = useSetAtom(smtcSessionsAtom);
	const setSmtcShuffle = useSetAtom(smtcShuffleStateAtom);
	const setSmtcRepeat = useSetAtom(smtcRepeatModeAtom);
	const textConversionMode = useAtomValue(smtcTextConversionModeAtom);
	const setIsLyricPageOpened = useSetAtom(isLyricPageOpenedAtom);

	useEffect(() => {
		invoke("control_external_media", {
			payload: {
				type: "setTextConversion",
				mode: textConversionMode,
			},
		}).catch(console.error);
	}, [textConversionMode]);

	useEffect(() => {
		console.log("[SystemListenerMusicContext] 组件已挂载。",);
		const fftPlayer = new FFTPlayer();
		const fftResult = new Float32Array(64);
		let animationFrameId: number;

		const onFFTFrame = () => {
			fftPlayer.read(fftResult);
			store.set(fftDataAtom, [...fftResult]);
			animationFrameId = requestAnimationFrame(onFFTFrame);
		};
		animationFrameId = requestAnimationFrame(onFFTFrame);

		const initialUpdateTimeout = setTimeout(() => {
			console.log("[SystemListenerMusicContext] 正在请求初始状态更新...");
			invoke("request_smtc_update").catch((err) => {
				console.error("请求初始 SMTC 状态失败：", err);
			});
		}, 100);



		const toEmit = <T,>(onEmit: T) => ({ onEmit });

		const startVisualization = async () => {
			await invoke("control_external_media", {
				payload: { type: "stopAudioVisualization" },
			});
			await new Promise(resolve => setTimeout(resolve, 50));
			await invoke("control_external_media", {
				payload: { type: "startAudioVisualization" },
			});
		};

		startVisualization().catch(console.error);


		store.set(
			onPlayOrResumeAtom,
			toEmit(() => {
				const isPlaying = store.get(musicPlayingAtom);
				invoke("control_external_media", { payload: { type: isPlaying ? "pause" : "play" } });
			}),
		);
		store.set(
			onRequestNextSongAtom,
			toEmit(() => {
				invoke("control_external_media", { payload: { type: "skipNext" } });
			}),
		);
		store.set(
			onRequestPrevSongAtom,
			toEmit(() => {
				invoke("control_external_media", { payload: { type: "skipPrevious" } });
			}),
		);
		store.set(
			onSeekPositionAtom,
			toEmit((time: number) => {
				invoke("control_external_media", {
					payload: {
						type: "seekTo",
						time_ms: Math.floor(time),
					},
				});
			}),
		);
		store.set(
			onLyricLineClickAtom,
			toEmit((evt) => {
				invoke("control_external_media", {
					payload: {
						type: "seekTo",
						time_ms: Math.floor(evt.line.getLine().startTime),
					},
				});
			}),
		);
		store.set(
			onChangeVolumeAtom,
			toEmit((volume: number) => {
				invoke("control_external_media", {
					payload: {
						type: "setVolume",
						volume: volume,
					},
				}).catch(err => console.error("设置音量失败:", err));
			}),
		);

		store.set(
			onClickControlThumbAtom,
			toEmit(() => {
				store.set(isLyricPageOpenedAtom, false);
			}),
		);

		store.set(onRequestOpenMenuAtom, toEmit(() => { }));
		store.set(
			onClickLeftFunctionButtonAtom,
			toEmit(() => {
				store.set(isLyricPageOpenedAtom, false);
			}),
		);
		store.set(
			onClickRightFunctionButtonAtom,
			toEmit(() => {
				store.set(isLyricPageOpenedAtom, false);
			}),
		);

		const unlistenPromise = listen<SmtcEvent>(
			"smtc_update",
			(event) => {
				const { type, data } = event.payload;

				switch (type) {
					case "trackMetadata": {
						const newTrackId = `${data.title}-${data.artist}-${data.albumTitle}`;
						const oldTrackId = store.get(smtcTrackIdAtom);

						console.log(`[SystemListener] TrackMetadata 更新。新 ID: ${newTrackId}, 旧 ID: ${oldTrackId}`);

						if (newTrackId !== oldTrackId) {
							setSmtcTrackId(newTrackId);
							setMusicId(newTrackId);
							store.set(musicPlayingPositionAtom, 0);
							store.set(musicLyricLinesAtom, []);
						}

						store.set(musicNameAtom, data.title ?? "未知曲目");
						store.set(musicAlbumNameAtom, data.albumTitle ?? "");
						store.set(
							musicArtistsAtom,
							(data.artist ?? "未知艺术家").split(/[/,]/).map((v) => ({
								id: v.trim(), name: v.trim(),
							})),
						);
						store.set(musicDurationAtom, data.durationMs ?? 0);
						break;
					}

					case "coverData":
						if (data && data.length > 0) {
							const imgBlob = new Blob([new Uint8Array(data)], { type: "image/png" });
							const newUrl = URL.createObjectURL(imgBlob);
							try {
								const oldUrl = store.get(musicCoverAtom);
								if (oldUrl.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
							} catch (e) { }
							store.set(musicCoverAtom, newUrl);
							store.set(musicCoverIsVideoAtom, false);
						} else {
							store.set(musicCoverAtom, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
						}
						break;

					case "playbackStatus": {
						store.set(musicPlayingAtom, data.isPlaying);
						store.set(musicPlayingPositionAtom, data.positionMs);
						setSmtcShuffle(data.isShuffleActive);
						setSmtcRepeat(data.repeatMode);
						break;
					}

					case "volumeChanged": {
						const newVolume = data.isMuted ? 0 : data.volume;
						store.set(musicVolumeAtom, newVolume);
						break;
					}

					case "sessionsChanged": {
						console.log(`[SystemListener] 收到会话列表更新:`, data);
						setSmtcSessions(data);
						break;
					}

					case "selectedSessionVanished":
						toast.warn(t("amll.systemListener.sessionVanished"));
						store.set(musicPlayingAtom, false);
						setSmtcSessions([]);
						break;

					case "error":
						console.error(`[SystemListener] 错误：${data}`);
						toast.error(t("amll.systemListener.error", { error: data }));
						break;

					case "audioData": {
						if (fftPlayer) {
							fftPlayer.pushDataI16(
								48000,
								2,
								new Int16Array(new Uint8Array(data).buffer)
							);
						}
						break;
					}

					default:
						const unhandled: never = type;
						console.warn(`[SystemListener] 收到未处理的事件类型：'${unhandled}'`);
				}
			},
		);

		return () => {
			clearTimeout(initialUpdateTimeout);
			unlistenPromise.then((unlisten) => unlisten());

			cancelAnimationFrame(animationFrameId);

			invoke("control_external_media", {
				payload: { type: "stopAudioVisualization" },
			}).catch(console.error);

			if (fftPlayer) {
				fftPlayer.free();
			}

			store.set(fftDataAtom, []);
			store.set(onPlayOrResumeAtom, toEmit(() => { }));
			store.set(onRequestNextSongAtom, toEmit(() => { }));
			store.set(onRequestPrevSongAtom, toEmit(() => { }));
			store.set(onSeekPositionAtom, toEmit(() => { }));
			store.set(onLyricLineClickAtom, toEmit(() => { }));
			store.set(onChangeVolumeAtom, toEmit(() => { }));
			store.set(onClickControlThumbAtom, toEmit(() => { }));
			store.set(onRequestOpenMenuAtom, toEmit(() => { }));
			store.set(onClickLeftFunctionButtonAtom, toEmit(() => { }));
			store.set(onClickRightFunctionButtonAtom, toEmit(() => { }));

			store.set(musicNameAtom, "");
			store.set(musicAlbumNameAtom, "");
			store.set(musicArtistsAtom, []);
			store.set(musicPlayingAtom, false);
			store.set(musicPlayingPositionAtom, 0);
			store.set(musicDurationAtom, 0);
			store.set(musicCoverAtom, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
			store.set(musicLyricLinesAtom, []);
			setSmtcTrackId("");
			setMusicId("");
			setSmtcShuffle(false);
			setSmtcRepeat(RepeatMode.Off);
			invoke("control_external_media", {
				payload: { type: "stopAudioVisualization" },
			}).catch(console.error);
		};
	}, [store, t, setMusicId, setSmtcTrackId, setSmtcSessions, setSmtcShuffle, setSmtcRepeat, textConversionMode, setIsLyricPageOpened]);

	return (
		<>
			<FFTToLowPassContext />
		</>
	);
};