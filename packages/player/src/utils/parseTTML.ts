import type { TTMLLyric } from "@applemusic-like-lyrics/lyric";
import { init, parse_ttml } from "@lyrics-helper-rs/ttml-processor";

let isLoaded = false;
let initPromise: Promise<void> | null = null;

export async function ensureLoaded(): Promise<void> {
	if (isLoaded) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			init();
			isLoaded = true;
		} catch (error) {
			console.error("❌ [parseTTML] WASM 初始化失败", error);
			isLoaded = false;
			initPromise = null;
			throw error;
		}
	})();

	return initPromise;
}

export function parseTTML(ttmlContent: string): TTMLLyric {
	if (!isLoaded) {
		console.error(
			"❌ [parseTTML] parseTTML 被调用但 WASM 尚未加载！请确保调用了 ensureLoaded()",
		);
		throw new Error("WASM not loaded");
	}

	return parse_ttml(ttmlContent);
}
