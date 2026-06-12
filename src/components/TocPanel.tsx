export interface TocItem {
  label: string;
  depth: number;
  /** Página (PDF, como string) o href (EPUB). */
  target: string;
  page: number | null;
}

interface Props {
  items: TocItem[] | null; // null = aún cargando
  onJump: (item: TocItem) => void;
  onClose: () => void;
}

export function TocPanel({ items, onJump, onClose }: Props) {
  return (
    <aside className="reader-panel">
      <header className="panel-header">
        <span>Índice</span>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </header>
      {items === null && <p className="panel-empty">Cargando…</p>}
      {items?.length === 0 && (
        <p className="panel-empty">
          Este libro no trae índice embebido. Puedes usar los marcadores 🔖
          para crear tus propios puntos de salto.
        </p>
      )}
      {items?.map((item, i) => (
        <button
          key={i}
          className="toc-item"
          style={{ paddingLeft: `${0.4 + item.depth * 0.9}rem` }}
          onClick={() => onJump(item)}
        >
          <span className="toc-label">{item.label}</span>
          {item.page !== null && <span className="toc-page">{item.page}</span>}
        </button>
      ))}
    </aside>
  );
}
