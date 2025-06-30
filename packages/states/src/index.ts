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

import { type Update } from "@tauri-apps/plugin-updater";
import type { PlayerExtensionContext } from "../../player/src/components/ExtensionContext/ext-ctx";

export type SongData =
	| { type: "local"; filePath: string; origOrder: number }
	| { type: "custom"; id: string; songJsonData: string; origOrder: number };

export interface ArtistStateEntry {
	name: string;
	id: string;
}
export interface SmtcSession {
	sessionId: string;
	displayName: string;
}

export enum AudioQualityType {
	None = "none",
	Standard = "standard",
	Lossless = "lossless",
	HiResLossless = "hi-res-lossless",
	DolbyAtmos = "dolby-atmos",
}

export interface MusicQualityState {
	type: AudioQualityType;
	codec: string;
	channels: number;
	sampleRate: number;
	sampleFormat: string;
}

export const musicQualityAtom = atom<MusicQualityState>({
	type: AudioQualityType.None,
	codec: "unknown",
	channels: 2,
	sampleRate: 44100,
	sampleFormat: "s16",
});

export const fftDataRangeAtom = atomWithStorage("amll-player.fftDataRange", [
	80, 2000,
] as [number, number]);

export enum DarkMode {
	Auto = "auto",
	Light = "light",
	Dark = "dark",
}
export enum MusicContextMode {
	Local = "local",
	WSProtocol = "ws-protocol",
	SystemListener = "system-listener",
}
export enum TextConversionMode {
	Off = "off",
	TraditionalToSimplified = "traditionalToSimplified",
	SimplifiedToTraditional = "simplifiedToTraditional",
	SimplifiedToTaiwan = "simplifiedToTaiwan",
	TaiwanToSimplified = "taiwanToSimplified",
	SimplifiedToHongKong = "simplifiedToHongKong",
	HongKongToSimplified = "hongKongToSimplified",
}
export enum RepeatMode {
	Off = "off",
	One = "one",
	All = "all",
}
export enum PlayerControlsType {
	Controls = "controls",
	FFT = "fft",
	None = "none",
}
export enum VerticalCoverLayout {
	Auto = "auto",
	ForceNormal = "force-normal",
	ForceImmersive = "force-immersive",
}

// ======================== 歌词效果配置 ========================

/**
 * 歌词播放组件的实现类型，默认为 `DefaultLyricPlayer`
 *
 * 由于存储状态特殊，故不使用 atomWithStorage，请另外处理配置存储
 *
 * 性能影响情况：高
 */
export const lyricPlayerImplementationAtom = atom<{
	lyricPlayer?: {
		new (
			...args: ConstructorParameters<typeof LyricPlayerBase>
		): LyricPlayerBase;
	};
}>({ lyricPlayer: undefined });

/**
 * 是否启用歌词行模糊效果，默认启用
 *
 * 性能影响情况：高
 */
export const enableLyricLineBlurEffectAtom = atomWithStorage(
	"amll-react-full.enableLyricLineBlurEffectAtom",
	true,
);

/**
 * 是否启用歌词行缩放效果，默认启用
 *
 * 性能影响情况：无
 */
export const enableLyricLineScaleEffectAtom = atomWithStorage(
	"amll-react-full.enableLyricLineScaleEffectAtom",
	true,
);

/**
 * 是否启用歌词行弹簧动画效果，默认启用
 *
 * 如果禁用，则会回退到基础的 CSS 属性动画效果
 *
 * 性能影响情况：中
 */
export const enableLyricLineSpringAnimationAtom = atomWithStorage(
	"amll-react-full.enableLyricLineSpringAnimationAtom",
	true,
);

/**
 * 是否显示翻译歌词行，默认启用
 *
 * 性能影响情况：低
 */
export const enableLyricTranslationLineAtom = atomWithStorage(
	"amll-react-full.enableLyricTranslationLineAtom",
	true,
);

/**
 * 是否显示音译歌词行，默认启用
 *
 * 性能影响情况：低
 */
export const enableLyricRomanLineAtom = atomWithStorage(
	"amll-react-full.enableLyricRomanLineAtom",
	true,
);

/**
 * 是否交换音译歌词行和翻译歌词行，默认禁用
 *
 * 性能影响情况：无
 */
