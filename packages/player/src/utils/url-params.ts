/**
 * URL参数处理工具
 */

export interface URLParams {
	music?: string;
	lyric?: string;
	cover?: string;
	title?: string;
	artist?: string;
}

/**
 * 解析URL查询参数
 */
export function parseURLParams(): URLParams {
	const params = new URLSearchParams(window.location.search);
	return {
		music: params.get("music") || undefined,
		lyric: params.get("lyric") || undefined,
		cover: params.get("cover") || undefined,
		title: params.get("title") || undefined,
		artist: params.get("artist") || undefined,
	};
}

/**
 * 从URL加载文件并转换为Blob
 */
export async function loadFileFromURL(url: string): Promise<Blob> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to load file from ${url}: ${response.statusText}`);
	}
	return await response.blob();
}

/**
 * 检查是否有URL参数需要处理
 */
export function hasURLParams(): boolean {
	const params = parseURLParams();
	return !!(params.music || params.lyric || params.cover || params.title || params.artist);
}

