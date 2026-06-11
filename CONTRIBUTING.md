# Contribuir a Quipu

¡Gracias por el interés! Reglas de la casa, cortas:

## Flujo

1. Abre un issue describiendo el bug o la propuesta antes de un PR grande.
2. Haz fork y crea una rama desde `main`: `git checkout -b mi-cambio`.
3. Asegúrate de que pasa todo en local:

```bash
bunx tsc --noEmit
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun run build
```

4. Abre el PR con una descripción clara de qué cambia y por qué.

## Criterios

- **Rust:** clippy sin warnings (`-D warnings` es bloqueante en CI). Los comandos IPC nunca aceptan rutas del frontend — siempre IDs.
- **TypeScript:** sin `any` nuevos; el typecheck debe quedar limpio.
- **Seguridad:** cualquier cambio en `tauri.conf.json` (CSP) o `capabilities/` debe justificarse en el PR. Principio: el webview no toca el filesystem.
- **Acciones destructivas** (borrar libros, notas, archivos): siempre con diálogo de advertencia que explique exactamente qué se pierde.
- **UI:** en español, consistente con el tema existente (variables CSS en `App.css`).
- Mantén los PRs enfocados: una cosa por PR.

## Reportar bugs

Incluye: SO (distro/versión de Windows), pasos para reproducir, y si es con un archivo concreto, el formato (PDF/EPUB) y qué app lo generó si lo sabes. Los logs en Linux: lanza `quipu` desde terminal y copia la salida.

## Seguridad

Si encuentras una vulnerabilidad, **no abras un issue público**: escribe al correo del autor (ver perfil de GitHub).