export const enableLyricSwapTransRomanLineAtom = atomWithStorage(
	"amll-react-full.enableLyricSwapTransRomanLineAtom",
	false,
);

/**
 * 调节逐词歌词时单词的渐变过渡宽度，单位为一个全角字的宽度，默认为 0.5
 *
 * 如果要模拟 Apple Music for Android 的效果，可以设置为 1
 *
 * 如果要模拟 Apple Music for iPad 的效果，可以设置为 0.5
 *
 * 如需关闭逐词歌词时单词的渐变过渡效果，可以设置为 0
 *
 * 性能影响情况：无
 */
export const lyricWordFadeWidthAtom = atomWithStorage(
	"amll-react-full.lyricWordFadeWidth",
	0.5,
);

/**
 * 设置仅歌词组件的字体家族（CSS Font Family 属性），默认为空（即继承自父元素）
 */
export const lyricFontFamilyAtom = atomWithStorage(
	"amll-react-full.lyricFontFamily",
	"",
);

/**
 * 设置仅歌词组件的字体字重（CSS Font Weight 属性），默认为 0 （即继承自父元素）
 */
export const lyricFontWeightAtom = atomWithStorage(
	"amll-react-full.lyricFontWeight",
	0,
);

/**
 * 设置仅歌词组件的字符间距（CSS Font Weight 属性），默认为 0 （即继承自父元素）
 */
export const lyricLetterSpacingAtom = atomWithStorage(
	"amll-react-full.lyricLetterSpacing",
	"normal",
);

/**
 * 调节全局歌词时间戳位移，单位为毫秒，正值为提前，负值为推迟，默认为 0
 *
 * 性能影响情况：无
 */
export const globalLyricTimelineOffsetAtom = atomWithStorage(
	"amll-react-full.globalLyricTimelineOffsetAtom",
	0,
);

// ====================== 歌曲信息展示配置 ======================

/**
 * 播放器控制器类型，默认为 `PlayerControlsType.Controls`
 */
export const playerControlsTypeAtom = atomWithStorage(
	"amll-react-full.playerControlsType",
	PlayerControlsType.Controls,
);

/**
 * 是否显示歌曲名称，默认启用
 */
export const showMusicNameAtom = atomWithStorage(
	"amll-react-full.showMusicName",
	true,
);

/**
 * 垂直布局下隐藏歌词时的专辑图布局模式
 * - Auto: 根据专辑图是否为视频切换沉浸布局
 * - ForceNormal: 强制使用默认布局
 * - ForceImmersive: 强制使用沉浸布局
 */
export const verticalCoverLayoutAtom = atomWithStorage(
	"amll-react-full.verticalCoverLayoutAtom",
	VerticalCoverLayout.Auto,
);

/**
 * 是否显示歌曲作者，默认启用
 */
export const showMusicArtistsAtom = atomWithStorage(
	"amll-react-full.showMusicArtists",
	true,
);

/**
 * 是否显示歌曲专辑名称，默认启用
 */
export const showMusicAlbumAtom = atomWithStorage(
	"amll-react-full.showMusicAlbum",
	false,
);

/**
 * 是否显示音量滑块条，默认启用
 */
export const showVolumeControlAtom = atomWithStorage(
	"amll-react-full.showVolumeControl",
	true,
);

/**
 * 是否显示底部控制按钮组，默认启用
 */
export const showBottomControlAtom = atomWithStorage(
	"amll-react-full.showBottomControl",
	true,
);

// ======================== 歌词背景配置 ========================

/**
 * 配置所使用的歌词背景渲染器，默认使用 MeshGradientRenderer
 * 如果是字符串则将其放入背景所属的 CSS 样式中（background 属性内）
 *
 * 由于存储状态特殊，故不使用 atomWithStorage，请另外处理配置存储
 *
 * 性能影响情况：高
 */
export const lyricBackgroundRendererAtom = atom<{
	renderer?: BackgroundRenderProps["renderer"] | string;
}>({ renderer: undefined });

/**
 * 调节背景的最大帧率，默认 60
 *
 * 性能影响情况：高
 */
export const lyricBackgroundFPSAtom = atomWithStorage<
	NonNullable<BackgroundRenderProps["fps"]>
>("amll-react-full.lyricBackgroundFPSAtom", 60);

/**
 * 调节背景的渲染倍率，默认为 1
 *
 * 性能影响情况：高
 */
