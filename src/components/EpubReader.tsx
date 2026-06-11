import { useCallback, useEffect, useRef, useState } from "react";
import ePub, { type Rendition } from "epubjs";
import {
  addHighlightEnsuringDir,
  api,
  type Book,
  type Bookmark,
  type Highlight,
} from "../api";
import { ReaderPanel } from "./ReaderPanel";
import { FocusReader, type WordChunk } from "./FocusReader";

const HIGHLIGHT_STYLE = { fill: "rgba(224, 164, 88, 0.35)" };

interface SpineSection {
  href: string;
  load: (loader: unknown) => Promise<Document>;
  unload?: () => void;
}

const THEMES: Record<string, Record<string, Record<string, string>>> = {
  dark: {
    body: { background: "#16161d", color: "#d8d4c8" },
    a: { color: "#8ab4f8" },
  },
  sepia: {
    body: { background: "#f4ecd8", color: "#5b4636" },
    a: { color: "#1a5276" },
  },
  light: {
    body: { background: "#ffffff", color: "#1a1a1a" },
    a: { color: "#1a5276" },
  },
};

interface Props {
  book: Book;
  onClose: () => void;
}

export function EpubReader({ book, onClose }: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<ReturnType<typeof ePub> | null>(null);
  const cfiRef = useRef<string | null>(book.location);
  const spineIdxRef = useRef(0);
  const focusIdxRef = useRef(0);
  const [focusMode, setFocusMode] = useState(false);
  const focusModeRef = useRef(false);
  focusModeRef.current = focusMode;
  const [theme, setTheme] = useState("dark");
  const [fontSize, setFontSize] = useState(110);
  const [percent, setPercent] = useState(book.percent);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reloadNotes = useCallback(async () => {
    setHighlights(await api.listHighlights(book.id));
    setBookmarks(await api.listBookmarks(book.id));
  }, [book.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    let destroyed = false;
    let epubBook: ReturnType<typeof ePub> | null = null;

    (async () => {
      const bytes = await api.readBook(book.id);
      if (destroyed) return;
      epubBook = ePub(bytes);
      epubBookRef.current = epubBook;
      const rendition = epubBook.renderTo(el, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "none",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;

      for (const [name, styles] of Object.entries(THEMES)) {
        rendition.themes.register(name, styles);
      }

      rendition.on("relocated", (loc: { start: { cfi: string; index: number } }) => {
        const cfi = loc.start.cfi;
        cfiRef.current = cfi;
        spineIdxRef.current = loc.start.index ?? 0;
        let pct = 0;
        try {
          pct = epubBook!.locations.percentageFromCfi(cfi) ?? 0;
        } catch {
          /* locations aún no generadas */
        }
        if (pct > 0) setPercent(pct);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          api.saveProgress(book.id, cfi, pct);
        }, 600);
      });

      // Selección de texto dentro del capítulo → subrayar directo.
      rendition.on(
        "selected",
        async (cfiRange: string, contents: { window: Window }) => {
          try {
            const range = await epubBook!.getRange(cfiRange);
            const text = range.toString().trim();
            if (!text) return;
            const ok = await addHighlightEnsuringDir(book.id, cfiRange, null, text);
            if (!ok) return;
            rendition.annotations.highlight(
              cfiRange,
              {},
              undefined,
              "quipu-hl",
              HIGHLIGHT_STYLE,
            );
            contents.window.getSelection()?.removeAllRanges();
            setToast("Subrayado guardado en tu vault ✓");
            reloadNotes();
          } catch (e) {
            setToast(String(e));
          }
        },
      );

      rendition.on("keydown", handleKeys);
      await rendition.display(book.location ?? undefined);

      // Re-aplicar subrayados guardados.
      const saved = await api.listHighlights(book.id);
      if (destroyed) return;
      setHighlights(saved);
      setBookmarks(await api.listBookmarks(book.id));
      for (const h of saved) {
        rendition.annotations.highlight(
          h.location,
          {},
          undefined,
          "quipu-hl",
          HIGHLIGHT_STYLE,
        );
      }

      // Generar mapa de posiciones en segundo plano para poder mostrar %.
      epubBook.ready.then(() => epubBook!.locations.generate(600)).catch(() => {});
    })().catch((e) => !destroyed && setError(String(e)));

    function handleKeys(e: KeyboardEvent) {
      if (focusModeRef.current) return; // el modo enfocado maneja su teclado
      if (e.key === "ArrowRight") renditionRef.current?.next();
      if (e.key === "ArrowLeft") renditionRef.current?.prev();
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeys);

    return () => {
      destroyed = true;
      clearTimeout(saveTimer.current);
      window.removeEventListener("keydown", handleKeys);
      epubBook?.destroy();
      epubBookRef.current = null;
      renditionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    renditionRef.current?.themes.select(theme);
  }, [theme]);

  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  async function addBookmark() {
    if (!cfiRef.current) return;
    await api.addBookmark(book.id, cfiRef.current, null);
    setToast("Marcador guardado ✓");
    reloadNotes();
  }

  function openFocusMode() {
    focusIdxRef.current = spineIdxRef.current;
    setFocusMode(true);
  }

  // Entrega el texto del siguiente capítulo (spine) para el modo enfocado.
  const loadFocusWords = useCallback(async (): Promise<WordChunk | null> => {
    const epubBook = epubBookRef.current;
    if (!epubBook) return null;
    const spine = epubBook.spine as unknown as {
      get: (target: number) => SpineSection | null;
    };
    const idx = focusIdxRef.current;
    const section = spine.get(idx);
    if (!section) return null;
    focusIdxRef.current = idx + 1;
    const doc = await section.load(epubBook.load.bind(epubBook));
    const text = doc.body?.textContent ?? "";
    section.unload?.();
    return { words: text.split(/\s+/).filter(Boolean), marker: idx };
  }, []);

  function closeFocusMode(lastMarker: number | null) {
    setFocusMode(false);
    if (lastMarker !== null && lastMarker !== spineIdxRef.current) {
      const epubBook = epubBookRef.current;
      const spine = epubBook?.spine as unknown as
        | { get: (target: number) => SpineSection | null }
        | undefined;
      const section = spine?.get(lastMarker);
      if (section) renditionRef.current?.display(section.href);
    }
  }

  if (error) {
    return (
      <div className="reader-error">
        <p>No se pudo abrir el EPUB: {error}</p>
        <button className="btn" onClick={onClose}>Volver</button>
      </div>
    );
  }

  return (
    <div className={`reader epub-theme-${theme}`}>
      <header className="reader-bar">
        <button className="btn btn-ghost" onClick={onClose}>← Biblioteca</button>
        <span className="reader-title">{book.title}</span>
        <div className="reader-controls">
          <button className="btn btn-ghost" title="Modo lector enfocado" onClick={openFocusMode}>⚡</button>
          <button className="btn btn-ghost" title="Marcar aquí" onClick={addBookmark}>🔖</button>
          <button
            className={`btn btn-ghost ${panelOpen ? "active" : ""}`}
            title="Notas del libro"
            onClick={() => setPanelOpen((o) => !o)}
          >
            📑
          </button>
          <button className="btn btn-ghost" onClick={() => setFontSize((s) => Math.max(80, s - 10))}>A−</button>
          <button className="btn btn-ghost" onClick={() => setFontSize((s) => Math.min(180, s + 10))}>A+</button>
          {Object.keys(THEMES).map((t) => (
            <button
              key={t}
              className={`theme-dot theme-dot-${t} ${theme === t ? "active" : ""}`}
              title={t}
              onClick={() => setTheme(t)}
            />
          ))}
          <span className="reader-pos">{Math.round(percent * 100)}%</span>
        </div>
      </header>
      <div className="reader-body">
        <div className="epub-stage">
          <button className="epub-nav" onClick={() => renditionRef.current?.prev()}>‹</button>
          <div className="epub-view" ref={viewRef} />
          <button className="epub-nav" onClick={() => renditionRef.current?.next()}>›</button>
        </div>
        {panelOpen && (
          <ReaderPanel
            highlights={highlights}
            bookmarks={bookmarks}
            onJump={(loc) => renditionRef.current?.display(loc)}
            onDeleteHighlight={async (id) => {
              const h = highlights.find((x) => x.id === id);
              await api.deleteHighlight(id);
              if (h) renditionRef.current?.annotations.remove(h.location, "highlight");
              reloadNotes();
            }}
            onDeleteBookmark={async (id) => {
              await api.deleteBookmark(id);
              reloadNotes();
            }}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
      {focusMode && (
        <FocusReader
          title={book.title}
          loadMore={loadFocusWords}
          onClose={closeFocusMode}
        />
      )}
    </div>
  );
}
