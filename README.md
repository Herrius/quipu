# Quipu

Biblioteca y lector personal de PDF/EPUB. Reemplazo de Calibre como *lector*: interfaz limpia, retoma exactamente donde te quedaste, y modo de lectura cómodo. Multiplataforma: Arch Linux y Windows 10+.

> Un quipu era el sistema inca de registro con cuerdas anudadas: memoria externa, portátil y personal. Eso mismo.

## Stack

- **Tauri 2** — shell nativo (WebView2 en Windows, WebKitGTK en Linux), binario liviano
- **Rust** — backend: SQLite propio, importador de Calibre, IPC binario
- **React + TypeScript + Vite** — UI (bun como package manager)
- **pdf.js** — render de PDF (scroll continuo, render perezoso por página)
- **epub.js** — render de EPUB (paginado, temas, tamaño de letra)

## Desarrollo

```bash
bun install
bun run tauri dev      # app en modo desarrollo
bunx tsc --noEmit      # typecheck
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
bun run tauri build    # binario de producción
```

## Arquitectura

- La app guarda su estado en SQLite (`$APP_DATA/quipu.db`): libros, progreso de lectura (página o CFI por libro), settings.
- **Importador de Calibre**: lee `metadata.db` en modo *solo lectura* (nunca escribe en la DB de Calibre) y registra título, autores, formato, portada y ruta del archivo. Si un libro tiene EPUB y PDF, prefiere EPUB.
- Los archivos del libro **no se copian**: se leen desde la biblioteca de Calibre vía comando IPC.

## Modelo de amenaza (resumen)

La superficie de ataque real de un lector es el **parsing de documentos no confiables** (PDF/EPUB descargados de cualquier lado). Mitigaciones:

- El render ocurre en el webview **sin acceso al filesystem**: la capability de Tauri solo permite IPC propio + diálogo de carpeta (`dialog:allow-open`).
- El frontend nunca maneja rutas: pide libros por **ID**, y Rust solo sirve archivos cuya ruta ya está registrada en la DB (no hay path traversal).
- CSP estricta (sin `eval`, sin orígenes remotos; `blob:`/`data:` solo donde pdf.js/epub.js lo requieren).
- EPUB con `allowScriptedContent: false`.
- CI: Semgrep (SAST), cargo-audit (RustSec), `bun audit`, Gitleaks (secretos), Dependabot, SBOM (SPDX) adjunta a cada release.

## Release

Tag `v*` → GitHub Actions compila Linux (`.deb`/`.rpm`/AppImage) y Windows (`.msi`/NSIS), crea release draft con artefactos + SBOM.