export const lyricBackgroundRenderScaleAtom = atomWithStorage<
	NonNullable<BackgroundRenderProps["renderScale"]>
>("amll-react-full.lyricBackgroundRenderScaleAtom", 1);

/**
 * 是否启用背景静态模式，即除了切换背景以外的情况都将停止渲染以优化性能，默认禁用
 *
 * 性能影响情况：中
 */
export const lyricBackgroundStaticModeAtom = atomWithStorage<
	NonNullable<BackgroundRenderProps["staticMode"]>
>("amll-react-full.lyricBackgroundStaticModeAtom", false);

// ======================== 应用特有配置 ========================

export const displayLanguageAtom = atomWithStorage(
	"amll-player.displayLanguage",
	"zh-CN",
);
export const darkModeAtom = atomWithStorage(
	"amll-player.darkMode",
	DarkMode.Auto,
);
export const musicContextModeAtom = atomWithStorage(
	"amll-player.musicContextMode",
	MusicContextMode.Local,
);
export const showStatJSFrameAtom = atomWithStorage(
	"amll-player.showStatJSFrame",
	false,
);
export const advanceLyricDynamicLyricTimeAtom = atomWithStorage(
	"amll-player.advanceLyricDynamicLyricTimeAtom",
	false,
);
export const wsProtocolListenAddrAtom = atomWithStorage(
	"amll-player.wsProtocolListenAddr",
	"localhost:11444",
);

// ======================== 音乐动态状态 ========================

export const musicIdAtom = atom("");

/**
 * 当前播放的音乐名称，将会显示在专辑图下方（横向布局）或专辑图右侧（竖向布局）
 */
export const musicNameAtom = atom("未知歌曲");

/**
 * 当前播放的音乐创作者列表，会显示在音乐名称下方
 */
export const musicArtistsAtom = atom<ArtistStateEntry[]>([
	{ name: "未知创作者", id: "unknown" },
]);

/**
 * 当前播放的音乐所属专辑名称，会显示在音乐名称/创作者下方
 */
export const musicAlbumNameAtom = atom("未知专辑");

/**
 * 当前播放的音乐专辑封面 URL，除了图片也可以是视频资源
 */
export const musicCoverAtom = atom("");

/**
 * 当前播放的音乐专辑封面资源是否为视频
 */
export const musicCoverIsVideoAtom = atom(false);

/**
 * 当前音乐的音乐时长，单位为毫秒
 */
export const musicDurationAtom = atom(0);

/**
 * 当前是否正在播放音乐
 */
export const musicPlayingAtom = atom(false);

/**
 * 当前音乐的播放进度，单位为毫秒
 */
export const musicPlayingPositionAtom = atom(0);

/**
 * 当前播放的音乐音量大小，范围在 [0.0-1.0] 之间
 *
 * 本状态将会保存在 localStorage 中
 */
export const musicVolumeAtom = atomWithStorage(
	"amll-react-full.musicVolumeAtom",
	0.5,
);

/**
 * 当前播放的音乐专辑封面 URL，除了图片也可以是视频资源
 */
export const musicLyricLinesAtom = atom<LyricLine[]>([]);

/**
 * 当前音乐的音质水平标签信息，如有提供则会显示在进度条下
 */
export const musicQualityTagAtom = atom<{
	tagIcon: boolean;
	tagText: string;
	isDolbyAtmos: boolean;
} | null>(null);

// ======================== 应用 UI 状态 ========================

export const autoDarkModeAtom = atom(true);
export const isDarkThemeAtom = atom(
	(get) =>
		get(darkModeAtom) === DarkMode.Auto
			? get(autoDarkModeAtom)
			: get(darkModeAtom) === DarkMode.Dark,
	(_get, set, newIsDark: boolean) =>
		set(darkModeAtom, newIsDark ? DarkMode.Dark : DarkMode.Light),
);
export const playlistCardOpenedAtom = atom(false);
export const recordPanelOpenedAtom = atom(false);
export const currentPlaylistAtom = atom<SongData[]>([]);
export const currentPlaylistMusicIndexAtom = atom(0);

/**
 * 当前是否正在展示 AMLL 播放页面，设置为 true 时将会让背景和歌词实时展示动画效果
 * 推荐在页面被隐藏的时候将其设置为 false，这样会减少其对性能的影响（例如暂停背景渲染和歌词行变换等）
 */
