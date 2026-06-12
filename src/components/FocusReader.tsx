import { useCallback, useEffect, useRef, useState } from "react";

export interface WordChunk {
  words: string[];
  /** Página (PDF) o índice de capítulo (EPUB) del que vienen las palabras. */
  marker: number;
}

interface Word {
  text: string;
  marker: number;
}

export interface FocusPosition {
  marker: number;
  /** Índice de palabra DENTRO de ese marker (página/capítulo). */
  offset: number;
}

/** Posición exacta (palabra) donde pausó el modo enfocado, por libro. */
export function loadRsvpPosition(bookId: number): FocusPosition | null {
  try {
    return JSON.parse(localStorage.getItem(`quipu.rsvp.${bookId}`) ?? "null");
  } catch {
    return null;
  }
}

export function saveRsvpPosition(bookId: number, pos: FocusPosition) {
  localStorage.setItem(`quipu.rsvp.${bookId}`, JSON.stringify(pos));
}

interface Props {
  title: string;
  /** Devuelve el siguiente bloque de palabras, o null si no hay más. */
  loadMore: () => Promise<WordChunk | null>;
  /** Palabra inicial dentro del primer bloque (reanudar donde pausó). */
  initialOffset?: number;
  /** Al cerrar recibe la posición exacta de la última palabra mostrada. */
  onClose: (pos: FocusPosition | null) => void;
}

/** Punto de reconocimiento óptimo: la letra que se fija en el centro. */
function orpIndex(word: string): number {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

/** Duración de la palabra según largo y puntuación (mejora la comprensión). */
function wordDelay(word: string, wpm: number): number {
  let ms = 60000 / wpm;
  if (word.length > 8) ms *= 1.3;
  if (/[.!?…]$/.test(word)) ms *= 2;
  else if (/[,;:)]$/.test(word)) ms *= 1.5;
  return ms;
}

export function FocusReader({ title, loadMore, initialOffset = 0, onClose }: Props) {
  const [words, setWords] = useState<Word[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [wpm, setWpm] = useState(() =>
    Number(localStorage.getItem("quipu.wpm")) || 300,
  );
  const [light, setLight] = useState(
    () => localStorage.getItem("quipu.focusTheme") === "light",
  );
  const loading = useRef(false);
  const resumed = useRef(false);
  const idxRef = useRef(0);
  idxRef.current = idx;
  const wordsRef = useRef(words);
  wordsRef.current = words;

  // Reanudar en la palabra exacta donde pausó (dentro del primer bloque).
  useEffect(() => {
    if (resumed.current || words.length === 0) return;
    resumed.current = true;
    if (initialOffset > 0) {
      setIdx(Math.min(initialOffset, words.length - 1));
    }
  }, [words, initialOffset]);

  useEffect(() => {
    localStorage.setItem("quipu.wpm", String(wpm));
  }, [wpm]);
  useEffect(() => {
    localStorage.setItem("quipu.focusTheme", light ? "light" : "dark");
  }, [light]);

  const fetchMore = useCallback(async () => {
    if (loading.current || exhausted) return;
    loading.current = true;
    try {
      // Saltar bloques vacíos (páginas sin texto, portadas escaneadas…).
      for (;;) {
        const chunk = await loadMore();
        if (!chunk) {
          setExhausted(true);
          return;
        }
        if (chunk.words.length > 0) {
          setWords((w) => [
            ...w,
            ...chunk.words.map((text) => ({ text, marker: chunk.marker })),
          ]);
          return;
        }
      }
    } finally {
      loading.current = false;
    }
  }, [loadMore, exhausted]);

  useEffect(() => {
    fetchMore();
  }, [fetchMore]);

  // Bucle de reproducción.
  useEffect(() => {
    if (!playing) return;
    const current = words[idx];
    if (!current) {
      if (exhausted) setPlaying(false);
      return;
    }
    if (idx > words.length - 200) fetchMore();
    const t = setTimeout(() => setIdx((i) => i + 1), wordDelay(current.text, wpm));
    return () => clearTimeout(t);
  }, [playing, idx, words, wpm, exhausted, fetchMore]);

  const close = useCallback(() => {
    const all = wordsRef.current;
    const i = Math.min(idxRef.current, all.length - 1);
    const w = all[i];
    if (!w) {
      onClose(null);
      return;
    }
    const firstOfMarker = all.findIndex((x) => x.marker === w.marker);
    onClose({ marker: w.marker, offset: i - firstOfMarker });
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Escape") {
        close();
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        setIdx((i) => Math.max(0, i - 15));
      } else if (e.key === "ArrowRight") {
        setIdx((i) => Math.min(wordsRef.current.length - 1, i + 15));
      } else if (e.key === "ArrowUp") {
        setWpm((v) => Math.min(900, v + 25));
      } else if (e.key === "ArrowDown") {
        setWpm((v) => Math.max(100, v - 25));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const word = words[idx]?.text ?? (exhausted ? "— fin —" : "…");
  const pivot = orpIndex(word);
  const progress = words.length ? Math.min(1, idx / words.length) : 0;

  return (
    <div className={`focus-overlay ${light ? "focus-light" : "focus-dark"}`}>
      <div className="focus-progress" style={{ width: `${progress * 100}%` }} />
      <header className="focus-bar">
        <span className="focus-title">{title}</span>
        <button className="btn btn-ghost" onClick={() => setLight((l) => !l)}>
          {light ? "🌙" : "☀️"}
        </button>
        <button className="btn btn-ghost" title="Salir (Esc)" onClick={close}>
          ✕
        </button>
      </header>

      <div className="focus-stage" onClick={() => setPlaying((p) => !p)}>
        <div className="focus-guide" />
        <div className="rsvp-word" aria-live="off">
          <span className="rsvp-pre">{word.slice(0, pivot)}</span>
          <span className="rsvp-orp">{word[pivot] ?? ""}</span>
          <span className="rsvp-post">{word.slice(pivot + 1)}</span>
        </div>
        {!playing && (
          <p className="focus-hint">
            espacio: leer/pausa · ←/→: saltar · ↑/↓: velocidad
          </p>
        )}
      </div>

      <footer className="focus-controls">
        <button
          className="btn btn-ghost"
          onClick={() => {
            setPlaying(false);
            setIdx((i) => Math.max(0, i - 15));
          }}
        >
          ⏪
        </button>
        <button className="btn focus-play" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸ Pausa" : "▶ Leer"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setIdx((i) => Math.min(words.length - 1, i + 15))}
        >
          ⏩
        </button>
        <span className="focus-wpm">
          <button className="btn btn-ghost" onClick={() => setWpm((v) => Math.max(100, v - 25))}>−</button>
          <strong>{wpm}</strong> ppm
          <button className="btn btn-ghost" onClick={() => setWpm((v) => Math.min(900, v + 25))}>+</button>
        </span>
      </footer>
    </div>
  );
}
