import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import { loadPdf } from "../pdf";
import {
  addHighlightEnsuringDir,
  api,
  type Book,
  type Bookmark,
  type Highlight,
} from "../api";
import { ReaderPanel } from "./ReaderPanel";
import { FocusReader, type WordChunk } from "./FocusReader";

const PAGE_GAP = 12;

interface PageProps {
  doc: PDFDocumentProxy;
  pageNum: number;
  width: number;
  height: number;
  scale: number;
}

function PdfPage({ doc, pageNum, width, height, scale }: PageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "1200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!visible) {
      el.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      task = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await task.promise;
      if (cancelled || !ref.current) return;

      // Capa de texto transparente encima del canvas: habilita seleccionar
      // texto (y por tanto subrayar) sobre el render.
      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      await textLayer.render();
      if (cancelled || !ref.current) return;
      ref.current.replaceChildren(canvas, textDiv);
    })().catch(() => {
      /* render cancelado al hacer scroll/zoom: esperado */
    });
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [visible, doc, pageNum, scale]);

  return (
    <div
      className="pdf-page"
      ref={ref}
      data-page={pageNum}
      style={{ width, height, "--scale-factor": scale } as React.CSSProperties}
    />
  );
}

interface Popup {
  x: number;
  y: number;
  text: string;
  page: number;
}

interface Props {
  book: Book;
  onClose: () => void;
}

export function PdfReader({ book, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(() => {
    const n = Number(book.location);
    return Number.isInteger(n) && n > 0 ? n : 1;
  });
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const focusPageRef = useRef(1);
  const restored = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  const reloadNotes = useCallback(async () => {
    setHighlights(await api.listHighlights(book.id));
    setBookmarks(await api.listBookmarks(book.id));
  }, [book.id]);

  useEffect(() => {
    reloadNotes();
  }, [reloadNotes]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let active = true;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      const bytes = await api.readBook(book.id);
      const d = await loadPdf(bytes);
      if (!active) {
        d.loadingTask.destroy();
        return;
      }
      loaded = d;
      const first = await d.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      if (!active) return;
      setBaseSize({ w: vp.width, h: vp.height });
      setDoc(d);
    })().catch((e) => active && setError(String(e)));
    return () => {
      active = false;
      loaded?.loadingTask.destroy();
    };
  }, [book.id]);

  // Escala "ajustar al ancho" × zoom del usuario.
  const scale = useMemo(() => {
    if (!baseSize || !containerRef.current) return 1;
    const available = containerRef.current.clientWidth - 48;
    return (available / baseSize.w) * zoom;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSize, zoom, doc]);

  const pageW = baseSize ? baseSize.w * scale : 0;
  const pageH = baseSize ? baseSize.h * scale : 0;

  const scrollToPage = useCallback(
    (p: number) => {
      containerRef.current?.scrollTo({ top: (p - 1) * (pageH + PAGE_GAP) });
    },
    [pageH],
  );

  // Restaurar la posición guardada una sola vez, cuando ya hay layout.
  useEffect(() => {
    if (!doc || !pageH || restored.current) return;
    restored.current = true;
    scrollToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageH]);

  // Guardar progreso con debounce.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      api.saveProgress(book.id, String(page), page / doc.numPages);
    }, 600);
    return () => clearTimeout(t);
  }, [page, doc, book.id]);

  function onScroll() {
    setPopup(null);
    const el = containerRef.current;
    if (!el || !pageH) return;
    const center = el.scrollTop + el.clientHeight / 2;
    const p = Math.min(
      doc?.numPages ?? 1,
      Math.max(1, Math.floor(center / (pageH + PAGE_GAP)) + 1),
    );
    if (p !== pageRef.current) setPage(p);
  }

  function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setPopup(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setPopup(null);
      return;
    }
    const anchor = sel.anchorNode;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    const pageEl = el?.closest("[data-page]");
    if (!pageEl) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setPopup({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text,
      page: Number(pageEl.getAttribute("data-page")),
    });
  }

  async function saveHighlight() {
    if (!popup) return;
    const ok = await addHighlightEnsuringDir(
      book.id,
      String(popup.page),
      popup.page,
      popup.text,
    ).catch((e) => {
      setToast(String(e));
      return false;
    });
    if (ok) {
      window.getSelection()?.removeAllRanges();
      setToast("Subrayado guardado en tu vault ✓");
      reloadNotes();
    }
    setPopup(null);
  }

  async function addBookmark() {
    await api.addBookmark(book.id, String(page), page);
    setToast(`Marcador en p. ${page} ✓`);
    reloadNotes();
  }

  function openFocusMode() {
    focusPageRef.current = page;
    setFocusMode(true);
  }

  // Entrega el texto de la siguiente página para el modo enfocado.
  const loadFocusWords = useCallback(async (): Promise<WordChunk | null> => {
    if (!doc || focusPageRef.current > doc.numPages) return null;
    const p = focusPageRef.current++;
    const pg = await doc.getPage(p);
    const content = await pg.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    return { words: text.split(/\s+/).filter(Boolean), marker: p };
  }, [doc]);

  function closeFocusMode(lastMarker: number | null) {
    setFocusMode(false);
    if (lastMarker !== null) {
      setPage(lastMarker);
      scrollToPage(lastMarker);
    }
  }

  useEffect(() => {
    if (focusMode) return; // el modo enfocado maneja su propio teclado
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, focusMode]);

  if (error) {
    return (
      <div className="reader-error">
        <p>No se pudo abrir el PDF: {error}</p>
        <button className="btn" onClick={onClose}>Volver</button>
      </div>
    );
  }

  return (
    <div className="reader">
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
          <button className="btn btn-ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>−</button>
          <button className="btn btn-ghost" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="btn btn-ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>+</button>
          <span className="reader-pos">
            {doc ? `${page} / ${doc.numPages}` : "…"}
          </span>
        </div>
      </header>
      <div className="reader-body">
        <div
          className="pdf-scroll"
          ref={containerRef}
          onScroll={onScroll}
          onMouseUp={onMouseUp}
        >
          {doc && baseSize ? (
            Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage
                key={`${i + 1}-${scale.toFixed(3)}`}
                doc={doc}
                pageNum={i + 1}
                width={pageW}
                height={pageH}
                scale={scale}
              />
            ))
          ) : (
            <p className="status">Cargando…</p>
          )}
        </div>
        {panelOpen && (
          <ReaderPanel
            highlights={highlights}
            bookmarks={bookmarks}
            onJump={(loc) => scrollToPage(Number(loc) || 1)}
            onDeleteHighlight={async (id) => {
              await api.deleteHighlight(id);
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
      {popup && (
        <button
          className="highlight-popup"
          style={{ left: popup.x, top: popup.y - 40 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={saveHighlight}
        >
          ✏️ Subrayar
        </button>
      )}
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
