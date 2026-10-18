/** Pure roving-focus logic for the heatmap grid (WAI-ARIA grid pattern). Returns null for unhandled keys. */
export function nextGridPosition({ row, col }, key, rows, cols, { ctrl = false } = {}) {
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
  switch (key) {
    case 'ArrowUp': return { row: clamp(row - 1, rows), col };
    case 'ArrowDown': return { row: clamp(row + 1, rows), col };
    case 'ArrowLeft': return { row, col: clamp(col - 1, cols) };
    case 'ArrowRight': return { row, col: clamp(col + 1, cols) };
    case 'Home': return ctrl ? { row: 0, col: 0 } : { row, col: 0 };
    case 'End': return ctrl ? { row: rows - 1, col: cols - 1 } : { row, col: cols - 1 };
    case 'PageUp': return { row: 0, col };
    case 'PageDown': return { row: rows - 1, col };
    default: return null;
  }
}

/** Deep-link hash for a heatmap selection: `#heatmap/<op>/<scope>/<row>/<col>`. */
export function heatmapHash(op, scope, cell) { return `#heatmap/${op}/${scope}${cell ? `/${cell.row}/${cell.col}` : ''}`; }
export function parseHeatmapHash(hash) {
  const m = /^#heatmap\/(add|sub|mul|div)\/(benchmark|all)(?:\/(\d{1,2})\/(\d{1,2}))?$/.exec(hash ?? '');
  if (!m) return null;
  return { op: m[1], scope: m[2], cell: m[3] === undefined ? null : { row: Number(m[3]), col: Number(m[4]) } };
}
