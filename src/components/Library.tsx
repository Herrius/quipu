import { useEffect, useMemo, useRef, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { api, pickExportDir, type Book, type Status } from "../api";
import { generateCover, ingestWithCover } from "../ingest";

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
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [coverSize, setCoverSize] = useState(() => {
    const saved = Number(localStorage.getItem("quipu.coverSize"));
    return saved >= 100 && saved <= 280 ? saved : 150;
  });

  useEffect(() => {
    localStorage.setItem("quipu.coverSize", String(coverSize));
  }, [coverSize]);

  useEffect(() => {
    api.detectCalibreLibrary().then(setDetected);
  }, []);

  // Generar portadas faltantes en segundo plano (render de la 1.ª página
  // del PDF / portada del EPUB). Secuencial para no cargar varios archivos
  // grandes a la vez; un solo intento por libro para no reintentar fallos.
  const coverAttempts = useRef<Set<number>>(new Set());
  const coverSweepRunning = useRef(false);
  useEffect(() => {
    const pending = books.filter(
      (b) => !b.has_cover && !coverAttempts.current.has(b.id),
    );
    if (pending.length === 0 || coverSweepRunning.current) return;
    coverSweepRunning.current = true;
    (async () => {
      let generated = 0;
      for (const b of pending) {
        coverAttempts.current.add(b.id);
        try {
          await generateCover(b.id, b.format);
          generated++;
        } catch (e) {
          console.warn("Sin portada para libro:", b.title, e);
        }
      }
      coverSweepRunning.current = false;
      if (generated > 0) onChanged();
    })();
  }, [books, onChanged]);

  // Cerrar el menú contextual al hacer clic fuera o con Escape.
  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

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

  async function addBooks() {
    const picked = await open({
      multiple: true,
      title: "Agregar libros (PDF o EPUB)",
      filters: [{ name: "Libros", extensions: ["pdf", "epub"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setImporting(true);
    let added = 0;
    for (const p of paths) {
      try {
        await ingestWithCover(p);
        added++;
        setStatus(`Agregando… ${added}/${paths.length}`);
      } catch (e) {
        setStatus(String(e));
      }
    }
    setImporting(false);
    if (added > 0) setStatus(`${added} libro(s) agregados a la biblioteca.`);
    onChanged();
  }

  async function clearBookNotes(book: Book) {
    setMenuFor(null);
    const hl = await api.listHighlights(book.id);
    const bm = await api.listBookmarks(book.id);
    const ok = await ask(
      `Se borrarán ${hl.length} subrayado(s) y ${bm.length} marcador(es) de «${book.title}», y se eliminará su archivo de notas del vault de Obsidian.\n\nEsta acción no se puede deshacer.`,
      {
        title: "Borrar las notas del libro",
        kind: "warning",
        okLabel: "Borrar todo",
        cancelLabel: "Cancelar",
      },
    );
    if (!ok) return;
    await api.deleteBookNotes(book.id);
    setStatus(`Notas de «${book.title}» eliminadas.`);
    onChanged();
  }

  async function removeBookFromLibrary(book: Book) {
    setMenuFor(null);
    const fileNote = book.managed
      ? "También se borrará la copia del archivo que gestiona Quipu."
      : "El archivo original del libro NO se toca (sigue en tu biblioteca de Calibre).";
    const ok = await ask(
      `«${book.title}» se quitará de Quipu: se pierden su progreso de lectura, subrayados y marcadores, y se elimina su archivo de notas del vault.\n\n${fileNote}\n\nEsta acción no se puede deshacer.`,
      {
        title: "Quitar de la biblioteca",
        kind: "warning",
        okLabel: "Quitar libro",
        cancelLabel: "Cancelar",
      },
    );
    if (!ok) return;
    await api.removeBook(book.id);
    setStatus(`«${book.title}» quitado de la biblioteca.`);
    onChanged();
  }

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function removeSelectedBooks() {
    const chosen = books.filter((b) => selected.has(b.id));
    if (chosen.length === 0) return;
    const managedCount = chosen.filter((b) => b.managed).length;
    const names = chosen.slice(0, 6).map((b) => `• ${b.title}`).join("\n");
    const more = chosen.length > 6 ? `\n… y ${chosen.length - 6} más.` : "";
    const fileNote =
      managedCount > 0
        ? `Se borrarán también ${managedCount} copia(s) de archivo gestionadas por Quipu. Los archivos de Calibre NO se tocan.`
        : "Los archivos originales (Calibre) NO se tocan.";
    const ok = await ask(
      `Se quitarán ${chosen.length} libro(s) de la biblioteca:\n\n${names}${more}\n\nSe pierde su progreso de lectura, subrayados y marcadores, y se eliminan sus archivos de notas del vault. ${fileNote}\n\nEsta acción no se puede deshacer.`,
      {
        title: "Quitar libros seleccionados",
        kind: "warning",
        okLabel: `Quitar ${chosen.length} libro(s)`,
        cancelLabel: "Cancelar",
      },
    );
    if (!ok) return;
    for (const b of chosen) {
      await api.removeBook(b.id);
    }
    setStatus(`${chosen.length} libro(s) quitados de la biblioteca.`);
    exitSelection();
    onChanged();
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
        {selecting ? (
          <>
            <span className="select-count">{selected.size} seleccionado(s)</span>
            <button
              className="btn"
              onClick={() => setSelected(new Set(filtered.map((b) => b.id)))}
            >
              Todos
            </button>
            <button
              className="btn btn-danger"
              disabled={selected.size === 0}
              onClick={removeSelectedBooks}
            >
              🗑 Quitar ({selected.size})…
            </button>
            <button className="btn" onClick={exitSelection}>Cancelar</button>
          </>
        ) : (
          <>
            <label className="cover-zoom" title="Tamaño de las carátulas">
              <span>🔳</span>
              <input
                type="range"
                min={100}
                max={280}
                step={10}
                value={coverSize}
                onChange={(e) => setCoverSize(Number(e.target.value))}
              />
            </label>
            <button
              className="btn btn-ghost"
              title="Carpeta de Obsidian para subrayados"
              onClick={configureNotesDir}
            >
              📁
            </button>
            <button className="btn" onClick={() => setSelecting(true)}>
              ☑ Seleccionar
            </button>
            <button className="btn btn-primary" disabled={importing} onClick={addBooks}>
              {importing ? "Agregando…" : "＋ Agregar"}
            </button>
            <button className="btn" disabled={importing} onClick={pickAndImport}>
              Reimportar
            </button>
          </>
        )}
      </header>
      {status && <p className="status">{status}</p>}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
        }}
      >
        {filtered.map((book) => (
          <div
            key={book.id}
            className={`card ${selecting && selected.has(book.id) ? "card-selected" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => (selecting ? toggleSelected(book.id) : onOpen(book))}
            onContextMenu={(e) => {
              if (selecting) return;
              e.preventDefault();
              e.stopPropagation();
              setMenuFor(menuFor === book.id ? null : book.id);
            }}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              (selecting ? toggleSelected(book.id) : onOpen(book))
            }
          >
            {selecting ? (
              <span
                className={`select-dot ${selected.has(book.id) ? "on" : ""}`}
              >
                {selected.has(book.id) ? "✓" : ""}
              </span>
            ) : (
              <div className="card-menu-anchor" onClick={(e) => e.stopPropagation()}>
                <button
                  className="card-menu-btn"
                  title="Opciones del libro"
                  onClick={() => setMenuFor(menuFor === book.id ? null : book.id)}
                >
                  ⋯
                </button>
                {menuFor === book.id && (
                  <div className="card-menu">
                    <button onClick={() => clearBookNotes(book)}>
                      🧹 Borrar notas…
                    </button>
                    <button onClick={() => removeBookFromLibrary(book)}>
                      🗑 Quitar de la biblioteca…
                    </button>
                  </div>
                )}
              </div>
            )}
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
