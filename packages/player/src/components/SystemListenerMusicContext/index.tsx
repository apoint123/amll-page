import {
	musicAlbumNameAtom,
	musicArtistsAtom,
	musicCoverAtom,
	musicCoverIsVideoAtom,
	musicDurationAtom,
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
} from "@applemusic-like-lyrics/react-full";
import { invoke } from '@tauri-apps/api/core';
import { listen } from "@tauri-apps/api/event";
import { useSetAtom, useStore } from "jotai";
import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import { musicIdAtom, smtcSessionsAtom, smtcTrackIdAtom } from "../../states";

type SmtcEvent =
	| { type: "trackMetadata"; data: { title: string | null; artist: string | null; albumTitle: string | null; durationMs: number | null; } }
	| { type: "coverData"; data: number[] | null }
	| { type: "playbackStatus"; data: { isPlaying: boolean; positionMs: number } }
	| { type: "sessionsChanged"; data: { sessionId: string; displayName: string }[] }
	| { type: "selectedSessionVanished"; data: string }
	| { type: "error"; data: string };

type MediaCommand =
	| { type: 'selectSession'; payload: { session_id: string } }
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'skipNext' }
	| { type: 'skipPrevious' }
	| { type: 'seekTo'; payload: { time_ms: number } };


export const SystemListenerMusicContext: FC = () => {
	const store = useStore();
	const { t } = useTranslation();
	const setMusicId = useSetAtom(musicIdAtom);
	const setSmtcTrackId = useSetAtom(smtcTrackIdAtom);
	const setSmtcSessions = useSetAtom(smtcSessionsAtom);

	useEffect(() => {
		console.log(
			"[SystemListenerMusicContext] 组件已挂载。正在请求初始状态更新...",
		);
		invoke("request_smtc_update").catch((err) => {
			console.error("请求初始 SMTC 状态失败：", err);
		});

		const toEmit = <T,>(onEmit: T) => ({
			onEmit,
		});

		store.set(
			onPlayOrResumeAtom,
			toEmit(() => {
				const isPlaying = store.get(musicPlayingAtom);
				const command: MediaCommand = isPlaying ? { type: "pause" } : { type: "play" };
				invoke("control_external_media", { payload: command });
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
						payload: { time_ms: time },
					},
				});
			}),
		);
		store.set(
			onLyricLineClickAtom,
			toEmit((evt) => {
				const time = evt.line.getLine().startTime;
				invoke("control_external_media", {
					payload: {
						type: "seekTo",
						payload: { time_ms: time },
					},
				});
			}),
		);

		store.set(
			onChangeVolumeAtom,
			toEmit(() => {
				toast.info(t("amll.systemListener.volumeNotSupported", "请在系统或其他应用中直接调节音量"));
			}),
		);
		store.set(onClickControlThumbAtom, toEmit(() => { }));
		store.set(onRequestOpenMenuAtom, toEmit(() => { }));
		store.set(onClickLeftFunctionButtonAtom, toEmit(() => { }));
		store.set(onClickRightFunctionButtonAtom, toEmit(() => { }));

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
						break;
					}

					case "sessionsChanged": {
						console.log(`[SystemListener] 收到会话列表更新:`, data);
						setSmtcSessions(data);
						break;
					}

					case "selectedSessionVanished":
						toast.warn(t("amll.systemListener.sessionVanished", "监听的 SMTC 会话已消失"));
						store.set(musicPlayingAtom, false);
						setSmtcSessions([]);
						break;


					case "error":
						console.error(`[SystemListener] 错误：${data}`);
						toast.error(t("amll.systemListener.error", "系统监听发生错误: {error}", { error: data }));
						break;

					default:
						const unhandled: never = type;
						console.warn(`[SystemListener] 收到未处理的事件类型：'${unhandled}'`);
				}
			},
		);

		return () => {
			unlistenPromise.then((unlisten) => unlisten());

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
		};
	}, [store, t, setMusicId, setSmtcTrackId, setSmtcSessions]);

	return null;
};