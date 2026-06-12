<div align="center">

# 📚 Quipu

**Biblioteca y lector personal de PDF/EPUB para escritorio.**
Ligero, sin nube, y con tus subrayados exportados directo a Obsidian.

[![CI](https://github.com/Herrius/quipu/actions/workflows/ci.yml/badge.svg)](https://github.com/Herrius/quipu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-e0a458.svg)](LICENSE)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-backend-CE412B?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Plataformas](https://img.shields.io/badge/Linux%20%C2%B7%20Windows%2010%2B-soportados-7cb87c)

<img src="docs/captura-biblioteca.webp" alt="Biblioteca de Quipu: grid de portadas con búsqueda, filtros por estado, progreso y puntuación" width="850">

*Un quipu era el sistema inca de registro con cuerdas anudadas: memoria externa, portátil y personal. Eso mismo.*

</div>

---

## ¿Por qué?

Calibre es un excelente gestor, pero como *lector* se queda corto: no retoma la página donde quedaste, la interfaz no invita a leer y tomar notas es incómodo. Quipu es lo contrario: una app mínima centrada en **leer** — abre tu biblioteca, sigue exactamente donde ibas, y lo que subrayas termina en tu vault de Obsidian sin fricción.

## ✨ Funciones

- **📖 Retoma donde quedaste** — página exacta en PDF, posición CFI en EPUB, guardado automático.
- **🖼️ Biblioteca visual** — grid de portadas, búsqueda por título/autor, ordenada por último leído.
- **📥 Importa desde Calibre** — lee `metadata.db` en *solo lectura*; no copia ni toca tus archivos.
- **➕ Agrega libros sueltos** — PDF/EPUB con portada automática (render de la 1.ª página o portada del EPUB) y metadatos reales.
- **✏️ Subrayados → Obsidian** — selecciona texto en PDF o EPUB y se exporta a **un archivo markdown por libro**, con frontmatter (estado, puntuación) listo para Dataview.
- **🔖 Marcadores manuales** — panel lateral para saltar a cualquier marcador o subrayado.
- **📊 Estados y puntuación** — por leer / leyendo / leído (con filtros) y rating de 1-5 estrellas.
- **⚡ Modo lector enfocado (RSVP)** — una palabra a la vez con punto de fijación, 100-900 ppm, tema claro/oscuro, pausas naturales en la puntuación.
- **🗑️ Gestión segura** — quitar libros (individual o selección múltiple) y vaciar notas, siempre con advertencia previa; los archivos de Calibre **nunca** se tocan.
- **🔄 Sincronización entre PCs** — progreso, estados, puntuaciones y notas viajan en un `quipu-sync.json` dentro de la carpeta de tu biblioteca: si esa carpeta ya se sincroniza por tu nube (Drive, MEGA, Syncthing…), retomas en otra máquina donde quedaste. Merge por libro y dominio, gana el cambio más reciente.
- **🌙 Lectura cómoda** — tema oscuro, zoom y ajuste al ancho en PDF; temas dark/sepia/light y tamaño de letra en EPUB.

## 🚀 Instalación

Guía completa en **[INSTALL.md](INSTALL.md)**. Resumen:

```bash
# Linux (Arch y derivados) — instalación de usuario, sin sudo
git clone https://github.com/Herrius/quipu && cd quipu
bun install
bun run tauri build
./install.sh          # binario + lanzador del menú + icono
```

Windows 10+: instalador `.msi` generado por el [workflow de release](.github/workflows/release.yml) en cada tag `v*` (o compila con `bun run tauri build`).

**Requisitos de desarrollo:** [Rust](https://rustup.rs) estable · [Bun](https://bun.sh) · en Linux: `webkit2gtk-4.1`.

## 🛠️ Desarrollo

```bash
bun install
bun run tauri dev                                            # app en caliente
bunx tsc --noEmit                                            # typecheck
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml              # tests Rust
```

## 🏗️ Arquitectura

```
┌──────────────────────────── webview (sin acceso a FS) ───────┐
│  React + TS · pdf.js (text layer) · epub.js · modo RSVP      │
└──────────────△────────────────────────────△─────────────────┘
        IPC por ID de libro          IPC binario (covers)
┌──────────────▽────────────────────────────▽─────────────────┐
│  Rust: SQLite (libros, progreso, notas) · importador Calibre │
│  exportador markdown → vault Obsidian · archivos gestionados │
└──────────────────────────────────────────────────────────────┘
```

- Estado en SQLite (`$APP_DATA/quipu.db`) con migraciones por `PRAGMA user_version`.
- Los libros **no se copian** al importar de Calibre: se referencian. Los agregados con «＋ Agregar» sí se gestionan en `$APP_DATA/libros/`.
- El archivo de subrayados se **regenera completo** en cada cambio: la app es la fuente de verdad.

## 🔒 Seguridad

La superficie de ataque real de un lector es el parsing de documentos no confiables. Mitigaciones:

- El webview **no tiene acceso al filesystem**: pide libros por ID y Rust solo sirve rutas ya registradas (sin path traversal). Capability mínima de Tauri (`core:default` + diálogos).
- CSP estricta (sin `eval` ni orígenes remotos) y EPUB con `allowScriptedContent: false`.
- CI con Semgrep (SAST), cargo-audit (RustSec), `bun audit`, Gitleaks y Dependabot; SBOM (SPDX) adjunta a cada release.

## 🤝 Contribuir

Issues y PRs bienvenidos — ver **[CONTRIBUTING.md](CONTRIBUTING.md)**. El CI exige `clippy -D warnings`, typecheck limpio y tests en verde.

## 📄 Licencia

[MIT](LICENSE) © 2026 Enrique Ubaldo
