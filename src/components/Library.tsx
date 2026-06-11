import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Book } from "../api";

function Cover({ book }: { book: Book }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!book.has_cover) return;
    let revoked: string | null = null;
    api.readCover(book.id).then((bytes) => {
      revoked = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      setUrl(revoked);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [book.id, book.has_cover]);

  if (url) return <img className="cover" src={url} alt="" loading="lazy" />;
  return (
    <div className="cover cover-placeholder">
      <span>{book.title}</span>
    </div>
  );
}

interface Props {
  books: Book[];
  onOpen: (book: Book) => void;
  onChanged: () => void;
}

export function Library({ books, onOpen, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    api.detectCalibreLibrary().then(setDetected);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.authors.toLowerCase().includes(q),
    );
  }, [books, query]);

  async function importFrom(path: string) {
    setImporting(true);
    setStatus(null);
    try {
      const r = await api.importCalibre(path);
      setStatus(
        `Importados: ${r.imported} · ya existentes: ${r.skipped}` +
          (r.missing ? ` · archivos no encontrados: ${r.missing}` : ""),
      );
      onChanged();
    } catch (e) {
      setStatus(String(e));
    } finally {
      setImporting(false);
    }
  }

  async function pickAndImport() {
    const dir = await open({ directory: true, title: "Elige tu biblioteca de Calibre" });
    if (typeof dir === "string") await importFrom(dir);
  }

  if (books.length === 0) {
    return (
      <div className="onboarding">
        <h1>Quipu</h1>
        <p>Tu biblioteca personal. Importa tus libros desde Calibre para empezar.</p>
        {detected && (
          <button
            className="btn btn-primary"
            disabled={importing}
            onClick={() => importFrom(detected)}
          >
            {importing ? "Importando…" : `Importar biblioteca detectada`}
          </button>
        )}
        {detected && <code className="detected-path">{detected}</code>}
        <button className="btn" disabled={importing} onClick={pickAndImport}>
          Elegir otra carpeta…
        </button>
        {status && <p className="status">{status}</p>}
      </div>
    );
  }

  return (
    <div className="library">
      <header className="library-header">
        <h1>Quipu</h1>
        <input
          className="search"
          type="search"
          placeholder="Buscar por título o autor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" disabled={importing} onClick={pickAndImport}>
          {importing ? "Importando…" : "Reimportar"}
        </button>
      </header>
      {status && <p className="status">{status}</p>}
      <div className="grid">
        {filtered.map((book) => (
          <button key={book.id} className="card" onClick={() => onOpen(book)}>
            <Cover book={book} />
            {book.percent > 0 && (
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round(book.percent * 100)}%` }}
                />
              </div>
            )}
            <div className="card-meta">
              <span className="card-title">{book.title}</span>
              <span className="card-authors">{book.authors}</span>
              <span className={`chip chip-${book.format}`}>
                {book.format.toUpperCase()}
                {book.percent > 0 && ` · ${Math.round(book.percent * 100)}%`}
              </span>
            </div>
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="status">Nada coincide con «{query}».</p>
      )}
    </div>
  );
}
