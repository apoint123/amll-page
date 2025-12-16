import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// ==================================================================
//                            类型定义
// ==================================================================

/**
 * 定义了应用的主题模式枚举。
 */
export enum DarkMode {
	Auto = "auto",
	Light = "light",
	Dark = "dark",
}

/**
 * 定义了应用的音乐数据来源模式枚举。
 * - `local`: 本地文件播放模式。
 * - `ws-protocol`: WebSocket 协议模式。
 * - `system-listener`: SMTC 监听模式。
 */
export enum MusicContextMode {
	Local = "local",
	WSProtocol = "ws-protocol",
	SystemListener = "system-listener",
}

// ==================================================================
//                        应用核心配置
// ==================================================================

/**
 * 应用的显示语言。
 * @default "zh-CN"
 */
export const displayLanguageAtom = atomWithStorage(
	"amll-player.displayLanguage",
	"zh-CN",
);

/**
 * 应用的主题（暗黑/明亮）模式设置。
 * @default DarkMode.Auto
 */
export const darkModeAtom = atomWithStorage(
	"amll-player.darkMode",
	DarkMode.Auto,
);

/**
 * 应用的音乐上下文（数据源）模式。
 * @default MusicContextMode.Local
 */
export const musicContextModeAtom = atomWithStorage(
	"amll-player.musicContextMode",
	MusicContextMode.Local,
);

/**
 * 是否启用提前歌词行时序的功能。
 * 即将原歌词行的初始时间时序提前，以便在歌词滚动结束后刚好开始播放（逐词）歌词效果。这个行为更加接近 Apple Music 的效果，
 * 但是大部分情况下会导致歌词行末尾的歌词尚未播放完成便被切换到下一行。
 */
export const advanceLyricDynamicLyricTimeAtom = atomWithStorage(
	"amll-player.advanceLyricDynamicLyricTimeAtom",
	false,
);

/**
 * WebSocket 协议的监听地址和端口。
 */
export const wsProtocolListenAddrAtom = atomWithStorage(
	"amll-player.wsProtocolListenAddr",
	"localhost:11444",
);

/**
 * 是否在应用中显示性能统计（Stat.js）面板。
 */
export const showStatJSFrameAtom = atomWithStorage(
	"amll-player.showStatJSFrame",
	false,
);

// ==================================================================
//                        应用 UI 状态
// ==================================================================

/**
 * 一个派生状态，用于自动检测系统是否处于深色模式。
 */
export const autoDarkModeAtom = atom(true);

/**
 * 一个派生状态，用于最终决定应用应该显示的主题。
 * 它会根据 `darkModeAtom` 的设置（自动/手动）来返回最终的主题状态。
 * 同时，它也允许通过 set 操作来直接设置手动模式下的主题。
 */
export const isDarkThemeAtom = atom(
	(get) =>
		get(darkModeAtom) === DarkMode.Auto
			? get(autoDarkModeAtom)
			: get(darkModeAtom) === DarkMode.Dark,
	(_get, set, newIsDark: boolean) =>
		set(darkModeAtom, newIsDark ? DarkMode.Dark : DarkMode.Light),
);

/**
 * 控制播放列表卡片是否打开。
 */
export const playlistCardOpenedAtom = atom(false);

/**
 * 控制录制面板是否打开。
 */
export const recordPanelOpenedAtom = atom(false);

/**
 * 控制主界面底部的“正在播放”栏是否隐藏。
 */
export const hideNowPlayingBarAtom = atom(false);

/**
 * @description 存储 Song ID 列表
 */
export const currentMusicQueueAtom = atom<string[]>([]);

/**
 * @description 当前播放索引
 */
export const currentMusicIndexAtom = atom<number>(-1);

/**
 * @description 请求播放指定索引的歌曲
 * @param index 索引
 */
export const onRequestPlaySongByIndexAtom = atom<{
	onEmit: (index: number) => void;
}>({
	onEmit: () => {},
});
