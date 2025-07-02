import { parseTTML } from "@applemusic-like-lyrics/lyric";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import {
	wsProtocolListenAddrAtom,
	advanceLyricDynamicLyricTimeAtom,
} from "../src/states/appAtoms";
import {
	hideLyricViewAtom,
	musicLyricLinesAtom,
} from "@applemusic-like-lyrics/react-full";

interface WSLyricLine {
	startTime: number;
	endTime: number;
	words: { startTime: number; endTime: number; word: string }[];
	translatedLyric: string;
	romanLyric: string;
	isBG: boolean;
	isDuet: boolean;
}

type WSBodyMessageMap = {
	ping: undefined;
	pong: undefined;
	setLyric: { data: WSLyricLine[] };
	setLyricFromTTML: { data: string };
};
type WSBodyMap = {
	[T in keyof WSBodyMessageMap]: { type: T; value: WSBodyMessageMap[T] };
};

export const useWsLyrics = (isEnabled: boolean) => {
	const wsProtocolListenAddr = useAtomValue(wsProtocolListenAddrAtom);
	const advanceLyricTime = useAtomValue(advanceLyricDynamicLyricTimeAtom);
	const store = useStore();
	const { t } = useTranslation();

	useEffect(() => {
		if (!isEnabled) {
			return;
		}

		const applyTimeAdvance = (lines: any[]) => {
			if (!advanceLyricTime || lines.length === 0) {
				return lines;
			}

			const DEFAULT_ADVANCE_MS = 400;
			const COMPROMISE_ADVANCE_MS = 300;
			const INTERVAL_MS = 400;

			const originalLines = JSON.parse(JSON.stringify(lines));
			const newLines = JSON.parse(JSON.stringify(lines));

			for (let i = 0; i < newLines.length; i++) {
				let advanceAmount = DEFAULT_ADVANCE_MS;

				if (i > 0) {
					const interval =
						originalLines[i].startTime - originalLines[i - 1].endTime;
					if (interval < INTERVAL_MS) {
						advanceAmount = COMPROMISE_ADVANCE_MS;
					}
				}

				newLines[i].startTime = Math.max(
					0,
					originalLines[i].startTime - advanceAmount,
				);
			}

			for (let i = 0; i < newLines.length; i++) {
				newLines[i].endTime = originalLines[i].endTime;

				if (i < newLines.length - 1) {
					newLines[i].endTime = Math.min(
						newLines[i].endTime,
						newLines[i + 1].startTime,
					);
				}

				if (newLines[i].endTime < newLines[i].startTime) {
					newLines[i].endTime = newLines[i].startTime;
				}
			}

			return newLines;
		};

		const onBodyChannel = new Channel<WSBodyMap[keyof WSBodyMessageMap]>();

		function onBody(payload: WSBodyMap[keyof WSBodyMessageMap]) {
			switch (payload.type) {
				case "ping":
					invoke("ws_boardcast_message", { data: { type: "pong" } });
					break;
				case "setLyric": {
					let processed = payload.value.data.map((line) => ({
						...line,
						words: line.words.map((word) => ({ ...word, obscene: false })),
						translatedLyric: "",
						romanLyric: "",
						isBG: false,
						isDuet: false,
					}));

					processed = applyTimeAdvance(processed);

					if (processed.length > 0) {
						store.set(hideLyricViewAtom, false);
					}
					store.set(musicLyricLinesAtom, processed);
					break;
				}
				case "setLyricFromTTML": {
					try {
						const data = parseTTML(payload.value.data);
						let processed = data.lines.map((line) => ({
							...line,
							words: line.words.map((word) => ({ ...word, obscene: false })),
						}));

						processed = applyTimeAdvance(processed);

						store.set(musicLyricLinesAtom, processed);
					} catch (e) {
						console.error(e);
						toast.error(
							t(
								"ws-protocol.toast.ttmlParseError",
								"解析 TTML 歌词时出错：{{error}}",
								{ error: String(e) },
							),
						);
					}
					break;
				}
			}
		}

		onBodyChannel.onmessage = onBody;

		invoke("ws_close_connection").then(() => {
			const addr = wsProtocolListenAddr || "127.0.0.1:11444";
			invoke("ws_reopen_connection", { addr, channel: onBodyChannel });
		});

		return () => {
			invoke("ws_close_connection");
		};
	}, [isEnabled, wsProtocolListenAddr, store, t, advanceLyricTime]);
};
