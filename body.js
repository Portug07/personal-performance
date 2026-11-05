"use strict";
/* ==========================================================================
   Progression corporelle : pesées, moyenne sur 7 jours, rythme par semaine,
   objectif de poids, mensurations, courbe.
   ========================================================================== */

const MEASURE_FIELDS = [
  ["weight", "Poids", "kg", LIMITS.weight], ["waist", "Tour de taille", "cm", LIMITS.cm], ["belly", "Tour de ventre", "cm", LIMITS.cm],
  ["chest", "Tour de poitrine", "cm", LIMITS.cm], ["arm", "Tour de bras", "cm", LIMITS.cm], ["thigh", "Tour de cuisse", "cm", LIMITS.cm]
];
const LIST_PAGE_SIZE = 15;

async function reloadMeasurements() {
  state.measurements = (await getByType("measurement")).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

/* Un poids par jour (moyenne si plusieurs pesées), du plus ancien au plus récent. */
function dailyWeights() {
  const byDay = new Map();
  state.measurements.forEach((m) => {
    if (m.weight === null || m.weight === undefined) return;
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(Number(m.weight));
  });
  return [...byDay.entries()].map(([date, ws]) => ({ date, weight: average(ws) })).sort((a, b) => a.date.localeCompare(b.date));
}
/* Moyenne des pesées sur les 7 jours qui finissent à « endIso ». Lisse les variations d'eau. */
function weightAverage(daily, endIso, days = 7) {
  const start = addDays(endIso, -(days - 1));
  return average(daily.filter((d) => d.date >= start && d.date <= endIso).map((d) => d.weight));
}
function weightStats() {
  const daily = dailyWeights();
  if (!daily.length) return null;
  const t = today();
  const last = daily[daily.length - 1];
  const avg7 = weightAverage(daily, t);
  const prev7 = weightAverage(daily, addDays(t, -7));
  return {
    daily, last, avg7, prev7,
    weekly: avg7 !== null && prev7 !== null ? avg7 - prev7 : null,
    sinceStart: (avg7 ?? last.weight) - daily[0].weight,
    first: daily[0]
  };
}

function renderWeightSummary() {
  const el = document.getElementById("weight-summary");
  const s = weightStats();
  const target = state.targets.weight;
  if (!s) { el.innerHTML = '<p class="empty">Aucune pesée pour le moment. Note ton poids ci-dessous.</p>'; return; }
  const current = s.avg7 ?? s.last.weight;
  el.innerHTML = `<div class="metric-grid">
    <article class="metric-card"><span class="metric-label">Dernière pesée</span><strong>${fmt(s.last.weight, 1)}</strong><small>kg · ${esc(fmtShortDate(s.last.date))}</small></article>
    <article class="metric-card"><span class="metric-label">Moyenne 7 jours</span><strong>${fmt(s.avg7, 1)}</strong><small>kg · plus fiable qu'une pesée isolée</small></article>
    <article class="metric-card"><span class="metric-label">Rythme</span><strong>${s.weekly === null ? "—" : fmtSigned(s.weekly, 1)}</strong><small>kg sur 7 jours (moyenne vs semaine d'avant)</small></article>
    <article class="metric-card"><span class="metric-label">${target ? "Objectif" : "Depuis le début"}</span><strong>${target ? fmt(target, 1) : fmtSigned(s.sinceStart, 1)}</strong>
      <small>${target ? `kg · reste ${fmt(Math.max(0, current - target), 1)} kg` : `kg depuis le ${esc(fmtShortDate(s.first.date))}`}</small></article>
  </div>`;
}

function renderWeightChart() {
  const el = document.getElementById("weight-chart");
  const s = weightStats();
  if (!s) { el.innerHTML = ""; return; }
  const from = state.weightRange ? addDays(today(), -state.weightRange) : "0000-01-01";
  const daily = s.daily.filter((d) => d.date >= from);
  /* Moyenne glissante sur 7 jours, calculée en un seul passage. */
  const trend = [];
  let startIdx = 0, total = 0;
  s.daily.forEach((d, i) => {
    total += d.weight;
    const windowStart = addDays(d.date, -6);
    while (s.daily[startIdx].date < windowStart) { total -= s.daily[startIdx].weight; startIdx++; }
    if (d.date >= from) trend.push({ x: d.date, y: round(total / (i - startIdx + 1), 2) });
  });
  const series = [
    { name: "Pesées", cls: "s-load", dots: true, line: false, points: daily.map((d) => ({ x: d.date, y: d.weight })) },
    { name: "Moyenne 7 jours", cls: "s-trend", points: trend }
  ];
  if (state.targets.weight && daily.length > 1) {
    series.push({ name: "Objectif", cls: "s-target", points: [{ x: daily[0].date, y: state.targets.weight }, { x: daily[daily.length - 1].date, y: state.targets.weight }] });
  }
  lineChart(el, { series, unit: "kg", emptyText: "Au moins deux pesées sur la période sont nécessaires pour tracer la courbe." });
  $$("[data-range]").forEach((b) => b.classList.toggle("active", Number(b.dataset.range) === state.weightRange));
}

function renderMeasureEvolution() {
  const el = document.getElementById("measure-evolution");
  const rows = MEASURE_FIELDS.slice(1).map(([key, label]) => {
    const values = state.measurements.filter((m) => m[key] !== null && m[key] !== undefined).sort((a, b) => a.date.localeCompare(b.date));
    if (!values.length) return "";
    const first = values[0], last = values[values.length - 1];
    return `<tr><td>${esc(label)}</td><td>${fmt(first[key], 1)} cm <small>${esc(fmtShortDate(first.date))}</small></td><td>${fmt(last[key], 1)} cm <small>${esc(fmtShortDate(last.date))}</small></td><td>${values.length > 1 ? `${fmtSigned(last[key] - first[key], 1)} cm` : "—"}</td></tr>`;
  }).join("");
  el.innerHTML = rows ? `<table class="data-table"><thead><tr><th>Mesure</th><th>Première</th><th>Dernière</th><th>Écart</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">Aucune mensuration enregistrée.</p>';
}

function renderMeasurementHistory() {
  const el = document.getElementById("measurement-history");
  const list = state.measurements;
  if (!list.length) { el.innerHTML = '<p class="empty">Aucune mesure enregistrée.</p>'; return; }
  const shown = list.slice(0, state.pages.measurements * LIST_PAGE_SIZE);
  el.innerHTML = shown.map((m) => {
    const bits = MEASURE_FIELDS.filter(([k]) => m[k] !== null && m[k] !== undefined).map(([k, label, unit]) => `${label} ${fmt(m[k], 1)} ${unit}`);
    if (m.moment && m.weight !== null && m.weight !== undefined) bits.push(`pesée : ${m.moment.toLowerCase()}`);
    return `<article class="record-item"><div class="record-main"><b>${esc(fmtDate(m.date))}</b><small>${esc(bits.join(" · ") || "Aucune mesure chiffrée")}</small>${m.notes ? `<p class="record-note">${esc(m.notes)}</p>` : ""}</div>
      <div class="record-actions"><button type="button" class="small-button" data-action="edit-measurement" data-id="${esc(m.id)}">Modifier</button><button type="button" class="small-button delete" data-action="delete-record" data-id="${esc(m.id)}">Supprimer</button></div></article>`;
  }).join("") + (list.length > shown.length ? `<button type="button" class="secondary-button" data-action="more" data-list="measurements">Afficher plus (${list.length - shown.length} restantes)</button>` : "");
}

function measurementForm() { return document.getElementById("measurement-form"); }
function resetMeasurementForm() {
  const form = measurementForm();
  state.editing.measurement = null;
  form.reset();
  form.elements.date.value = today();
  form.elements.moment.value = WEIGH_IN_MOMENTS[0];
  document.getElementById("measurement-submit").textContent = "Enregistrer les mesures";
  document.getElementById("measurement-cancel").hidden = true;
}
function startEditMeasurement(id) {
  const m = state.measurements.find((x) => x.id === id);
  if (!m) return;
  const form = measurementForm();
  state.editing.measurement = id;
  form.elements.date.value = m.date;
  MEASURE_FIELDS.forEach(([k]) => setField(form, k, m[k]));
  form.elements.moment.value = WEIGH_IN_MOMENTS.includes(m.moment) ? m.moment : "Autre";
  form.elements.notes.value = m.notes || "";
  document.getElementById("measurement-submit").textContent = "Enregistrer les modifications";
  document.getElementById("measurement-cancel").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function onMeasurementSubmit(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = measurementForm();
    const date = form.elements.date.value;
    if (!isValidISO(date)) throw new UserError("Choisis une date valide.");
    const existing = state.editing.measurement ? state.measurements.find((x) => x.id === state.editing.measurement) : null;
    const record = { id: existing ? existing.id : uid(), type: "measurement", date, notes: readText(form, "notes", 500), createdAt: existing ? existing.createdAt : undefined };
    MEASURE_FIELDS.forEach(([k, label, , [min, max]]) => { record[k] = readNumber(form, k, { min, max, decimals: k === "weight" ? 2 : 1, label }); });
    if (!MEASURE_FIELDS.some(([k]) => record[k] !== null)) throw new UserError("Renseigne au moins une mesure.");
    if (WEIGH_IN_MOMENTS.includes(form.elements.moment.value)) record.moment = form.elements.moment.value;
    await saveRecord(record);
    await reloadMeasurements();
    resetMeasurementForm();
    renderProgress();
    showToast(existing ? "Mesure modifiée." : "Mesures enregistrées.");
  });
}

function renderProgress() {
  safeRender("résumé du poids", renderWeightSummary);
  safeRender("courbe de poids", renderWeightChart);
  safeRender("mensurations", renderMeasureEvolution);
  safeRender("historique des mesures", renderMeasurementHistory);
  safeRender("progression par exercice", renderExerciseProgress);
  safeRender("batterie de tests", renderBattery);
}

function setupProgress() {
  measurementForm().addEventListener("submit", onMeasurementSubmit);
  document.getElementById("measurement-cancel").addEventListener("click", resetMeasurementForm);
  $$("[data-range]").forEach((b) => b.addEventListener("click", () => { state.weightRange = Number(b.dataset.range); renderWeightChart(); }));
}
