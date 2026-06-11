import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, type Book } from "./api";
import { Library } from "./components/Library";
import "./App.css";

const PdfReader = lazy(() =>
  import("./components/PdfReader").then((m) => ({ default: m.PdfReader })),
);
const EpubReader = lazy(() =>
  import("./components/EpubReader").then((m) => ({ default: m.EpubReader })),
);

export default function App() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [current, setCurrent] = useState<Book | null>(null);

  const refresh = useCallback(async () => {
    setBooks(await api.listBooks());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closeReader = useCallback(() => {
    setCurrent(null);
    refresh();
  }, [refresh]);

  const openBook = useCallback((book: Book) => {
    if (book.status === "por_leer") {
      api.setStatus(book.id, "leyendo").catch(() => {});
    }
    setCurrent(book);
  }, []);

  if (books === null) {
    return <div className="splash">Quipu</div>;
  }

  if (current) {
    return (
      <Suspense fallback={<div className="splash">…</div>}>
        {current.format === "pdf" ? (
          <PdfReader book={current} onClose={closeReader} />
        ) : (
          <EpubReader book={current} onClose={closeReader} />
        )}
      </Suspense>
    );
  }

  return <Library books={books} onOpen={openBook} onChanged={refresh} />;
}
