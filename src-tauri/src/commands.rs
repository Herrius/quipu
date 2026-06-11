use crate::{calibre, db, AppState};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::State;

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
                    COALESCE(p.percent, 0), p.location, p.updated_at
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
