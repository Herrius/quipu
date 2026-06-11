use crate::{calibre, db, export, AppState};
use serde::Serialize;
use std::path::Path;
use tauri::ipc::Response;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub authors: String,
    pub format: String,
    pub has_cover: bool,
    pub percent: f64,
    pub location: Option<String>,
    pub last_read: Option<String>,
    pub status: String,
    pub rating: Option<i64>,
    pub managed: bool,
}

#[derive(Debug, Serialize)]
pub struct Highlight {
    pub id: i64,
    pub location: String,
    pub page: Option<i64>,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct Bookmark {
    pub id: i64,
    pub location: String,
    pub page: Option<i64>,
    pub created_at: String,
}

/// Lee un archivo SOLO si su ruta está registrada en nuestra DB.
/// El frontend nunca pasa rutas, solo IDs: no hay path traversal posible.
fn registered_path(
    state: &State<AppState>,
    book_id: i64,
    column: &str,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let sql = match column {
        "cover" => "SELECT cover_path FROM books WHERE id = ?1",
        _ => "SELECT path FROM books WHERE id = ?1",
    };
    let path: Option<String> = conn
        .query_row(sql, [book_id], |row| row.get(0))
        .map_err(|_| format!("Libro {book_id} no encontrado"))?;
    path.ok_or_else(|| "El libro no tiene ese archivo".to_string())
}

#[tauri::command]
pub fn detect_calibre_library() -> Option<String> {
    calibre::detect_library()
}

#[tauri::command]
pub fn import_calibre(
    state: State<AppState>,
    library_path: String,
) -> Result<calibre::ImportResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result = calibre::import(&conn, &library_path)?;
    db::set_setting(&conn, "calibre_library", &library_path).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn list_books(state: State<AppState>) -> Result<Vec<Book>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.title, b.authors, b.format,
                    b.cover_path IS NOT NULL,
                    COALESCE(p.percent, 0), p.location, p.updated_at,
                    b.status, b.rating, b.managed
             FROM books b
             LEFT JOIN progress p ON p.book_id = b.id
             ORDER BY p.updated_at DESC NULLS LAST, b.title COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let books = stmt
        .query_map([], |row| {
            Ok(Book {
                id: row.get(0)?,
                title: row.get(1)?,
                authors: row.get(2)?,
                format: row.get(3)?,
                has_cover: row.get(4)?,
                percent: row.get(5)?,
                location: row.get(6)?,
                last_read: row.get(7)?,
                status: row.get(8)?,
                rating: row.get(9)?,
                managed: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(books)
}

#[tauri::command]
pub fn read_book(state: State<AppState>, book_id: i64) -> Result<Response, String> {
    let path = registered_path(&state, book_id, "path")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer {path}: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn read_cover(state: State<AppState>, book_id: i64) -> Result<Response, String> {
    let path = registered_path(&state, book_id, "cover")?;
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer {path}: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn save_progress(
    state: State<AppState>,
    book_id: i64,
    location: String,
    percent: f64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO progress (book_id, location, percent, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(book_id) DO UPDATE SET
             location = excluded.location,
             percent = excluded.percent,
             updated_at = excluded.updated_at",
        rusqlite::params![book_id, location, percent],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_calibre_library(state: State<AppState>) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_setting(&conn, "calibre_library"))
}

#[tauri::command]
pub fn set_status(state: State<AppState>, book_id: i64, status: String) -> Result<(), String> {
    if !["por_leer", "leyendo", "leido"].contains(&status.as_str()) {
        return Err(format!("Estado inválido: {status}"));
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET status = ?2 WHERE id = ?1",
        rusqlite::params![book_id, status],
    )
    .map_err(|e| e.to_string())?;
    // Refleja el cambio en el frontmatter del archivo del vault si ya existe.
    let _ = export::export_book(&conn, book_id);
    Ok(())
}

#[tauri::command]
pub fn set_rating(
    state: State<AppState>,
    book_id: i64,
    rating: Option<i64>,
) -> Result<(), String> {
    if let Some(r) = rating {
        if !(1..=5).contains(&r) {
            return Err(format!("Puntuación inválida: {r}"));
        }
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET rating = ?2 WHERE id = ?1",
        rusqlite::params![book_id, rating],
    )
    .map_err(|e| e.to_string())?;
    let _ = export::export_book(&conn, book_id);
    Ok(())
}

#[tauri::command]
pub fn add_highlight(
    state: State<AppState>,
    book_id: i64,
    location: String,
    page: Option<i64>,
    text: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    // Validar la carpeta ANTES de insertar: si falta, el frontend la pide
    // y reintenta sin dejar un subrayado duplicado.
    db::get_setting(&conn, "export_dir").ok_or(export::NO_DIR_MSG)?;
    conn.execute(
        "INSERT INTO highlights (book_id, location, page, text) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![book_id, location, page, text.trim()],
    )
    .map_err(|e| e.to_string())?;
    export::export_book(&conn, book_id)?;
    Ok(())
}

#[tauri::command]
pub fn list_highlights(state: State<AppState>, book_id: i64) -> Result<Vec<Highlight>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, location, page, text, created_at FROM highlights
             WHERE book_id = ?1 ORDER BY COALESCE(page, 999999), created_at",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([book_id], |row| {
            Ok(Highlight {
                id: row.get(0)?,
                location: row.get(1)?,
                page: row.get(2)?,
                text: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn delete_highlight(state: State<AppState>, highlight_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let book_id: i64 = conn
        .query_row(
            "SELECT book_id FROM highlights WHERE id = ?1",
            [highlight_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM highlights WHERE id = ?1", [highlight_id])
        .map_err(|e| e.to_string())?;
    let _ = export::export_book(&conn, book_id);
    Ok(())
}

#[tauri::command]
pub fn add_bookmark(
    state: State<AppState>,
    book_id: i64,
    location: String,
    page: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO bookmarks (book_id, location, page) VALUES (?1, ?2, ?3)",
        rusqlite::params![book_id, location, page],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_bookmarks(state: State<AppState>, book_id: i64) -> Result<Vec<Bookmark>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, location, page, created_at FROM bookmarks
             WHERE book_id = ?1 ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([book_id], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                location: row.get(1)?,
                page: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn delete_bookmark(state: State<AppState>, bookmark_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", [bookmark_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_export_dir(state: State<AppState>) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_setting(&conn, "export_dir"))
}

#[tauri::command]
pub fn set_export_dir(state: State<AppState>, path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("No es una carpeta válida: {path}"));
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "export_dir", &path).map_err(|e| e.to_string())
}

/// Borra TODOS los subrayados y marcadores del libro y elimina su archivo
/// de notas del vault. Irreversible: el frontend confirma antes de llamar.
#[tauri::command]
pub fn delete_book_notes(state: State<AppState>, book_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(path) = export::notes_file_path(&conn, book_id) {
        let _ = std::fs::remove_file(path);
    }
    conn.execute("DELETE FROM highlights WHERE book_id = ?1", [book_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bookmarks WHERE book_id = ?1", [book_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Quita el libro de la biblioteca: progreso, notas y archivo del vault.
/// Solo borra el archivo del libro (y su portada) si lo gestiona Quipu
/// (managed = 1); los archivos de la biblioteca de Calibre nunca se tocan.
#[tauri::command]
pub fn remove_book(state: State<AppState>, book_id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(path) = export::notes_file_path(&conn, book_id) {
        let _ = std::fs::remove_file(path);
    }
    let (path, cover, managed): (String, Option<String>, bool) = conn
        .query_row(
            "SELECT path, cover_path, managed FROM books WHERE id = ?1",
            [book_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    if managed {
        let _ = std::fs::remove_file(&path);
        if let Some(c) = cover {
            let _ = std::fs::remove_file(c);
        }
        if let Some(dir) = Path::new(&path).parent() {
            let _ = std::fs::remove_dir(dir); // solo si quedó vacía
        }
    }
    conn.execute("DELETE FROM books WHERE id = ?1", [book_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Agrega un libro suelto: lo copia a la carpeta gestionada por Quipu
/// (`$APP_DATA/libros/{título}/`) y lo registra. Devuelve el id.
#[tauri::command]
pub fn ingest_book(
    app: tauri::AppHandle,
    state: State<AppState>,
    src_path: String,
) -> Result<i64, String> {
    let src = Path::new(&src_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or("El archivo no tiene extensión")?;
    if ext != "pdf" && ext != "epub" {
        return Err(format!("Formato no soportado: .{ext} (solo PDF o EPUB)"));
    }
    if !src.is_file() {
        return Err(format!("No existe el archivo: {src_path}"));
    }

    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Sin título".into());
    let title = export::sanitize(&stem.replace('_', " "));

    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("libros");

    // Evitar pisar otro libro con el mismo nombre de archivo.
    let mut dir = base.join(&title);
    let mut n = 1;
    let mut dest = dir.join(format!("{title}.{ext}"));
    while dest.exists() && dest != src {
        n += 1;
        dir = base.join(format!("{title} ({n})"));
        dest = dir.join(format!("{title}.{ext}"));
    }

    if dest != src {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::copy(src, &dest).map_err(|e| format!("No se pudo copiar: {e}"))?;
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO books (title, authors, path, format, managed)
         VALUES (?1, '', ?2, ?3, 1)
         ON CONFLICT(path) DO NOTHING",
        rusqlite::params![title, dest.to_string_lossy(), ext],
    )
    .map_err(|e| e.to_string())?;
    let id: i64 = conn
        .query_row(
            "SELECT id FROM books WHERE path = ?1",
            [dest.to_string_lossy()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Guarda la portada (JPEG crudo en el body) generada por el frontend.
#[tauri::command]
pub fn save_cover(
    app: tauri::AppHandle,
    state: State<AppState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let book_id: i64 = request
        .headers()
        .get("book-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or("Falta el header book-id")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Se esperaba un body binario".into());
    };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{book_id}.jpg"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET cover_path = ?2 WHERE id = ?1",
        rusqlite::params![book_id, path.to_string_lossy()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Actualiza título/autores con los metadatos reales (EPUB) tras la ingesta.
#[tauri::command]
pub fn update_book_meta(
    state: State<AppState>,
    book_id: i64,
    title: String,
    authors: String,
) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Ok(());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET title = ?2, authors = ?3 WHERE id = ?1",
        rusqlite::params![book_id, title, authors.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
