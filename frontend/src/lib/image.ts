/**
 * Shrink an oversized image in the browser, before it is uploaded.
 *
 * The Worker refuses images above its ceiling, and a picture straight off a phone is
 * routinely past it. Rather than making the user go and resize the file, the longest
 * side is capped and the image is re-encoded, dropping quality a step at a time until
 * it fits. An image that already fits is handed back untouched.
 */

/** Anything larger than this is more pixels than a model reads anyway. */
const MAX_DIMENSION = 2000;

/** Quality steps to try, in order, before falling back to shrinking the canvas. */
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

/** WebP where the browser has it, JPEG everywhere else. Both are far below PNG. */
function encodeType(): "image/webp" | "image/jpeg" {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL("image/webp").startsWith("data:image/webp")
    ? "image/webp"
    : "image/jpeg";
}

function draw(bitmap: ImageBitmap, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  // A flat white ground: JPEG has no alpha, and transparent pixels otherwise come
  // out black rather than as the page behind them.
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, quality),
  );
}

/**
 * A file that fits `maxBytes`, or the original when it already did and was no larger
 * than the dimension cap. Null means the image could neither be decoded nor squeezed
 * down far enough, and the caller should let the Worker refuse it with its own message.
 */
export async function fitImage(
  file: File,
  maxBytes: number,
): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const capped = Math.min(1, MAX_DIMENSION / longest);
  if (file.size <= maxBytes && capped === 1) {
    bitmap.close();
    return file;
  }

  const type = encodeType();
  const extension = type === "image/webp" ? "webp" : "jpg";
  const name = `${file.name.replace(/\.[^.]+$/, "")}.${extension}`;

  try {
    // Halve the canvas each round, once quality alone has stopped being enough.
    for (let scale = capped; scale >= 0.125; scale /= 2) {
      const canvas = draw(bitmap, scale);
      for (const quality of QUALITY_STEPS) {
        const blob = await toBlob(canvas, type, quality);
        if (blob && blob.size <= maxBytes)
          return new File([blob], name, { type });
      }
    }
  } finally {
    bitmap.close();
  }
  return null;
}
