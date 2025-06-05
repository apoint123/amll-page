import {
	CanvasLyricPlayer,
	DomLyricPlayer,
	DomSlimLyricPlayer,
	LyricPlayer,
	MeshGradientRenderer,
	PixiRenderer,
} from "@applemusic-like-lyrics/core";
import {
	PrebuiltLyricPlayer,
	isLyricPageOpenedAtom,
	lyricBackgroundRendererAtom,
	lyricPlayerImplementationAtom as lyricPlayerImplementationConstructorAtom,
} from "@applemusic-like-lyrics/react-full";
import { ContextMenu } from "@radix-ui/themes";
import classnames from "classnames";
import { useAtomValue, useSetAtom } from "jotai";
import { type FC, useLayoutEffect } from "react";
import {
	LyricPlayerImplementation,
	backgroundRendererAtom,
	cssBackgroundPropertyAtom,
	lyricPlayerImplementationAtom,
} from "../../states/index.ts";
import { AMLLContextMenuContent } from "../AMLLContextMenu/index.tsx";
import { AudioQualityDialog } from "../AudioQualityDialog/index.tsx";
import styles from "./index.module.css";
import { RecordPanel } from "../RecordPanel/index.tsx";

export const AMLLWrapper: FC = () => {
	const isLyricPageOpened = useAtomValue(isLyricPageOpenedAtom);
	const backgroundRenderer = useAtomValue(backgroundRendererAtom);
	const cssBackgroundProperty = useAtomValue(cssBackgroundPropertyAtom);
	const lyricPlayerImplementation = useAtomValue(lyricPlayerImplementationAtom);
	const setBackgroundRenderer = useSetAtom(lyricBackgroundRendererAtom);
	const setLyricPlayerImplementation = useSetAtom(
		lyricPlayerImplementationConstructorAtom,
	);

	useLayoutEffect(() => {
		if (isLyricPageOpened) {
			document.body.dataset.amllLyricsOpen = "";
			setSystemTitlebarImmersiveMode(true);
		} else {
			delete document.body.dataset.amllLyricsOpen;
			setSystemTitlebarImmersiveMode(false);
		}
	}, [isLyricPageOpened]);

	useLayoutEffect(() => {
		switch (backgroundRenderer) {
			case "pixi":
				setBackgroundRenderer({
					renderer: PixiRenderer,
				});
				break;
			case "mesh":
				setBackgroundRenderer({
					renderer: MeshGradientRenderer,
				});
				break;
			default:
				setBackgroundRenderer({
					renderer: cssBackgroundProperty,
				});
				break;
		}
	}, [backgroundRenderer, cssBackgroundProperty, setBackgroundRenderer]);

	useLayoutEffect(() => {
		switch (lyricPlayerImplementation) {
			case LyricPlayerImplementation.Dom:
				setLyricPlayerImplementation({
					lyricPlayer: DomLyricPlayer,
				});
				break;
			case LyricPlayerImplementation.DomSlim:
				setLyricPlayerImplementation({
					lyricPlayer: DomSlimLyricPlayer,
				});
				break;
			case LyricPlayerImplementation.Canvas:
				setLyricPlayerImplementation({
					lyricPlayer: CanvasLyricPlayer,
				});
				break;
			default:
				setLyricPlayerImplementation({
					lyricPlayer: LyricPlayer,
				});
				break;
		}
	}, [lyricPlayerImplementation, setLyricPlayerImplementation]);

	return (
		<>
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					<PrebuiltLyricPlayer
						id="amll-lyric-player"
						className={classnames(
							styles.lyricPage,
							isLyricPageOpened && styles.opened,
						)}
					/>
				</ContextMenu.Trigger>
				<AMLLContextMenuContent />
			</ContextMenu.Root>
			<AudioQualityDialog />
			<RecordPanel />
		</>
	);
};

export default AMLLWrapper;