export const isLyricPageOpenedAtom = atom(false);

/**
 * 是否隐藏歌词视图
 */
export const hideLyricViewAtom = atomWithStorage(
	"amll-react-full.hideLyricViewAtom",
	false,
);

/**
 * 低频音量大小，范围在 80hz-120hz 之间为宜，取值范围在 [0.0-1.0] 之间
 *
 * 如果无法获取到类似的数据，请传入 undefined 或 1.0 作为默认值，或不做任何处理（默认值即 1.0）
 *
 * 如需呈现音频可视化频谱图，请设置 fftDataAtom 的值
 */
export const lowFreqVolumeAtom = atom<number>(1);

/**
 * 用于音频可视化频谱图的数据
 * 如需呈现背景跳动效果，请设置 lowFreqVolumeAtom 的值
 */
export const fftDataAtom = atom<number[]>([]);

export const amllMenuOpenedAtom = atom(false);
export const hideNowPlayingBarAtom = atom(false);
export const wsProtocolConnectedAddrsAtom = atom(new Set<string>());

// ======================== 回调函数 ========================

export interface Callback<Args extends any[], Result = void> {
	onEmit?: (...args: Args) => Result;
}
const c = <Args extends any[], Result = void>(
	_onEmit: (...args: Args) => Result,
): Callback<Args, Result> => ({});

/**
 * 当点击歌曲专辑图上方的控制横条按钮时触发的回调函数
 */
export const onClickControlThumbAtom = atom(c(() => {}));

/**
 * 当点击音质标签时触发
 */
export const onClickAudioQualityTagAtom = atom(c(() => {}));

/**
 * 当任意企图打开菜单或点击菜单按钮时触发的回调函数
 */
export const onRequestOpenMenuAtom = atom(c(() => {}));

/**
 * 当触发播放或恢复播放时触发的回调函数
 */
export const onPlayOrResumeAtom = atom(c(() => {}));

/**
 * 当触发暂停播放时触发的回调函数
 */
export const onPauseAtom = atom(c(() => {}));

/**
 * 当触发上一首歌曲时触发的回调函数
 */
export const onRequestPrevSongAtom = atom(c(() => {}));

/**
 * 当触发下一首歌曲时触发的回调函数
 */
export const onRequestNextSongAtom = atom(c(() => {}));

/**
 * 当触发设置歌曲播放位置时触发的回调函数
 * @param _position 播放位置，单位为毫秒
 */
export const onSeekPositionAtom = atom(c((_position: number) => {}));

/**
 * 当点击歌词行时触发的回调函数
 * @param _evt 对应的歌词行事件对象
 * @param _playerRef 播放器引用
 */
export const onLyricLineClickAtom = atom(
	c((_evt: LyricLineMouseEvent, _playerRef: LyricPlayerRef | null) => {}),
);

/**
 * 当试图对歌词行打开上下文菜单（例如右键点击）时触发的回调函数
 * @param _evt 对应的歌词行事件对象
 * @param _playerRef 播放器引用
 */
export const onLyricLineContextMenuAtom = atom(
	c((_evt: LyricLineMouseEvent, _playerRef: LyricPlayerRef | null) => {}),
);

/**
 * 当触发设置音量大小时触发的回调函数
 * @param _volume 音量大小，取值范围为 [0-1]
 */
export const onChangeVolumeAtom = atom(c((_volume: number) => {}));

/**
 * 当点击位于控制按钮左侧的按钮时触发的回调函数
 */
export const onClickLeftFunctionButtonAtom = atom(c(() => {}));

/**
 * 当点击位于控制按钮右侧的按钮时触发的回调函数
 */
export const onClickRightFunctionButtonAtom = atom(c(() => {}));

// ======================== SMTC (System Media Transport Controls) 相关状态 ========================

export const smtcSessionsAtom = atom<SmtcSession[]>([]);
export const smtcSelectedSessionIdAtom = atomWithStorage<string | null>(
	"amll-player.smtcSelectedSessionId",
	null,
);
export const audioQualityDialogOpenedAtom = atom(false);
export const smtcTrackIdAtom = atom<string>("");
export const smtcTextConversionModeAtom = atomWithStorage(
	"amll-player.smtcTextConversionMode",
	TextConversionMode.Off,
);
export const smtcShuffleStateAtom = atom<boolean>(false);
export const smtcRepeatModeAtom = atom<RepeatMode>(RepeatMode.Off);

