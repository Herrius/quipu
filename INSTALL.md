# Instalar, abrir y desinstalar Quipu

## Linux (Arch y derivados)

### Instalar

```bash
cd /ruta/al/repo/quipu
bun install                 # solo la primera vez
bun run tauri build         # compila el binario optimizado
./install.sh                # instala para tu usuario (sin sudo)
```

El script copia el binario a `~/.local/bin/quipu`, crea el lanzador del menú
(`~/.local/share/applications/quipu.desktop`) y el icono. No toca nada del
sistema ni pide root.

### Abrir

- **Menú de aplicaciones**: busca **«Quipu»** (sale como cualquier otra app;
  puedes anclarla al dock/barra de favoritos desde ahí).
- **Terminal**: `quipu` (si `~/.local/bin` está en tu `PATH`) o
  `~/.local/bin/quipu`.

### Actualizar

Tras cambiar el código: `bun run tauri build && ./install.sh` (reinstala el
binario nuevo encima; el lanzador no cambia).

### Desinstalar

```bash
./install.sh uninstall
```

Quita binario, lanzador e icono. **Tus datos no se borran**: biblioteca,
progreso de lectura, subrayados y marcadores viven en
`~/.local/share/com.enrique.quipu/` (la copia de los libros agregados con
«＋ Agregar» está en su subcarpeta `libros/`). Para borrarlos también:

```bash
rm -rf ~/.local/share/com.enrique.quipu
```

Los archivos de tu biblioteca de **Calibre nunca se tocan**, y los subrayados
ya exportados a tu vault de Obsidian se quedan donde están.

## Windows 10/11

1. Compila en Windows (`bun run tauri build`) o descarga el `.msi` del release
   de GitHub (cuando el repo esté publicado, cada tag `v*` genera instaladores
   de Windows automáticamente).
2. Doble clic al `.msi` → siguiente, siguiente. Quipu aparece en el menú
   Inicio como cualquier programa.
3. **Desinstalar**: Configuración → Aplicaciones → Quipu → Desinstalar.
   Los datos quedan en `%APPDATA%\com.enrique.quipu` por si quieres borrarlos.

> Requisito: WebView2 (Windows 10 reciente y Windows 11 ya lo traen; si no,
> el instalador lo descarga solo).

## Dónde vive cada cosa

| Qué | Dónde |
|-----|-------|
| Binario instalado | `~/.local/bin/quipu` |
| Lanzador del menú | `~/.local/share/applications/quipu.desktop` |
| Base de datos (libros, progreso, notas) | `~/.local/share/com.enrique.quipu/quipu.db` |
| Libros agregados con «＋ Agregar» | `~/.local/share/com.enrique.quipu/libros/` |
| Portadas generadas | `~/.local/share/com.enrique.quipu/covers/` |
| Subrayados exportados | la carpeta de Obsidian que elegiste (botón 📁) |
