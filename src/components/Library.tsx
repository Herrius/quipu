import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, pickExportDir, type Book, type Status } from "../api";

const NEXT_STATUS: Record<Status, Status> = {
  por_leer: "leyendo",
  leyendo: "leido",
  leido: "por_leer",
};

const STATUS_LABEL: Record<Status, string> = {
  por_leer: "Por leer",
  leyendo: "Leyendo",
  leido: "Leído",
};

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

function Stars({ book, onChanged }: { book: Book; onChanged: () => void }) {
  async function rate(e: React.MouseEvent, value: number) {
    e.stopPropagation();
    await api.setRating(book.id, book.rating === value ? null : value);
    onChanged();
  }
  return (
    <span className="stars" onClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={`star ${book.rating && n <= book.rating ? "on" : ""}`}
          title={`${n}/5`}
          onClick={(e) => rate(e, n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

interface Props {
  books: Book[];
  onOpen: (book: Book) => void;
  onChanged: () => void;
}

export function Library({ books, onOpen, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Status | "todos">("todos");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    api.detectCalibreLibrary().then(setDetected);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter(
      (b) =>
        (filter === "todos" || b.status === filter) &&
        (!q ||
          b.title.toLowerCase().includes(q) ||
          b.authors.toLowerCase().includes(q)),
    );
  }, [books, query, filter]);

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

  async function cycleStatus(e: React.MouseEvent, book: Book) {
    e.stopPropagation();
    await api.setStatus(book.id, NEXT_STATUS[book.status]);
    onChanged();
  }

  async function configureNotesDir() {
    const dir = await pickExportDir();
    if (dir) setStatus(`Subrayados se guardarán en: ${dir}`);
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
        <nav className="filters">
          {(["todos", "leyendo", "por_leer", "leido"] as const).map((f) => (
            <button
              key={f}
              className={`pill ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "todos" ? "Todos" : STATUS_LABEL[f]}
            </button>
          ))}
        </nav>
        <button
          className="btn btn-ghost"
          title="Carpeta de Obsidian para subrayados"
          onClick={configureNotesDir}
        >
          📁
        </button>
        <button className="btn" disabled={importing} onClick={pickAndImport}>
          {importing ? "Importando…" : "Reimportar"}
        </button>
      </header>
      {status && <p className="status">{status}</p>}
      <div className="grid">
        {filtered.map((book) => (
          <div
            key={book.id}
            className="card"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(book)}
            onKeyDown={(e) => e.key === "Enter" && onOpen(book)}
          >
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
              <div className="card-actions">
                <button
                  className={`chip chip-status chip-${book.status}`}
                  title="Cambiar estado"
                  onClick={(e) => cycleStatus(e, book)}
                >
                  {STATUS_LABEL[book.status]}
                  {book.percent > 0 &&
                    book.status !== "leido" &&
                    ` · ${Math.round(book.percent * 100)}%`}
                </button>
                <Stars book={book} onChanged={onChanged} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="status">Nada coincide con el filtro.</p>
      )}
    </div>
  );
}
