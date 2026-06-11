import { api } from "./api";

/**
 * Agrega un libro suelto: Rust lo copia a la carpeta gestionada y aquí
 * generamos su portada (PDF: render de la primera página; EPUB: portada
 * y metadatos reales del archivo).
 */
export async function ingestWithCover(srcPath: string): Promise<void> {
  const bookId = await api.ingestBook(srcPath);
  const format = srcPath.toLowerCase().endsWith(".epub") ? "epub" : "pdf";
  try {
    const bytes = await api.readBook(bookId);
    if (format === "pdf") {
      await coverFromPdf(bookId, bytes);
    } else {
      await coverAndMetaFromEpub(bookId, bytes);
    }
  } catch (e) {
    // Sin portada no es fatal: el libro queda con placeholder.
    console.warn("No se pudo generar portada/metadatos:", e);
  }
}

async function coverFromPdf(bookId: number, bytes: ArrayBuffer): Promise<void> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 480 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob) await api.saveCover(bookId, await blob.arrayBuffer());
  } finally {
    doc.loadingTask.destroy();
  }
}

async function coverAndMetaFromEpub(
  bookId: number,
  bytes: ArrayBuffer,
): Promise<void> {
  const ePub = (await import("epubjs")).default;
  const book = ePub(bytes);
  try {
    const meta = await book.loaded.metadata;
    if (meta?.title) {
      await api.updateBookMeta(bookId, meta.title, meta.creator ?? "");
    }
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const blob = await (await fetch(coverUrl)).blob();
      await api.saveCover(bookId, await blob.arrayBuffer());
    }
  } finally {
    book.destroy();
  }
}
