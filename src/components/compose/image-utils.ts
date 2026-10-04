const INLINE_IMAGE_MAX_EDGE = 1600;
const INLINE_IMAGE_KEEP_BYTES = 1_500_000;

export function isImageFile(file: File): boolean {
	return file.type.startsWith("image/");
}

function drawToJpegFile(bitmap: ImageBitmap, scale: number, name: string): Promise<File | null> {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const context = canvas.getContext("2d");
	if (!context) return Promise.resolve(null);
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return new Promise((resolve) => {
		canvas.toBlob(
			(blob) => {
				resolve(blob ? new File([blob], `${name}.jpg`, { type: "image/jpeg" }) : null);
			},
			"image/jpeg",
			0.85,
		);
	});
}

/**
 * Pasted screenshots are often a few megabytes, and embedded images must fit
 * inside the message itself (they cannot fall back to download links), so
 * shrink anything oversized before it reaches the draft.
 */
export async function maybeDownscaleImage(file: File): Promise<File> {
	if (!isImageFile(file) || file.type === "image/gif" || file.size <= INLINE_IMAGE_KEEP_BYTES) return file;
	const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
	try {
		const bitmap = await createImageBitmap(file);
		try {
			const longestEdge = Math.max(bitmap.width, bitmap.height);
			const scale = longestEdge > INLINE_IMAGE_MAX_EDGE ? INLINE_IMAGE_MAX_EDGE / longestEdge : 1;
			const scaled = await drawToJpegFile(bitmap, scale, baseName);
			return scaled && scaled.size < file.size ? scaled : file;
		} finally {
			bitmap.close();
		}
	} catch {
		return file;
	}
}

/** Drop <img> tags whose blob: source died with a previous session. */
export function stripDeadInlineImages(html: string): string {
	return html.replace(/<img\b[^>]*\ssrc="blob:[^"]*"[^>]*>/gi, "");
}

export type InlineImageSource = { src: string; contentId: string | null };

export function draftAttachmentUrl(draftId: string, attachmentId: string): string {
	return `/api/drafts/${draftId}/attachments/${attachmentId}`;
}

/** Point every draft-attachment or blob source at its cid: reference for sending. */
export function rewriteInlineImageSources(html: string, sources: InlineImageSource[]): string {
	let result = html;
	for (const source of sources) {
		if (!source.contentId) continue;
		const cid = source.contentId.replace(/^<|>$/g, "");
		result = result.replaceAll(`src="${source.src}"`, `src="cid:${cid}"`);
	}
	return result;
}

/** The inverse: turn cid: references into URLs the editor and reader can fetch. */
export function resolveInlineImageSources(html: string, sources: InlineImageSource[]): string {
	let result = html;
	for (const source of sources) {
		if (!source.contentId) continue;
		const cid = source.contentId.replace(/^<|>$/g, "");
		result = result.replaceAll(`cid:${cid}`, source.src);
	}
	return result;
}
