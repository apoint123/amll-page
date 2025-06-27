import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { invoke } from "@tauri-apps/api/core";

import type {
	LyricLine,
	LyricLineMouseEvent,
	LyricPlayerBase,
} from "@applemusic-like-lyrics/core";

import type {
	BackgroundRenderProps,
	LyricPlayerRef,
} from "@applemusic-like-lyrics/react";

export type SongData =
	| { type: "local"; filePath: string; origOrder: number; }
	| { type: "custom"; id: string; songJsonData: string; origOrder: number; };

export interface ArtistStateEntry { name: string; id: string; }
export interface SmtcSession { sessionId: string; displayName: string; }

export enum AudioQualityType {
	None = "none",
	Standard = "standard",
	Lossless = "lossless",
	HiResLossless = "hi-res-lossless",
	DolbyAtmos = "dolby-atmos",
}

export enum DarkMode { Auto = "auto", Light = "light", Dark = "dark" }
export enum MusicContextMode { Local = "local", WSProtocol = "ws-protocol", SystemListener = "system-listener" }
export enum TextConversionMode { Off = "off", TraditionalToSimplified = "traditionalToSimplified", SimplifiedToTraditional = "simplifiedToTraditional", SimplifiedToTaiwan = "simplifiedToTaiwan", TaiwanToSimplified = "taiwanToSimplified", SimplifiedToHongKong = "simplifiedToHongKong", HongKongToSimplified = "hongKongToSimplified" }
export enum RepeatMode { Off = "off", One = "one", All = "all" }
export enum PlayerControlsType { Controls = "controls", FFT = "fft", None = "none" }
export enum VerticalCoverLayout { Auto = "auto", ForceNormal = "force-normal", ForceImmersive = "force-immersive" }

export const lyricPlayerImplementationAtom = atom<{
	lyricPlayer?: {
		new(...args: ConstructorParameters<typeof LyricPlayerBase>): LyricPlayerBase;
	};
}>({ lyricPlayer: undefined });
export const enableLyricLineBlurEffectAtom = atomWithStorage("amll-react-full.enableLyricLineBlurEffectAtom", true);
export const enableLyricLineScaleEffectAtom = atomWithStorage("amll-react-full.enableLyricLineScaleEffectAtom", true);
export const enableLyricLineSpringAnimationAtom = atomWithStorage("amll-react-full.enableLyricLineSpringAnimationAtom", true);
export const enableLyricTranslationLineAtom = atomWithStorage("amll-react-full.enableLyricTranslationLineAtom", true);
export const enableLyricRomanLineAtom = atomWithStorage("amll-react-full.enableLyricRomanLineAtom", true);
export const enableLyricSwapTransRomanLineAtom = atomWithStorage("amll-react-full.enableLyricSwapTransRomanLineAtom", false);
export const lyricWordFadeWidthAtom = atomWithStorage("amll-react-full.lyricWordFadeWidth", 0.5);
export const lyricFontFamilyAtom = atomWithStorage("amll-react-full.lyricFontFamily", "");
export const lyricFontWeightAtom = atomWithStorage("amll-react-full.lyricFontWeight", 0);
export const lyricLetterSpacingAtom = atomWithStorage("amll-react-full.lyricLetterSpacing", "normal");
export const globalLyricTimelineOffsetAtom = atomWithStorage("amll-react-full.globalLyricTimelineOffsetAtom", 0);
export const playerControlsTypeAtom = atomWithStorage("amll-react-full.playerControlsType", PlayerControlsType.Controls);
export const showMusicNameAtom = atomWithStorage("amll-react-full.showMusicName", true);
export const verticalCoverLayoutAtom = atomWithStorage("amll-react-full.verticalCoverLayoutAtom", VerticalCoverLayout.Auto);
export const showMusicArtistsAtom = atomWithStorage("amll-react-full.showMusicArtists", true);
export const showMusicAlbumAtom = atomWithStorage("amll-react-full.showMusicAlbum", false);
export const showVolumeControlAtom = atomWithStorage("amll-react-full.showVolumeControl", true);
export const showBottomControlAtom = atomWithStorage("amll-react-full.showBottomControl", true);
export const lyricBackgroundRendererAtom = atom<{ renderer?: BackgroundRenderProps["renderer"] | string; }>({ renderer: undefined });
export const lyricBackgroundFPSAtom = atomWithStorage<NonNullable<BackgroundRenderProps["fps"]>>("amll-react-full.lyricBackgroundFPSAtom", 60);
export const lyricBackgroundRenderScaleAtom = atomWithStorage<NonNullable<BackgroundRenderProps["renderScale"]>>("amll-react-full.lyricBackgroundRenderScaleAtom", 1);
export const lyricBackgroundStaticModeAtom = atomWithStorage<NonNullable<BackgroundRenderProps["staticMode"]>>("amll-react-full.lyricBackgroundStaticModeAtom", false);
export const displayLanguageAtom = atomWithStorage("amll-player.displayLanguage", "zh-CN");
export const darkModeAtom = atomWithStorage("amll-player.darkMode", DarkMode.Auto);
export const musicContextModeAtom = atomWithStorage("amll-player.musicContextMode", MusicContextMode.Local);
export const showStatJSFrameAtom = atomWithStorage("amll-player.showStatJSFrame", false);
export const advanceLyricDynamicLyricTimeAtom = atomWithStorage("amll-player.advanceLyricDynamicLyricTimeAtom", false);
export const wsProtocolListenAddrAtom = atomWithStorage("amll-player.wsProtocolListenAddr", "localhost:11444");

