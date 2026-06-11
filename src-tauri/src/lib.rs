mod calibre;
mod commands;
mod db;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("quipu.db"))?;
            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_calibre_library,
            commands::import_calibre,
            commands::list_books,
            commands::read_book,
            commands::read_cover,
            commands::save_progress,
            commands::get_calibre_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
