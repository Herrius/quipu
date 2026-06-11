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
    Ok(conn)
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
