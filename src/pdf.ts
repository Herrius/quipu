import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Abre un PDF con los assets estáticos de pdf.js configurados (copiados por
 * vite-plugin-static-copy a /pdfjs/). Sin wasmUrl, los escaneos en JPEG2000
 * (JPXDecode) y JBIG2 se renderizan EN BLANCO: el decodificador es WASM.
 */
export function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: new Uint8Array(bytes),
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
}

export { pdfjs };
