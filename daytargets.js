"use strict";
/* ==========================================================================
   Objectifs selon la journée (version 3.8) : trois jeux de calories et macros, choisis tout seuls
   d'après ce que tu as noté ce jour-là, ou à la main (« Complet prévu ce soir ») :
   - complet : séance de musculation avec vélo d'échauffement ET marche du retour ;
   - semi : une séance ou une course, sans tout ça ;
   - sans sport : rien de noté.
   Rangés dans les objectifs (targets.days, targets.dayOverrides) : synchronisés avec eux.
   ========================================================================== */

const DAY_TYPES = [
  ["full", "Complet", "vélo + musculation + marche retour"],
  ["semi", "Semi", "mini séance, séance sans marche ou course"],
  ["rest", "Sans sport", "aucune séance"]
];
const DAY_TYPE_LABEL = Object.fromEntries(DAY_TYPES.map(([k, l]) => [k, l]));
const DAY_MACROS = [["kcal", "kcal", [500, 10000]], ["protein", "P", [0, 1000]], ["carbs", "G", [0, 2000]], ["fat", "L", [0, 1000]]];

function dayTargetsEnabled() {
  const d = state.targets && state.targets.days;
  return Boolean(d && DAY_TYPES.some(([k]) => d[k] && d[k].kcal));
}
/* Type de journée d'après ce qui est noté. */
function autoDayType(date) {
  const ws = state.workouts.filter((w) => w.date === date);
  const lifted = (w) => (w.exercises || []).some((e) => validSets(e.sets).length);
  if (ws.some((w) => lifted(w) && (w.bikeKm || w.bikeTimeS) && w.walkKm)) return "full";
  if (ws.length || (state.runs || []).some((r) => r.date === date)) return "semi";
  return "rest";
}
function dayTypeFor(date) {
  const o = ((state.targets && state.targets.dayOverrides) || {})[date];
  return DAY_TYPE_LABEL[o] ? { type: o, auto: false } : { type: autoDayType(date), auto: true };
}
/* Objectifs à viser ce jour-là (les fibres et le poids cible restent communs). */
function targetsFor(date) {
  const g = state.targets || {};
  if (!dayTargetsEnabled()) return { ...g, dayType: null, dayAuto: true };
  const { type, auto } = dayTypeFor(date);
  const d = g.days[type] || {};
  const pick = (k) => (d[k] !== null && d[k] !== undefined ? d[k] : g[k]);
  return { ...g, kcal: pick("kcal"), protein: pick("protein"), carbs: pick("carbs"), fat: pick("fat"), dayType: type, dayAuto: auto };
}
function dayTargetsText(t) {
  return [t.kcal && `${fmt(t.kcal, 0)} kcal`, t.protein && `P ${fmt(t.protein, 0)} g`, t.carbs && `G ${fmt(t.carbs, 0)} g`, t.fat && `L ${fmt(t.fat, 0)} g`].filter(Boolean).join(" · ");
}
/* Choix à la main pour un jour (null = automatique). On garde les 30 derniers jours. */
async function setDayOverride(date, type) {
  const overrides = { ...((state.targets && state.targets.dayOverrides) || {}) };
  if (type && DAY_TYPE_LABEL[type]) overrides[date] = type; else delete overrides[date];
  const keep = addDays(today(), -30);
  Object.keys(overrides).forEach((d) => { if (d < keep) delete overrides[d]; });
  state.targets = normalizeTargets({ ...state.targets, dayOverrides: overrides });
  await setSetting("targets", state.targets);
}

/* Barre « Journée : Auto · Complet · Semi · Sans sport » (Accueil et Nutrition). */
function dayTypeBarHTML(date) {
  if (!dayTargetsEnabled()) return "";
  const { type, auto } = dayTypeFor(date);
  const detected = autoDayType(date);
  const btn = (value, label, active) => `<button type="button" class="chip-button day-chip${active ? " is-active" : ""}" data-day-type="${esc(value)}" data-day-date="${esc(date)}" aria-pressed="${active}">${esc(label)}</button>`;
  return `<div class="day-type-bar">
    <span class="day-type-title">Journée <b>${esc(DAY_TYPE_LABEL[type])}</b>${auto ? " (auto)" : " (choisie)"}</span>
    <div class="day-type-chips">${btn("auto", `Auto : ${DAY_TYPE_LABEL[detected]}`, auto)}${DAY_TYPES.map(([k, l]) => btn(k, l, !auto && type === k)).join("")}</div>
  </div>`;
}
async function onDayTypeClick(e) {
  const b = e.target.closest("[data-day-type]");
  if (!b) return;
  await withBusy(b, async () => {
    const v = b.dataset.dayType;
    await setDayOverride(b.dataset.dayDate, v === "auto" ? null : v);
    renderView(state.view);
    const t = targetsFor(b.dataset.dayDate);
    showToast(`Objectif ${v === "auto" ? "automatique" : "choisi"} : journée ${DAY_TYPE_LABEL[t.dayType].toLowerCase()}, ${dayTargetsText(t)}.`);
  });
}

/* ---------- Réglages ---------- */

function renderDayTargetsForm() {
  const form = document.getElementById("day-targets-form");
  const d = (state.targets && state.targets.days) || {};
  DAY_TYPES.forEach(([k]) => DAY_MACROS.forEach(([m]) => setField(form, `${k}-${m}`, d[k] ? d[k][m] : null)));
}
async function onDayTargetsSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  await withBusy(form.querySelector("[type=submit]"), async () => {
    const days = {};
    DAY_TYPES.forEach(([k, label]) => {
      const row = {};
      DAY_MACROS.forEach(([m, short, range]) => { row[m] = readNumber(form, `${k}-${m}`, { min: range[0], max: range[1], decimals: 0, label: `${label} · ${short}` }); });
      if (Object.values(row).some((v) => v !== null)) {
        if (row.kcal === null) throw new UserError(`${label} : indique au moins les calories.`);
        days[k] = row;
      }
    });
    state.targets = normalizeTargets({ ...state.targets, days });
    await setSetting("targets", state.targets);
    showToast(Object.keys(days).length ? "Objectifs par journée enregistrés : l'accueil et la nutrition s'adaptent tout seuls." : "Objectifs par journée retirés : un seul objectif pour tous les jours.");
  });
}
function setupDayTargets() {
  document.getElementById("day-targets-form").addEventListener("submit", onDayTargetsSubmit);
  document.getElementById("day-targets-clear").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!confirm("Revenir à un seul objectif pour tous les jours ?")) return;
    state.targets = normalizeTargets({ ...state.targets, days: {} });
    await setSetting("targets", state.targets);
    renderDayTargetsForm();
    showToast("Objectifs par journée retirés.");
  }));
  document.addEventListener("click", (e) => { if (e.target.closest("[data-day-type]")) onDayTypeClick(e).catch((err) => showToast(humanError(err), "error")); });
}
