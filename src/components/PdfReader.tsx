import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, type Book } from "../api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

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
      if (!cancelled && ref.current) ref.current.replaceChildren(canvas);
    })().catch(() => {
      /* render cancelado al hacer scroll/zoom: esperado */
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageNum, scale]);

  return <div className="pdf-page" ref={ref} style={{ width, height }} />;
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
  const restored = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    let active = true;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      const bytes = await api.readBook(book.id);
      const d = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
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
  }, [baseSize, zoom, doc]);

  const pageW = baseSize ? baseSize.w * scale : 0;
  const pageH = baseSize ? baseSize.h * scale : 0;

  // Restaurar la posición guardada una sola vez, cuando ya hay layout.
  useEffect(() => {
    if (!doc || !pageH || restored.current) return;
    restored.current = true;
    containerRef.current?.scrollTo({ top: (page - 1) * (pageH + PAGE_GAP) });
  }, [doc, pageH, page]);

  // Guardar progreso con debounce.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      api.saveProgress(book.id, String(page), page / doc.numPages);
    }, 600);
    return () => clearTimeout(t);
  }, [page, doc, book.id]);

  function onScroll() {
    const el = containerRef.current;
    if (!el || !pageH) return;
    const center = el.scrollTop + el.clientHeight / 2;
    const p = Math.min(
      doc?.numPages ?? 1,
      Math.max(1, Math.floor(center / (pageH + PAGE_GAP)) + 1),
    );
    if (p !== pageRef.current) setPage(p);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          <button className="btn btn-ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>−</button>
          <button className="btn btn-ghost" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="btn btn-ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>+</button>
          <span className="reader-pos">
            {doc ? `${page} / ${doc.numPages}` : "…"}
          </span>
        </div>
      </header>
      <div className="pdf-scroll" ref={containerRef} onScroll={onScroll}>
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
    </div>
  );
}
