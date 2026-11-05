"use strict";
/* ==========================================================================
   Graphiques en SVG dessinés à la main : aucune bibliothèque, fonctionne hors ligne.
   ========================================================================== */

/* series : [{ name, cls, points: [{ x: "AAAA-MM-JJ", y: nombre }], dots: true|false, line: true|false }] */
function lineChart(container, { series, unit = "", decimals = 1, height = 200, emptyText = "Pas encore assez de données." }) {
  const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.y) && isValidISO(p.x));
  if (all.length < 2) {
    container.innerHTML = `<p class="empty">${esc(emptyText)}</p>`;
    return;
  }
  const width = Math.max(300, Math.round(container.clientWidth || 340));
  const pad = { top: 14, right: 14, bottom: 26, left: 44 };
  const xs = all.map((p) => parseISO(p.x).getTime());
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  if (xMin === xMax) { xMin -= 86400000; xMax += 86400000; }
  let yMin = Math.min(...all.map((p) => p.y)), yMax = Math.max(...all.map((p) => p.y));
  const span = yMax - yMin || Math.max(1, Math.abs(yMax) * 0.05);
  yMin -= span * 0.12; yMax += span * 0.12;

  const X = (iso) => pad.left + ((parseISO(iso).getTime() - xMin) / (xMax - xMin)) * (width - pad.left - pad.right);
  const Y = (v) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * (height - pad.top - pad.bottom);

  const ticks = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3);
  const grid = ticks.map((t) => `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/>
    <text class="chart-label" x="${pad.left - 6}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t, decimals))}</text>`).join("");
  const firstIso = isoDate(new Date(xMin)), lastIso = isoDate(new Date(xMax));
  const xLabels = `<text class="chart-label" x="${pad.left}" y="${height - 6}" text-anchor="start">${esc(fmtShortDate(firstIso))}</text>
    <text class="chart-label" x="${width - pad.right}" y="${height - 6}" text-anchor="end">${esc(fmtShortDate(lastIso))}</text>`;

  const layers = series.map((s) => {
    const pts = s.points.filter((p) => Number.isFinite(p.y) && isValidISO(p.x)).sort((a, b) => a.x.localeCompare(b.x));
    const path = s.line !== false && pts.length > 1
      ? `<path class="chart-line ${esc(s.cls)}" d="${pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>` : "";
    const dots = s.dots ? pts.map((p) => `<circle class="chart-dot ${esc(s.cls)}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3"><title>${esc(fmtShortDate(p.x))} : ${esc(fmt(p.y, decimals))} ${esc(unit)}</title></circle>`).join("") : "";
    return path + dots;
  }).join("");

  const legend = series.filter((s) => s.name).map((s) => `<span class="legend-item"><span class="legend-swatch ${esc(s.cls)}"></span>${esc(s.name)}</span>`).join("");
  container.innerHTML = `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Graphique">${grid}${xLabels}${layers}</svg>
    ${legend ? `<div class="chart-legend">${legend}</div>` : ""}`;
}

/* Barre de progression vers un objectif. La largeur est appliquée après insertion (compatible avec la politique de sécurité). */
function progressBar(value, target) {
  if (!target) return "";
  const pct = Math.max(0, Math.min(100, (value / target) * 100));
  const over = value > target * 1.05 ? "over" : "";
  return `<div class="progress ${over}"><div class="progress-fill" data-pct="${pct.toFixed(1)}"></div></div>`;
}
function applyProgressWidths(root = document) {
  $$(".progress-fill[data-pct]", root).forEach((el) => { el.style.width = `${el.dataset.pct}%`; });
}
