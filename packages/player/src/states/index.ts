import { atom } from "jotai";
import { autoDarkModeAtom, DarkMode, darkModeAtom } from "./appAtoms";

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
