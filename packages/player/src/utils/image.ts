/**
 * 压缩图片 Blob
 * @param blob 原始图片 Blob
 * @param size 目标尺寸（宽高），默认 1024px
 * @param quality JPEG 质量 (0-1)，默认 0.9
 */
export async function compressCoverImage(
	blob: Blob,
	size = 1024,
	quality = 0.9,
): Promise<Blob> {
	if (blob.size < 500 * 1024) return blob;

	try {
		const bitmap = await createImageBitmap(blob);

		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;

		const ctx = canvas.getContext("2d");
		if (!ctx) return blob;

		ctx.drawImage(bitmap, 0, 0, size, size);

		bitmap.close();

		return new Promise((resolve) => {
			canvas.toBlob(
				(newBlob) => resolve(newBlob || blob),
				"image/jpeg",
				quality,
			);
		});
	} catch (e) {
		console.warn("压缩封面失败，使用原图:", e);
		return blob;
	}
}