export const musicIdAtom = atom("");
export const musicNameAtom = atom("未知歌曲");
export const musicArtistsAtom = atom<ArtistStateEntry[]>([{ name: "未知创作者", id: "unknown" }]);
export const musicAlbumNameAtom = atom("未知专辑");
export const musicCoverAtom = atom("");
export const musicCoverIsVideoAtom = atom(false);
export const musicDurationAtom = atom(0);
export const musicPlayingAtom = atom(false);
export const musicPlayingPositionAtom = atom(0);
export const musicVolumeAtom = atomWithStorage("amll-react-full.musicVolumeAtom", 0.5);
export const musicLyricLinesAtom = atom<LyricLine[]>([]);
export const musicQualityTagAtom = atom<{ tagIcon: boolean; tagText: string; isDolbyAtmos: boolean; } | null>(null);

export const autoDarkModeAtom = atom(true);
export const isDarkThemeAtom = atom((get) => get(darkModeAtom) === DarkMode.Auto ? get(autoDarkModeAtom) : get(darkModeAtom) === DarkMode.Dark, (_get, set, newIsDark: boolean) => set(darkModeAtom, newIsDark ? DarkMode.Dark : DarkMode.Light),);
export const playlistCardOpenedAtom = atom(false);
export const recordPanelOpenedAtom = atom(false);
export const currentPlaylistAtom = atom<SongData[]>([]);
export const currentPlaylistMusicIndexAtom = atom(0);
export const isLyricPageOpenedAtom = atom(false);
export const hideLyricViewAtom = atomWithStorage("amll-react-full.hideLyricViewAtom", false);
export const lowFreqVolumeAtom = atom<number>(1);
export const fftDataAtom = atom<number[]>([]);
export const amllMenuOpenedAtom = atom(false);
export const hideNowPlayingBarAtom = atom(false);
export const wsProtocolConnectedAddrsAtom = atom(new Set<string>());

export interface Callback<Args extends any[], Result = void> { onEmit?: (...args: Args) => Result; }
const c = <Args extends any[], Result = void>(_onEmit: (...args: Args) => Result): Callback<Args, Result> => ({});
export const onClickControlThumbAtom = atom(c(() => { }));
export const onClickAudioQualityTagAtom = atom(c(() => { }));
export const onRequestOpenMenuAtom = atom(c(() => { }));
export const onPlayOrResumeAtom = atom(c(() => { }));
export const onPauseAtom = atom(c(() => { }));
export const onRequestPrevSongAtom = atom(c(() => { }));
export const onRequestNextSongAtom = atom(c(() => { }));
export const onSeekPositionAtom = atom(c((_position: number) => { }));
export const onLyricLineClickAtom = atom(c((_evt: LyricLineMouseEvent, _playerRef: LyricPlayerRef | null) => { }));
export const onLyricLineContextMenuAtom = atom(c((_evt: LyricLineMouseEvent, _playerRef: LyricPlayerRef | null) => { }));
export const onChangeVolumeAtom = atom(c((_volume: number) => { }));
export const onClickLeftFunctionButtonAtom = atom(c(() => { }));
export const onClickRightFunctionButtonAtom = atom(c(() => { }));

export const smtcSessionsAtom = atom<SmtcSession[]>([]);
export const smtcSelectedSessionIdAtom = atom<string | null>(null);
export const audioQualityDialogOpenedAtom = atom(false);
export const smtcTrackIdAtom = atom<string>("");
export const smtcTextConversionModeAtom = atomWithStorage("amll-player.smtcTextConversionMode", TextConversionMode.Off);
export const smtcShuffleStateAtom = atom<boolean>(false);
export const smtcRepeatModeAtom = atom<RepeatMode>(RepeatMode.Off);
export const onClickSmtcShuffleAtom = atom(null, (get) => {
	const currentShuffle = get(smtcShuffleStateAtom);
	invoke("control_external_media", { payload: { type: "setShuffle", is_active: !currentShuffle } }).catch(console.error);
});
export const onClickSmtcRepeatAtom = atom(null, (get) => {
	const currentMode = get(smtcRepeatModeAtom);
	const nextMode = currentMode === RepeatMode.Off ? RepeatMode.All : currentMode === RepeatMode.All ? RepeatMode.One : RepeatMode.Off;
	invoke("control_external_media", { payload: { type: "setRepeatMode", mode: nextMode } }).catch(console.error);
});

export const cssBackgroundPropertyAtom = atomWithStorage(
    "amll-player.cssBackgroundProperty",
    "#111111",
);

export enum LyricPlayerImplementation {
    Dom = "dom",
    DomSlim = "dom-slim",
    Canvas = "canvas",
}
