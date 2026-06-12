import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type Status = "por_leer" | "leyendo" | "leido";

export interface Book {
  id: number;
  title: string;
  authors: string;
  format: "pdf" | "epub";
  has_cover: boolean;
  percent: number;
  location: string | null;
  last_read: string | null;
  status: Status;
  rating: number | null;
  managed: boolean;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  missing: number;
}

export interface Highlight {
  id: number;
  location: string;
  page: number | null;
  text: string;
  created_at: string;
}

export interface Bookmark {
  id: number;
  location: string;
  page: number | null;
  created_at: string;
}

export const api = {
  detectCalibreLibrary: () =>
    invoke<string | null>("detect_calibre_library"),

  importCalibre: (libraryPath: string) =>
    invoke<ImportResult>("import_calibre", { libraryPath }),

  listBooks: () => invoke<Book[]>("list_books"),

  readBook: (bookId: number) =>
    invoke<ArrayBuffer>("read_book", { bookId }),

  readCover: (bookId: number) =>
    invoke<ArrayBuffer>("read_cover", { bookId }),

  saveProgress: (bookId: number, location: string, percent: number) =>
    invoke<void>("save_progress", { bookId, location, percent }),

  setStatus: (bookId: number, status: Status) =>
    invoke<void>("set_status", { bookId, status }),

  setRating: (bookId: number, rating: number | null) =>
    invoke<void>("set_rating", { bookId, rating }),

  addHighlight: (bookId: number, location: string, page: number | null, text: string) =>
    invoke<void>("add_highlight", { bookId, location, page, text }),

  listHighlights: (bookId: number) =>
    invoke<Highlight[]>("list_highlights", { bookId }),

  deleteHighlight: (highlightId: number) =>
    invoke<void>("delete_highlight", { highlightId }),

  addBookmark: (bookId: number, location: string, page: number | null) =>
    invoke<void>("add_bookmark", { bookId, location, page }),

  listBookmarks: (bookId: number) =>
    invoke<Bookmark[]>("list_bookmarks", { bookId }),

  deleteBookmark: (bookmarkId: number) =>
    invoke<void>("delete_bookmark", { bookmarkId }),

  getExportDir: () => invoke<string | null>("get_export_dir"),

  setExportDir: (path: string) =>
    invoke<void>("set_export_dir", { path }),

  deleteBookNotes: (bookId: number) =>
    invoke<void>("delete_book_notes", { bookId }),

  removeBook: (bookId: number) =>
    invoke<void>("remove_book", { bookId }),

  ingestBook: (srcPath: string) =>
    invoke<number>("ingest_book", { srcPath }),

  saveCover: (bookId: number, jpeg: ArrayBuffer) =>
    invoke<void>("save_cover", new Uint8Array(jpeg), {
      headers: { "book-id": String(bookId) },
    }),

  updateBookMeta: (bookId: number, title: string, authors: string) =>
    invoke<void>("update_book_meta", { bookId, title, authors }),

  syncState: () =>
    invoke<{ pulled: number; pushed: number }>("sync_state"),
};

/** Pide al usuario la carpeta del vault donde van los subrayados. */
export async function pickExportDir(): Promise<string | null> {
  const dir = await open({
    directory: true,
    title: "Carpeta de Obsidian para tus subrayados",
  });
  if (typeof dir !== "string") return null;
  await api.setExportDir(dir);
  return dir;
}

/** Subraya; si falta configurar la carpeta del vault, la pide y reintenta. */
export async function addHighlightEnsuringDir(
  bookId: number,
  location: string,
  page: number | null,
  text: string,
): Promise<boolean> {
  try {
    await api.addHighlight(bookId, location, page, text);
    return true;
  } catch (e) {
    if (!String(e).includes("Configura la carpeta")) throw e;
    const dir = await pickExportDir();
    if (!dir) return false;
    await api.addHighlight(bookId, location, page, text);
    return true;
  }
}
