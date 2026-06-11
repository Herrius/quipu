import type { Bookmark, Highlight } from "../api";

interface Props {
  highlights: Highlight[];
  bookmarks: Bookmark[];
  onJump: (location: string) => void;
  onDeleteHighlight: (id: number) => void;
  onDeleteBookmark: (id: number) => void;
  onClose: () => void;
}

function locationLabel(page: number | null, fallback = "ubicación") {
  return page !== null ? `p. ${page}` : fallback;
}

export function ReaderPanel({
  highlights,
  bookmarks,
  onJump,
  onDeleteHighlight,
  onDeleteBookmark,
  onClose,
}: Props) {
  return (
    <aside className="reader-panel">
      <header className="panel-header">
        <span>Notas del libro</span>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </header>

      <section>
        <h3>🔖 Marcadores</h3>
        {bookmarks.length === 0 && <p className="panel-empty">Sin marcadores.</p>}
        {bookmarks.map((b) => (
          <div key={b.id} className="panel-item">
            <button className="panel-jump" onClick={() => onJump(b.location)}>
              {locationLabel(b.page)} · {b.created_at.slice(0, 10)}
            </button>
            <button
              className="btn btn-ghost panel-delete"
              title="Eliminar marcador"
              onClick={() => onDeleteBookmark(b.id)}
            >
              🗑
            </button>
          </div>
        ))}
      </section>

      <section>
        <h3>✏️ Subrayados</h3>
        {highlights.length === 0 && (
          <p className="panel-empty">
            Selecciona texto en el libro para subrayar. Se exporta a tu vault.
          </p>
        )}
        {highlights.map((h) => (
          <div key={h.id} className="panel-item panel-highlight">
            <button className="panel-jump" onClick={() => onJump(h.location)}>
              <span className="panel-loc">{locationLabel(h.page, "epub")}</span>
              <span className="panel-text">{h.text}</span>
            </button>
            <button
              className="btn btn-ghost panel-delete"
              title="Eliminar subrayado"
              onClick={() => onDeleteHighlight(h.id)}
            >
              🗑
            </button>
          </div>
        ))}
      </section>
    </aside>
  );
}
