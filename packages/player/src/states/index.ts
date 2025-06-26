import { AudioQualityType } from "@applemusic-like-lyrics/react-full";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { SongData } from "../utils/player.ts";

export enum DarkMode {
	Auto = "auto",
	Light = "light",
	Dark = "dark",
}

export const autoDarkModeAtom = atom(true); 

export const darkModeAtom = atomWithStorage(
	"amll-player.darkMode",
	DarkMode.Auto,
);

export const isDarkThemeAtom = atom(
	(get) => {
		const mode = get(darkModeAtom);
		if (mode === DarkMode.Auto) {
			return get(autoDarkModeAtom);
		}
		return mode === DarkMode.Dark;
	},
	(_get, set, newIsDark: boolean) => {
		const newMode = newIsDark ? DarkMode.Dark : DarkMode.Light;
		set(darkModeAtom, newMode);
	},
);

export const musicIdAtom = atom("");
export const playlistCardOpenedAtom = atom(false);
export const recordPanelOpenedAtom = atom(false);
export const currentPlaylistAtom = atom<SongData[]>([]);
export const currentPlaylistMusicIndexAtom = atom(0);
export const musicQualityAtom = atom({
	type: AudioQualityType.None,
	codec: "unknown",
	channels: 2,
	sampleRate: 44100,
	sampleFormat: "s16",
});

export const displayLanguageAtom = atomWithStorage(
	"amll-player.displayLanguage",
	"zh-CN",
);

export const backgroundRendererAtom = atomWithStorage(
	"amll-player.backgroundRenderer",
	"mesh",
);

export const cssBackgroundPropertyAtom = atomWithStorage(
	"amll-player.cssBackgroundProperty",
	"#111111",
);

export const fftDataRangeAtom = atomWithStorage("amll-player.fftDataRange", [
	80, 2000,
] as [number, number]);

export const showStatJSFrameAtom = atomWithStorage(
	"amll-player.showStatJSFrame",
	false,
);

/**
 * 是否对逐字歌词提前歌词行，默认禁用（考虑到大部分人工打轴的 TTML 歌词会主观引入提前的歌词行时序）
 *
 * 对开发者的提示：此处应只用于对核心歌词组件的参数调节，不应对传入的歌词行内容本身进行修改
 */
export const advanceLyricDynamicLyricTimeAtom = atomWithStorage(
	"amll-player.advanceLyricDynamicLyricTimeAtom",
	false,
);

export const amllMenuOpenedAtom = atom(false);

export const hideNowPlayingBarAtom = atom(false);

export const wsProtocolListenAddrAtom = atomWithStorage(
	"amll-player.wsProtocolListenAddr",
	"localhost:11444",
);

export const wsProtocolConnectedAddrsAtom = atom(new Set<string>());

export enum LyricPlayerImplementation {
	Dom = "dom",
	DomSlim = "dom-slim",
	Canvas = "canvas",
}

export const lyricPlayerImplementationAtom = atomWithStorage(
	"amll-player.lyricPlayerImplementation",
	LyricPlayerImplementation.Dom,
);

export enum MusicContextMode {
	Local = "local",
	WSProtocol = "ws-protocol",
	SystemListener = "system-listener",
}

export const musicContextModeAtom = atomWithStorage(
	"amll-player.musicContextMode",
	MusicContextMode.Local,
);

export enum TextConversionMode {
	Off = "off",
	TraditionalToSimplified = "traditionalToSimplified",
	SimplifiedToTraditional = "simplifiedToTraditional",
	SimplifiedToTaiwan = "simplifiedToTaiwan",
	TaiwanToSimplified = "taiwanToSimplified",
	SimplifiedToHongKong = "simplifiedToHongKong",
	HongKongToSimplified = "hongKongToSimplified",
}

export const smtcTextConversionModeAtom = atomWithStorage(
	"amll-player.smtcTextConversionMode",
	TextConversionMode.Off,
);

export interface SmtcSession {
	sessionId: string;
	displayName: string;
}
export const smtcSessionsAtom = atom<SmtcSession[]>([]);
export const smtcSelectedSessionIdAtom = atom<string | null>(null);
export const audioQualityDialogOpenedAtom = atom(false);
export const smtcTrackIdAtom = atom<string>("");
