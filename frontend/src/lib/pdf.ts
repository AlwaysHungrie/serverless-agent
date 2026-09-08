/**
 * First-page renders for the PDF file card. The work happens in the browser: the
 * Worker deliberately keeps a PDF parser out of the upload path, and pdf.js is far
 * too large to sit in the first load, so it is imported only when a PDF is picked.
 */

/** Card width at 2x, which is as much detail as the card can show. */
const THUMBNAIL_WIDTH = 536;

/**
 * Render page one of a PDF to a PNG. Returns null when the file cannot be read —
 * an encrypted or malformed PDF still uploads, its card just falls back to a name.
 */
export async function pdfThumbnail(file: File): Promise<File | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    // The worker ships beside the library; bundling it as a URL keeps it on the same
    // origin, so no CDN and no cross-origin worker rules come into it.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    });

    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: THUMBNAIL_WIDTH / base.width,
      });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      // A page's own background is transparent; the card wants paper, not the bubble
      // showing through the letterforms.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      return blob ? new File([blob], "thumb.png", { type: "image/png" }) : null;
    } finally {
      // Frees the pdf.js worker: one render per pick, not one worker per PDF held
      // open for the life of the page.
      await task.destroy();
    }
  } catch {
    return null;
  }
}
