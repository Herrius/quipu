import { invoke } from "@tauri-apps/api/core";

export interface Book {
  id: number;
  title: string;
  authors: string;
  format: "pdf" | "epub";
  has_cover: boolean;
  percent: number;
  location: string | null;
  last_read: string | null;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  missing: number;
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
};