export const onClickSmtcShuffleAtom = atom(null, (get) => {
	const currentShuffle = get(smtcShuffleStateAtom);
	invoke("control_external_media", {
		payload: { type: "setShuffle", is_active: !currentShuffle },
	}).catch(console.error);
});

export const onClickSmtcRepeatAtom = atom(null, (get) => {
	const currentMode = get(smtcRepeatModeAtom);
	const nextMode =
		currentMode === RepeatMode.Off
			? RepeatMode.All
			: currentMode === RepeatMode.All
				? RepeatMode.One
				: RepeatMode.Off;
	invoke("control_external_media", {
		payload: { type: "setRepeatMode", mode: nextMode },
	}).catch(console.error);
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

export const wsLyricOnlyModeAtom = atom<boolean>(false);

export const enableWsLyricsInSmtcModeAtom = atomWithStorage(
	"amll-player.enableWsLyricsInSmtcMode",
	true,
);

export const smtcTimeOffsetAtom = atomWithStorage(
	"amll-player.smtcTimeOffset",
	0,
);

export const correctedMusicPlayingPositionAtom = atom((get) => {
	const originalPosition = get(musicPlayingPositionAtom);
	const mode = get(musicContextModeAtom);

	if (mode === MusicContextMode.SystemListener) {
		const offset = get(smtcTimeOffsetAtom);

		const correctedPosition = originalPosition - offset;

		return Math.max(0, correctedPosition);
	}

	return originalPosition;
});

/**
 * 扩展的加载结果枚举
 */
export enum ExtensionLoadResult {
	Loadable = "loadable",
	Disabled = "disabled",
	InvaildExtensionFile = "invaild-extension-file",
	ExtensionIdConflict = "extension-id-conflict",
	MissingMetadata = "missing-metadata",
	MissingDependency = "missing-dependency",
	JavaScriptFileCorrupted = "javascript-file-corrupted",
}

/**
 * 扩展元数据状态的接口定义
 */
export interface ExtensionMetaState {
	loadResult: ExtensionLoadResult;
	id: string;
	fileName: string;
	scriptData: string;
	dependency: string[];
	[key: string]: string | string[] | undefined;
}

/**
 * 一个用于触发 extensionMetaAtom 重新加载的原子状态
 * （这是一个常见的 Jotai 模式，可以安全移动）
 */
export const reloadExtensionMetaAtom = atom(0);

/**
 * 存储当前已加载并成功运行的扩展实例
 */
export const loadedExtensionAtom = atom<LoadedExtension[]>([]);

export interface ArtistStateEntry {
	name: string;
	id: string;
}
export interface SmtcSession {
	sessionId: string;
	displayName: string;
}

export interface MusicQualityState {
	type: AudioQualityType;
	codec: string;
	channels: number;
	sampleRate: number;
	sampleFormat: string;
}

export const backgroundRendererAtom = atomWithStorage(
	"amll-player.backgroundRenderer",
	"mesh",
);
export interface LoadedExtension {
	extensionMeta: ExtensionMetaState;
	extensionFunc: () => Promise<void>;
	context: PlayerExtensionContext;
}

export const isChechingUpdateAtom = atom(false);
export const updateInfoAtom = atom<Update | false>(false);
export const autoUpdateAtom = atomWithStorage("amll-player.autoUpdate", true);

/**
 * 定义歌词大小的预设值
 */
export const LyricSizePreset = {
	Tiny: "tiny",
	ExtraSmall: "extra-small",
	Small: "small",
	Medium: "medium",
	Large: "large",
	ExtraLarge: "extra-large",
	Huge: "huge",
} as const;

export type LyricSizePresetValue =
	(typeof LyricSizePreset)[keyof typeof LyricSizePreset];

/**
 * 歌词字体大小的预设选项，默认为“中”
 */
export const lyricSizePresetAtom = atomWithStorage<LyricSizePresetValue>(
	"amll-player.lyricSizePreset",
	LyricSizePreset.Medium,
);

export const showRemainingTimeAtom = atomWithStorage("showRemainingTime", true);
