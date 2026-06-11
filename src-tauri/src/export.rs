use crate::db;
use rusqlite::Connection;
use std::path::PathBuf;

pub const NO_DIR_MSG: &str =
    "Configura la carpeta de subrayados (tu vault de Obsidian) primero";

pub fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Ruta del archivo de notas del libro en el vault (None si no hay carpeta
/// configurada). No comprueba que el archivo exista.
pub fn notes_file_path(conn: &Connection, book_id: i64) -> Option<PathBuf> {
    let dir = db::get_setting(conn, "export_dir")?;
    let title: String = conn
        .query_row("SELECT title FROM books WHERE id = ?1", [book_id], |row| {
            row.get(0)
        })
        .ok()?;
    Some(PathBuf::from(dir).join(format!("{} - Subrayados.md", sanitize(&title))))
}

/// Regenera el archivo markdown del libro en la carpeta del vault.
/// Un archivo por libro; se reescribe completo en cada cambio (la app es la
/// fuente de verdad — las ediciones manuales del archivo se pierden).
pub fn export_book(conn: &Connection, book_id: i64) -> Result<Option<PathBuf>, String> {
    let dir = db::get_setting(conn, "export_dir").ok_or(NO_DIR_MSG)?;

    let (title, authors, status, rating): (String, String, String, Option<i64>) = conn
        .query_row(
            "SELECT title, authors, status, rating FROM books WHERE id = ?1",
            [book_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT page, text, created_at FROM highlights
             WHERE book_id = ?1 ORDER BY COALESCE(page, 999999), created_at",
        )
        .map_err(|e| e.to_string())?;
    let highlights: Vec<(Option<i64>, String, String)> = stmt
        .query_map([book_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Sin subrayados no creamos archivo: evita 70 archivos vacíos en el vault.
    if highlights.is_empty() {
        return Ok(None);
    }

    let estado = match status.as_str() {
        "leido" => "leído",
        "leyendo" => "leyendo",
        _ => "por leer",
    };
    let today: String = conn
        .query_row("SELECT date('now','localtime')", [], |row| row.get(0))
        .unwrap_or_default();

    let mut md = String::new();
    md.push_str("---\n");
    md.push_str("tags: [libro, subrayados, quipu]\n");
    md.push_str(&format!("titulo: \"{}\"\n", title.replace('"', "'")));
    md.push_str(&format!("autores: \"{}\"\n", authors.replace('"', "'")));
    md.push_str(&format!("estado: {estado}\n"));
    if let Some(r) = rating {
        md.push_str(&format!("puntuacion: {r}\n"));
    }
    md.push_str(&format!("actualizado: {today}\n"));
    md.push_str("---\n\n");
    md.push_str(&format!("# {title} — Subrayados\n\n"));
    md.push_str("> [!info] Generado por Quipu. Se reescribe con cada subrayado: no editar a mano.\n\n");

    for (page, text, created) in &highlights {
        let loc = page
            .map(|p| format!("p. {p}"))
            .unwrap_or_else(|| "epub".to_string());
        let date = created.get(..10).unwrap_or(created);
        md.push_str(&format!("### {loc} · {date}\n\n"));
        for line in text.lines() {
            md.push_str(&format!("> {line}\n"));
        }
        md.push('\n');
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear {dir}: {e}"))?;
    let path = PathBuf::from(&dir).join(format!("{} - Subrayados.md", sanitize(&title)));
    std::fs::write(&path, md).map_err(|e| format!("No se pudo escribir {}: {e}", path.display()))?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exporta_markdown_con_frontmatter_y_citas() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = crate::db::open(&tmp.path().join("app.db")).unwrap();
        conn.execute(
            "INSERT INTO books (title, authors, path, format, status, rating)
             VALUES ('Los ríos: profundos', 'Arguedas', '/x/rios.pdf', 'pdf', 'leyendo', 4)",
            [],
        )
        .unwrap();

        // Sin carpeta configurada → error claro.
        assert!(export_book(&conn, 1).unwrap_err().contains("Configura"));

        crate::db::set_setting(&conn, "export_dir", tmp.path().join("notas").to_str().unwrap())
            .unwrap();

        // Sin subrayados → no crea archivo.
        assert!(export_book(&conn, 1).unwrap().is_none());

        conn.execute(
            "INSERT INTO highlights (book_id, location, page, text) VALUES (1, '12', 12, 'línea uno\nlínea dos')",
            [],
        )
        .unwrap();
        let path = export_book(&conn, 1).unwrap().unwrap();
        let content = std::fs::read_to_string(&path).unwrap();

        assert!(path.file_name().unwrap().to_str().unwrap().contains("Los ríos profundos"));
        assert!(content.contains("estado: leyendo"));
        assert!(content.contains("puntuacion: 4"));
        assert!(content.contains("### p. 12"));
        assert!(content.contains("> línea uno\n> línea dos"));
    }
}
