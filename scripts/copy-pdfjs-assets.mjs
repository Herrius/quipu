// Copia los assets estáticos de pdf.js a public/pdfjs (Vite los sirve en
// dev y los copia verbatim a dist/). Sin los .wasm, los PDFs escaneados en
// JPEG2000/JBIG2 se renderizan EN BLANCO. Se ejecuta antes de dev/build.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["wasm", "iccs", "cmaps", "standard_fonts"]) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log("pdf.js assets → public/pdfjs");
