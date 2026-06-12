use rusqlite::Connection;
use std::path::Path;

pub fn open(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            calibre_id INTEGER,
            title TEXT NOT NULL,
            authors TEXT NOT NULL DEFAULT '',
            path TEXT NOT NULL UNIQUE,
            format TEXT NOT NULL,
            cover_path TEXT,
            added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS progress (
            book_id INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
            location TEXT NOT NULL,
            percent REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(
            "
            ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'por_leer';
            ALTER TABLE books ADD COLUMN rating INTEGER;

            CREATE TABLE highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                location TEXT NOT NULL,
                page INTEGER,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                location TEXT NOT NULL,
                page INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            PRAGMA user_version = 1;
            ",
        )?;
    }
    if version < 2 {
        // managed = 1: el archivo del libro lo copió y gestiona Quipu
        // (al quitarlo de la biblioteca, su copia también se elimina).
        conn.execute_batch(
            "
            ALTER TABLE books ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;
            PRAGMA user_version = 2;
            ",
        )?;
    }
    if version < 3 {
        // Timestamps por dominio para la sincronización entre PCs
        // (quipu-sync.json): gana el lado más reciente. El backfill solo
        // marca lo que el usuario realmente tocó, para que una instalación
        // fresca nunca pise datos reales con sus valores por defecto.
        conn.execute_batch(
            "
            ALTER TABLE books ADD COLUMN meta_updated_at TEXT;
            ALTER TABLE books ADD COLUMN notes_updated_at TEXT;

            UPDATE books SET meta_updated_at = datetime('now')
            WHERE status != 'por_leer' OR rating IS NOT NULL;

            UPDATE books SET notes_updated_at = (
                SELECT MAX(ts) FROM (
                    SELECT MAX(created_at) AS ts FROM highlights WHERE book_id = books.id
                    UNION ALL
                    SELECT MAX(created_at) FROM bookmarks WHERE book_id = books.id
                )
            );

            PRAGMA user_version = 3;
            ",
        )?;
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}
