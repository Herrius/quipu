import { useEffect, useRef, useState } from "react";
import ePub, { type Rendition } from "epubjs";
import { api, type Book } from "../api";

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
  const [theme, setTheme] = useState("dark");
  const [fontSize, setFontSize] = useState(110);
  const [percent, setPercent] = useState(book.percent);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    let destroyed = false;
    let epubBook: ReturnType<typeof ePub> | null = null;

    (async () => {
      const bytes = await api.readBook(book.id);
      if (destroyed) return;
      epubBook = ePub(bytes);
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

      rendition.on("relocated", (loc: { start: { cfi: string } }) => {
        const cfi = loc.start.cfi;
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

      rendition.on("keydown", handleKeys);
      await rendition.display(book.location ?? undefined);
      // Generar mapa de posiciones en segundo plano para poder mostrar %.
      epubBook.ready.then(() => epubBook!.locations.generate(600)).catch(() => {});
    })().catch((e) => !destroyed && setError(String(e)));

    function handleKeys(e: KeyboardEvent) {
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
      <div className="epub-stage">
        <button className="epub-nav" onClick={() => renditionRef.current?.prev()}>‹</button>
        <div className="epub-view" ref={viewRef} />
        <button className="epub-nav" onClick={() => renditionRef.current?.next()}>›</button>
      </div>
    </div>
  );
}
