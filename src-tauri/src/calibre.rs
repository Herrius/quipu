use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub missing: usize,
}

struct CalibreEntry {
    calibre_id: i64,
    title: String,
    authors: String,
    rel_dir: String,
    format: String,
    file_stem: String,
}

/// Intenta detectar la ruta de la biblioteca leyendo la config de Calibre.
pub fn detect_library() -> Option<String> {
    let config = dirs_config()?.join("calibre/global.py.json");
    let raw = std::fs::read_to_string(config).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let path = json.get("library_path")?.as_str()?.to_string();
    if Path::new(&path).join("metadata.db").exists() {
        Some(path)
    } else {
        None
    }
}

fn dirs_config() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    }
}

/// Importa libros (PDF/EPUB) desde una biblioteca de Calibre a nuestra DB.
/// Si un libro tiene ambos formatos, prefiere EPUB (mejor experiencia de lectura).
pub fn import(app_db: &Connection, library_path: &str) -> Result<ImportResult, String> {
    let lib = Path::new(library_path);
    let metadata = lib.join("metadata.db");
    if !metadata.exists() {
        return Err(format!(
            "No se encontró metadata.db en {library_path}: ¿es una biblioteca de Calibre?"
        ));
    }

    // Solo lectura: nunca tocamos la DB de Calibre, aunque Calibre esté abierto.
    let calibre = Connection::open_with_flags(&metadata, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("No se pudo abrir metadata.db: {e}"))?;

    let mut stmt = calibre
        .prepare(
            "SELECT b.id, b.title, b.path,
                    COALESCE((SELECT GROUP_CONCAT(a.name, ' & ')
                              FROM books_authors_link bal
                              JOIN authors a ON a.id = bal.author
                              WHERE bal.book = b.id), ''),
                    d.format, d.name
             FROM books b
             JOIN data d ON d.book = b.id
             WHERE d.format IN ('PDF', 'EPUB')
             ORDER BY b.id, CASE d.format WHEN 'EPUB' THEN 0 ELSE 1 END",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CalibreEntry {
                calibre_id: row.get(0)?,
                title: row.get(1)?,
                rel_dir: row.get(2)?,
                authors: row.get(3)?,
                format: row.get::<_, String>(4)?.to_lowercase(),
                file_stem: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = ImportResult { imported: 0, skipped: 0, missing: 0 };
    let mut last_book_id: Option<i64> = None;

    for entry in rows.flatten() {
        // El ORDER BY pone EPUB primero: la primera fila de cada libro gana.
        if last_book_id == Some(entry.calibre_id) {
            continue;
        }
        last_book_id = Some(entry.calibre_id);

        let book_dir = lib.join(&entry.rel_dir);
        let file = book_dir.join(format!("{}.{}", entry.file_stem, entry.format));
        if !file.exists() {
            result.missing += 1;
            continue;
        }
        let cover = book_dir.join("cover.jpg");
        let cover_path = cover.exists().then(|| cover.to_string_lossy().to_string());

        let inserted = app_db
            .execute(
                "INSERT INTO books (calibre_id, title, authors, path, format, cover_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(path) DO NOTHING",
                rusqlite::params![
                    entry.calibre_id,
                    entry.title,
                    entry.authors,
                    file.to_string_lossy(),
                    entry.format,
                    cover_path,
                ],
            )
            .map_err(|e| e.to_string())?;

        if inserted > 0 {
            result.imported += 1;
        } else {
            result.skipped += 1;
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Arma una biblioteca de Calibre mínima en un dir temporal:
    /// - libro 1: PDF presente
    /// - libro 2: EPUB + PDF presentes (debe preferir EPUB)
    /// - libro 3: registrado pero sin archivo en disco
    fn fake_library(dir: &Path) {
        let conn = Connection::open(dir.join("metadata.db")).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, path TEXT);
            CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER, author INTEGER);
            CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER, format TEXT, name TEXT);

            INSERT INTO books VALUES (1, 'Los ríos profundos', 'Arguedas/rios (1)');
            INSERT INTO books VALUES (2, 'Historia de la corrupción', 'Quiroz/corrupcion (2)');
            INSERT INTO books VALUES (3, 'Fantasma', 'Nadie/fantasma (3)');
            INSERT INTO authors VALUES (1, 'José María Arguedas');
            INSERT INTO authors VALUES (2, 'Alfonso Quiroz');
            INSERT INTO books_authors_link VALUES (1, 1, 1);
            INSERT INTO books_authors_link VALUES (2, 2, 2);
            INSERT INTO data VALUES (1, 1, 'PDF', 'rios');
            INSERT INTO data VALUES (2, 2, 'PDF', 'corrupcion');
            INSERT INTO data VALUES (3, 2, 'EPUB', 'corrupcion');
            INSERT INTO data VALUES (4, 3, 'PDF', 'fantasma');
            ",
        )
        .unwrap();

        for (rel, file) in [
            ("Arguedas/rios (1)", "rios.pdf"),
            ("Quiroz/corrupcion (2)", "corrupcion.pdf"),
            ("Quiroz/corrupcion (2)", "corrupcion.epub"),
        ] {
            let d = dir.join(rel);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join(file), b"contenido").unwrap();
        }
        std::fs::write(dir.join("Arguedas/rios (1)/cover.jpg"), b"jpg").unwrap();
    }

    #[test]
    fn importa_prefiere_epub_y_reporta_faltantes() {
        let tmp = tempfile::tempdir().unwrap();
        fake_library(tmp.path());
        let app_db = crate::db::open(&tmp.path().join("app.db")).unwrap();

        let r = import(&app_db, tmp.path().to_str().unwrap()).unwrap();
        assert_eq!(r.imported, 2);
        assert_eq!(r.missing, 1);
        assert_eq!(r.skipped, 0);

        let format: String = app_db
            .query_row(
                "SELECT format FROM books WHERE calibre_id = 2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(format, "epub");

        let authors: String = app_db
            .query_row(
                "SELECT authors FROM books WHERE calibre_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(authors, "José María Arguedas");

        let cover: Option<String> = app_db
            .query_row(
                "SELECT cover_path FROM books WHERE calibre_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(cover.is_some());

        // Reimportar no duplica.
        let r2 = import(&app_db, tmp.path().to_str().unwrap()).unwrap();
        assert_eq!(r2.imported, 0);
        assert_eq!(r2.skipped, 2);
    }
}
