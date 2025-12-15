import {
	isRepeatEnabledAtom,
	isShuffleActiveAtom,
	isShuffleEnabledAtom,
	onCycleRepeatModeAtom,
	onToggleShuffleAtom,
} from "@applemusic-like-lyrics/react-full";

import { useAtom, useSetAtom, useStore } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MusicContextMode, musicContextModeAtom } from "../../states/appAtoms";
export const StateConnector = () => {
	const store = useStore();
	const { t } = useTranslation();
	const [mode] = useAtom(musicContextModeAtom);

	const setUiIsShuffleActive = useSetAtom(isShuffleActiveAtom);
	const setUiShuffleEnabled = useSetAtom(isShuffleEnabledAtom);
	const setUiRepeatEnabled = useSetAtom(isRepeatEnabledAtom);

	const setOnToggleShuffle = useSetAtom(onToggleShuffleAtom);
	const setOnCycleRepeat = useSetAtom(onCycleRepeatModeAtom);

	useEffect(() => {
		const isSmtcMode = mode === MusicContextMode.SystemListener;

		if (isSmtcMode) {
			setUiShuffleEnabled(true);
			setUiRepeatEnabled(true);
		}

		return () => {
			if (!isSmtcMode) {
				const doNothing = { onEmit: () => {} };
				setOnToggleShuffle(doNothing);
				setOnCycleRepeat(doNothing);
			}
		};
	}, [
		mode,
		setUiIsShuffleActive,
		setUiShuffleEnabled,
		setUiRepeatEnabled,
		setOnToggleShuffle,
		setOnCycleRepeat,
		store,
		t,
	]);

	return null;
};
