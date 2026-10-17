/**
 * Benchmark consistency chart as an SVG string (pure; no DOM). Dark-surface palette validated with the
 * dataviz validator: score dots #3987e5, rolling median #d95926 on surface #121d2c (all-pairs CVD ΔE 26.8).
 * Scores are integers and dates come from sanitized records; labels are still escaped.
 */
export const CHART = Object.freeze({ width: 720, height: 260, left: 40, right: 74, top: 14, bottom: 30, maxRuns: 40 });
const COLORS = Object.freeze({ score: '#3987e5', median: '#d95926', surface: '#121d2c', grid: '#27384b', muted: '#8fa2b7', target: '#c3cfdc' });
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** y-domain in tens that always contains the scores and the target, with a little headroom. */
export function yDomain(scores, target) {
  const lo = Math.min(target, ...scores), hi = Math.max(target, ...scores);
  return [Math.max(0, Math.floor((lo - 5) / 10) * 10), Math.ceil((hi + 5) / 10) * 10];
}

export function chartLayout(points, target, dims = CHART) {
  const shown = points.slice(-dims.maxRuns);
  const [y0, y1] = yDomain(shown.map(p => p.score), target);
  const plotW = dims.width - dims.left - dims.right, plotH = dims.height - dims.top - dims.bottom;
  const step = shown.length > 1 ? plotW / (shown.length - 1) : 0;
  const x = i => dims.left + (shown.length > 1 ? i * step : plotW / 2);
  const y = v => dims.top + plotH * (1 - (v - y0) / (y1 - y0));
  return { shown, y0, y1, x, y, xs: shown.map((_, i) => x(i)), plotW, plotH, dims };
}

/** Index of the run whose x is closest to px (crosshair snapping). */
export function nearestIndex(xs, px) {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
  return best;
}

function linePath(pts) {
  let d = '', pen = false;
  for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; pen = true; }
  return d;
}

export function scoreChartSvg(points, target, dims = CHART) {
  const L = chartLayout(points, target, dims);
  const { shown, x, y, y0, y1, dims: d } = L;
  const right = d.width - d.right, bottom = d.height - d.bottom;
  const ticks = []; for (let v = y0; v <= y1; v += (y1 - y0 > 60 ? 20 : 10)) ticks.push(v);
  const grid = ticks.map(v => `<line x1="${d.left}" x2="${right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${COLORS.grid}" stroke-width="1"/><text x="${d.left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="axis">${v}</text>`).join('');
  // Band: one polygon per contiguous run of non-null percentiles.
  const segments = []; let cur = [];
  shown.forEach((p, i) => { if (p.p10 !== null && p.p90 !== null) cur.push(i); else if (cur.length) { segments.push(cur); cur = []; } });
  if (cur.length) segments.push(cur);
  const band = segments.filter(s => s.length > 1).map(s => `<polygon points="${[...s.map(i => `${x(i).toFixed(1)},${y(shown[i].p90).toFixed(1)}`), ...[...s].reverse().map(i => `${x(i).toFixed(1)},${y(shown[i].p10).toFixed(1)}`)].join(' ')}" fill="${COLORS.median}" fill-opacity="0.12"/>`).join('');
  const medPath = linePath(shown.map((p, i) => p.median === null ? null : [x(i), y(p.median)]));
  const last = shown.at(-1);
  const xTicks = shown.length ? [0, shown.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => `<text x="${x(i).toFixed(1)}" y="${bottom + 18}" text-anchor="${i === 0 && shown.length > 1 ? 'start' : 'end'}" class="axis">Run ${shown[i].run}</text>`).join('') : '';
  return `<svg class="score-chart" viewBox="0 0 ${d.width} ${d.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
  ${grid}
  ${band}
  <line x1="${d.left}" x2="${right}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" stroke="${COLORS.target}" stroke-width="1"/>
  <text x="${right + 6}" y="${(y(target) + 4).toFixed(1)}" class="axis strong">${esc(target)} target</text>
  ${medPath ? `<path d="${medPath}" fill="none" stroke="${COLORS.median}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
  ${shown.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4" fill="${COLORS.score}" stroke="${COLORS.surface}" stroke-width="2"/>`).join('')}
  ${last?.median !== null && last?.median !== undefined && Math.abs(y(last.median) - y(target)) > 12 ? `<text x="${right + 6}" y="${(y(last.median) + 4).toFixed(1)}" class="axis">median ${esc(last.median)}</text>` : ''}
  ${xTicks}
  <line class="crosshair" x1="0" x2="0" y1="${d.top}" y2="${bottom}" stroke="${COLORS.muted}" stroke-width="1" visibility="hidden"/>
</svg>`;
}
