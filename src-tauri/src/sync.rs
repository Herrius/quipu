//! Sincronización de estado entre PCs vía `quipu-sync.json` en la carpeta
//! de la biblioteca de Calibre (que ya viaja por la nube del usuario).
//!
//! Los libros se identifican por id de Calibre (o nombre de archivo), nunca
//! por rutas absolutas — difieren entre Linux y Windows. El merge es por
//! libro y por dominio independiente (progreso / meta / notas), gana el
//! timestamp más reciente; las notas se reemplazan en bloque para que las
//! eliminaciones también se propaguen.

use crate::{db, export};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncProgress {
    pub location: String,
    pub percent: f64,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncMeta {
    pub status: String,
    pub rating: Option<i64>,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncHighlight {
    pub location: String,
    pub page: Option<i64>,
    pub text: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncBookmark {
    pub location: String,
    pub page: Option<i64>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncNotes {
    pub updated_at: String,
    pub highlights: Vec<SyncHighlight>,
    pub bookmarks: Vec<SyncBookmark>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SyncBook {
    #[serde(default)]
    pub progress: Option<SyncProgress>,
    #[serde(default)]
    pub meta: Option<SyncMeta>,
    #[serde(default)]
    pub notes: Option<SyncNotes>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct SyncFile {
    pub version: u32,
    #[serde(default)]
    pub books: BTreeMap<String, SyncBook>,
}

#[derive(Debug, Serialize, Default, PartialEq)]
pub struct SyncReport {
    pub pulled: u32,
    pub pushed: u32,
}

struct DbBook {
    id: i64,
    key: String,
    status: String,
    rating: Option<i64>,
    meta_ts: Option<String>,
    notes_ts: Option<String>,
    progress: Option<SyncProgress>,
}

fn sync_path(conn: &Connection) -> Option<PathBuf> {
    db::get_setting(conn, "calibre_library")
        .map(|lib| PathBuf::from(lib).join("quipu-sync.json"))
}

fn book_key(calibre_id: Option<i64>, path: &str) -> String {
    match calibre_id {
        Some(id) => format!("cal:{id}"),
        None => {
            let name = Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());
            format!("file:{name}")
        }
    }
}

fn load_books(conn: &Connection) -> Result<Vec<DbBook>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.calibre_id, b.path, b.status, b.rating,
                    b.meta_updated_at, b.notes_updated_at,
                    p.location, p.percent, p.updated_at
             FROM books b LEFT JOIN progress p ON p.book_id = b.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let calibre_id: Option<i64> = row.get(1)?;
            let path: String = row.get(2)?;
            let location: Option<String> = row.get(7)?;
            Ok(DbBook {
                id: row.get(0)?,
                key: book_key(calibre_id, &path),
                status: row.get(3)?,
                rating: row.get(4)?,
                meta_ts: row.get(5)?,
                notes_ts: row.get(6)?,
                progress: location.map(|loc| SyncProgress {
                    location: loc,
                    percent: row.get(8).unwrap_or(0.0),
                    updated_at: row.get(9).unwrap_or_default(),
                }),
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(rows)
}

fn load_notes(conn: &Connection, book_id: i64, updated_at: &str) -> Result<SyncNotes, String> {
    let mut stmt = conn
        .prepare(
            "SELECT location, page, text, created_at FROM highlights
             WHERE book_id = ?1 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let highlights = stmt
        .query_map([book_id], |row| {
            Ok(SyncHighlight {
                location: row.get(0)?,
                page: row.get(1)?,
                text: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    let mut stmt = conn
        .prepare(
            "SELECT location, page, created_at FROM bookmarks
             WHERE book_id = ?1 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;
    let bookmarks = stmt
        .query_map([book_id], |row| {
            Ok(SyncBookmark {
                location: row.get(0)?,
                page: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(SyncNotes {
        updated_at: updated_at.to_string(),
        highlights,
        bookmarks,
    })
}

fn apply_notes(conn: &Connection, book_id: i64, notes: &SyncNotes) -> Result<(), String> {
    conn.execute("DELETE FROM highlights WHERE book_id = ?1", [book_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bookmarks WHERE book_id = ?1", [book_id])
        .map_err(|e| e.to_string())?;
    for h in &notes.highlights {
        conn.execute(
            "INSERT INTO highlights (book_id, location, page, text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![book_id, h.location, h.page, h.text, h.created_at],
        )
        .map_err(|e| e.to_string())?;
    }
    for b in &notes.bookmarks {
        conn.execute(
            "INSERT INTO bookmarks (book_id, location, page, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![book_id, b.location, b.page, b.created_at],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE books SET notes_updated_at = ?2 WHERE id = ?1",
        rusqlite::params![book_id, notes.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Merge bidireccional entre la base local y quipu-sync.json.
/// Sin biblioteca de Calibre configurada no hace nada (no hay canal).
pub fn sync(conn: &Connection) -> Result<SyncReport, String> {
    let Some(path) = sync_path(conn) else {
        return Ok(SyncReport::default());
    };

    let original = std::fs::read_to_string(&path).ok();
    let mut file: SyncFile = match original.as_deref() {
        Some(raw) => serde_json::from_str(raw)
            .map_err(|e| format!("quipu-sync.json corrupto (no sincronizo): {e}"))?,
        None => SyncFile::default(),
    };
    file.version = 1;

    let mut report = SyncReport::default();

    for b in load_books(conn)? {
        let entry = file.books.entry(b.key.clone()).or_default();

        // --- Progreso de lectura ---
        let db_ts = b.progress.as_ref().map(|p| p.updated_at.as_str()).unwrap_or("");
        let file_ts = entry.progress.as_ref().map(|p| p.updated_at.as_str()).unwrap_or("");
        if file_ts > db_ts {
            let p = entry.progress.clone().unwrap_or_default();
            conn.execute(
                "INSERT INTO progress (book_id, location, percent, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(book_id) DO UPDATE SET
                     location = excluded.location,
                     percent = excluded.percent,
                     updated_at = excluded.updated_at",
                rusqlite::params![b.id, p.location, p.percent, p.updated_at],
            )
            .map_err(|e| e.to_string())?;
            report.pulled += 1;
        } else if db_ts > file_ts {
            entry.progress = b.progress.clone();
            report.pushed += 1;
        }

        // --- Estado y puntuación ---
        let db_ts = b.meta_ts.as_deref().unwrap_or("");
        let file_ts = entry.meta.as_ref().map(|m| m.updated_at.as_str()).unwrap_or("");
        if file_ts > db_ts {
            let m = entry.meta.clone().unwrap_or_default();
            conn.execute(
                "UPDATE books SET status = ?2, rating = ?3, meta_updated_at = ?4 WHERE id = ?1",
                rusqlite::params![b.id, m.status, m.rating, m.updated_at],
            )
            .map_err(|e| e.to_string())?;
            let _ = export::export_book(conn, b.id);
            report.pulled += 1;
        } else if db_ts > file_ts {
            entry.meta = Some(SyncMeta {
                status: b.status.clone(),
                rating: b.rating,
                updated_at: db_ts.to_string(),
            });
            report.pushed += 1;
        }

        // --- Notas (subrayados + marcadores): reemplazo en bloque ---
        let db_ts = b.notes_ts.as_deref().unwrap_or("").to_string();
        let file_ts = entry.notes.as_ref().map(|n| n.updated_at.as_str()).unwrap_or("");
        if file_ts > db_ts.as_str() {
            let notes = entry.notes.clone().unwrap_or_default();
            apply_notes(conn, b.id, &notes)?;
            let _ = export::export_book(conn, b.id);
            report.pulled += 1;
        } else if db_ts.as_str() > file_ts {
            entry.notes = Some(load_notes(conn, b.id, &db_ts)?);
            report.pushed += 1;
        }
    }

    // Escribir solo si cambió, de forma atómica (escritura + rename) para
    // no dejar un JSON a medias si la nube sincroniza en mal momento.
    let serialized =
        serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    if original.as_deref() != Some(serialized.as_str()) {
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, &serialized).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Simula las dos PCs: A (Linux) con datos reales y B (Windows) recién
    /// instalada, compartiendo la misma carpeta de biblioteca.
    #[test]
    fn sincroniza_progreso_meta_y_notas_entre_dos_pcs() {
        let lib = tempfile::tempdir().unwrap();
        let lib_path = lib.path().to_str().unwrap();

        let open_pc = |name: &str| {
            let conn = crate::db::open(&lib.path().join(name)).unwrap();
            crate::db::set_setting(&conn, "calibre_library", lib_path).unwrap();
            conn.execute(
                "INSERT INTO books (calibre_id, title, authors, path, format)
                 VALUES (42, 'Sonidos Andinos', 'Romero', ?1, 'pdf')",
                [format!("/{name}/ruta-distinta/libro.pdf")],
            )
            .unwrap();
            conn
        };

        // PC A: leyó hasta la p.50, puntuó con 4 y subrayó algo.
        let a = open_pc("a.db");
        a.execute_batch(
            "INSERT INTO progress (book_id, location, percent, updated_at)
                 VALUES (1, '50', 0.5, '2026-06-12 10:00:00');
             UPDATE books SET status='leyendo', rating=4,
                 meta_updated_at='2026-06-12 10:00:00' WHERE id=1;
             INSERT INTO highlights (book_id, location, page, text, created_at)
                 VALUES (1, '12', 12, 'cita andina', '2026-06-12 09:00:00');
             UPDATE books SET notes_updated_at='2026-06-12 09:00:00' WHERE id=1;",
        )
        .unwrap();
        let r = sync(&a).unwrap();
        assert_eq!((r.pulled, r.pushed), (0, 3)); // publica los 3 dominios

        // PC B (fresca): debe recibir todo, sin pisar nada con sus defaults.
        let b = open_pc("b.db");
        let r = sync(&b).unwrap();
        assert_eq!((r.pulled, r.pushed), (3, 0));
        let (loc, status, rating): (String, String, i64) = b
            .query_row(
                "SELECT p.location, b.status, b.rating FROM books b
                 JOIN progress p ON p.book_id = b.id WHERE b.id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((loc.as_str(), status.as_str(), rating), ("50", "leyendo", 4));
        let n: i64 = b
            .query_row("SELECT COUNT(*) FROM highlights WHERE book_id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        // B avanza más tarde y borra el subrayado: debe ganar en A,
        // incluida la eliminación (reemplazo en bloque de notas).
        b.execute_batch(
            "UPDATE progress SET location='80', percent=0.8,
                 updated_at='2026-06-12 12:00:00' WHERE book_id=1;
             DELETE FROM highlights WHERE book_id=1;
             UPDATE books SET notes_updated_at='2026-06-12 12:00:00' WHERE id=1;",
        )
        .unwrap();
        sync(&b).unwrap();
        let r = sync(&a).unwrap();
        assert_eq!(r.pulled, 2);
        let loc: String = a
            .query_row("SELECT location FROM progress WHERE book_id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(loc, "80");
        let n: i64 = a
            .query_row("SELECT COUNT(*) FROM highlights WHERE book_id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);

        // Re-sincronizar sin cambios no mueve nada.
        assert_eq!(sync(&a).unwrap(), SyncReport::default());
    }
}
