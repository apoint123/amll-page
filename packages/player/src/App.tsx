import { Box, Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import classNames from "classnames";
import { atom, useAtomValue } from "jotai";
import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { RouterProvider } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import styles from "./App.module.css";
import { AppContainer } from "./components/AppContainer/index.tsx";
import { LocalMusicContext } from "./components/LocalMusicContext/index.tsx";
import { NowPlayingBar } from "./components/NowPlayingBar/index.tsx";
import "./i18n";
import {
	isLyricPageOpenedAtom,
	LyricSizePreset,
	lyricSizePresetAtom,
} from "@applemusic-like-lyrics/react-full";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { StateConnector } from "./components/StateConnector/index.tsx";
import { StatsComponent } from "./components/StatsComponent/index.tsx";
import { URLParamsHandler } from "./components/URLParamsHandler/index.tsx";
import { router } from "./router.tsx";
import {
	displayLanguageAtom,
	isDarkThemeAtom,
	MusicContextMode,
	musicContextModeAtom,
	showStatJSFrameAtom,
} from "./states/appAtoms.ts";
import { ensureLoaded } from "./utils/parseTTML.ts";

const AMLLWrapper = lazy(() => import("./components/AMLLWrapper"));

const hasBackgroundAtom = atom(false);

function App() {
	const isLyricPageOpened = useAtomValue(isLyricPageOpenedAtom);
	const showStatJSFrame = useAtomValue(showStatJSFrameAtom);
	const musicContextMode = useAtomValue(musicContextModeAtom);
	const displayLanguage = useAtomValue(displayLanguageAtom);
	const isDarkTheme = useAtomValue(isDarkThemeAtom);
	const hasBackground = useAtomValue(hasBackgroundAtom);
	const { i18n } = useTranslation();

	const lyricSize = useAtomValue(lyricSizePresetAtom);

	useLayoutEffect(() => {
		console.log("displayLanguage", displayLanguage, i18n);
		i18n.changeLanguage(displayLanguage);
	}, [i18n, displayLanguage]);

	useEffect(() => {
		let fontSizeFormula = "";
		switch (lyricSize) {
			case LyricSizePreset.Tiny:
				fontSizeFormula = "max(max(2.5vh, 1.25vw), 10px)";
				break;
			case LyricSizePreset.ExtraSmall:
				fontSizeFormula = "max(max(3vh, 1.5vw), 10px)";
				break;
			case LyricSizePreset.Small:
				fontSizeFormula = "max(max(4vh, 2vw), 12px)";
				break;
			case LyricSizePreset.Large:
				fontSizeFormula = "max(max(6vh, 3vw), 16px)";
				break;
			case LyricSizePreset.ExtraLarge:
				fontSizeFormula = "max(max(7vh, 3.5vw), 18px)";
				break;
			case LyricSizePreset.Huge:
				fontSizeFormula = "max(max(8vh, 4vw), 20px)";
				break;
			default:
				fontSizeFormula = "max(max(5vh, 2.5vw), 14px)";
				break;
		}

		const styleId = "amll-font-size-style";
		let styleTag = document.getElementById(styleId);

		if (!styleTag) {
			styleTag = document.createElement("style");
			styleTag.id = styleId;
			document.head.appendChild(styleTag);
		}

		styleTag.innerHTML = `
            .amll-lyric-player {
                font-size: ${fontSizeFormula} !important;
            }
        `;
	}, [lyricSize]);

	ensureLoaded().catch((e) => console.error("WASM Preload Failed", e));

	return (
		<>
			{/* 上下文组件均不建议被 StrictMode 包含，以免重复加载扩展程序发生问题  */}
			{showStatJSFrame && <StatsComponent />}
			{musicContextMode === MusicContextMode.Local && (
				<LocalMusicContext key={MusicContextMode.Local} />
			)}

			<URLParamsHandler />
			<StateConnector />
			<SpeedInsights />
			<Analytics />

			<StrictMode>
				<Theme
					appearance={isDarkTheme ? "dark" : "light"}
					panelBackground="solid"
					hasBackground={hasBackground}
					className={styles.radixTheme}
				>
					<Box
						className={classNames(
							styles.body,
							isLyricPageOpened && styles.amllOpened,
						)}
					>
						<AppContainer playbar={<NowPlayingBar />}>
							<RouterProvider router={router} />
						</AppContainer>
					</Box>
					<Suspense>
						<AMLLWrapper />
					</Suspense>
					<ToastContainer
						theme="dark"
						position="bottom-right"
						style={{
							marginBottom: "150px",
						}}
					/>
				</Theme>
			</StrictMode>
		</>
	);
}

export default App;
