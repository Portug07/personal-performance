"use strict";
/* ==========================================================================
   Vue d'ensemble : objectifs du jour, tendance de poids, séances de la semaine,
   rappel de sauvegarde, bilan de la période et « Copier pour Claude ».
   ========================================================================== */

let reviewDays = 7;

function renderDashboardCards() {
  const t = today();
  const todayMeals = state.recentMeals.filter((m) => m.date === t);
  const totals = mealTotals(todayMeals);
  const g = state.targets;
  const ws = weightStats();
  const weekStart = mondayOf(t);
  const weekWorkouts = state.workouts.filter((w) => w.date >= weekStart && w.date <= t);
  const el = document.getElementById("dash-cards");
  el.innerHTML = `
    <article class="metric-card"><span class="metric-label">Calories aujourd'hui</span>
      <strong>${fmt(totals.kcal, 0)}${g.kcal ? `<span class="metric-target"> / ${fmt(g.kcal, 0)}</span>` : ""}</strong>${progressBar(totals.kcal, g.kcal)}
      <small>${g.kcal ? (g.kcal - totals.kcal >= 0 ? `reste ${fmt(g.kcal - totals.kcal, 0)} kcal` : `<span class="danger-text">dépassé de ${fmt(totals.kcal - g.kcal, 0)} kcal</span>`) : "kcal · aucun objectif défini"}</small></article>
    <article class="metric-card"><span class="metric-label">Protéines aujourd'hui</span>
      <strong>${fmt(totals.protein, 0)}${g.protein ? `<span class="metric-target"> / ${fmt(g.protein, 0)} g</span>` : " g"}</strong>${progressBar(totals.protein, g.protein)}
      <small>${g.protein ? (g.protein - totals.protein > 0 ? `reste ${fmt(g.protein - totals.protein, 0)} g` : "objectif atteint") : "aucun objectif défini"}</small></article>
    <article class="metric-card"><span class="metric-label">Poids (moyenne 7 j)</span>
      <strong>${ws ? fmt(ws.avg7 ?? ws.last.weight, 1) : "—"}</strong>
      <small>${ws && ws.weekly !== null ? `${fmtSigned(ws.weekly, 1)} kg en 7 jours` : "kg · pèse-toi régulièrement"}</small></article>
    <article class="metric-card"><span class="metric-label">Séances cette semaine</span>
      <strong>${fmt(weekWorkouts.length, 0)}</strong>
      <small>${weekWorkouts.length ? esc(weekWorkouts.map((w) => w.sessionType).reverse().join(" · ")) : "depuis lundi"}</small></article>`;
  applyProgressWidths(el);
}

function renderChecklist() {
  const t = today();
  const items = [
    ["Journal alimentaire", state.recentMeals.some((m) => m.date === t), "nutrition"],
    ["Entraînement", state.workouts.some((w) => w.date === t), "training"],
    ["Pesée", state.measurements.some((m) => m.date === t && m.weight !== null), "progress"],
    ["Check-in récupération", state.wellbeing.some((w) => w.date === t), "wellbeing"]
  ];
  document.getElementById("daily-checklist").innerHTML = items.map(([label, done, view]) =>
    `<button type="button" class="check-row" data-go="${view}"><span class="check-dot ${done ? "done" : ""}"></span><span>${esc(label)}</span><span class="muted">${done ? "Renseigné" : "À renseigner"}</span></button>`).join("");
}

async function renderBackupStatus() {
  const last = await getSetting("lastBackupAt", null);
  const total = state.workouts.length + state.measurements.length + state.wellbeing.length + state.recentMeals.length;
  const el = document.getElementById("backup-alert");
  const stale = !last || Date.now() - last > 7 * 86400000;
  el.hidden = !(stale && total > 0);
  document.getElementById("backup-alert-text").textContent = last
    ? `Dernière sauvegarde ${timeAgo(last)}. Tes données n'existent que sur cet appareil : exporte une copie.`
    : "Aucune sauvegarde pour l'instant. Tes données n'existent que sur cet appareil : exporte une copie.";
}

function renderRecentActivity() {
  const items = [
    ...state.workouts.map((r) => ({ r, label: `Séance ${r.sessionType}`, detail: plural((r.exercises || []).length, "exercice") })),
    ...state.recentMeals.map((r) => ({ r, label: `${r.kind} · ${r.name}`, detail: `${fmt(r.kcal, 0)} kcal` })),
    ...state.measurements.map((r) => ({ r, label: "Mesures", detail: r.weight ? `${fmt(r.weight, 1)} kg` : "mensurations" })),
    ...state.wellbeing.map((r) => ({ r, label: "Check-in récupération", detail: r.sleep ? `sommeil ${fmt(r.sleep, 2)} h` : "" }))
  ].sort((a, b) => (b.r.updatedAt || 0) - (a.r.updatedAt || 0)).slice(0, 5);
  document.getElementById("recent-activity").innerHTML = items.length
    ? items.map((i) => `<div class="activity-item"><div><b>${esc(i.label)}</b><small>${esc(fmtDate(i.r.date))}</small></div><small>${esc(i.detail)}</small></div>`).join("")
    : '<p class="empty">Aucune donnée pour le moment. Commence par ajouter une séance ou un repas.</p>';
}

/* ---------- Bilan de période ---------- */

function periodData(days) {
  const to = today();
  const from = addDays(to, -(days - 1));
  const meals = state.recentMeals.filter((m) => m.date >= from && m.date <= to);
  const byDay = new Map();
  meals.forEach((m) => { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push(m); });
  const dayTotals = [...byDay.entries()].map(([date, list]) => ({ date, ...mealTotals(list) })).sort((a, b) => a.date.localeCompare(b.date));
  const workouts = state.workouts.filter((w) => w.date >= from && w.date <= to).slice().reverse();
  const well = wellbeingInRange(from, to);
  const ws = weightStats();
  const weighIns = ws ? ws.daily.filter((d) => d.date >= from && d.date <= to) : [];
  /* Alcool : entrées « Alcool » de Nutrition (verres standard calculés) + verres déclarés au check-in les jours sans entrée. */
  const drinks = alcoholTotals(meals);
  const drinkDays = new Set(meals.filter(isAlcoholEntry).map((m) => m.date));
  const declared = well.filter((w) => !drinkDays.has(w.date)).reduce((a, w) => a + (Number(w.alcohol) || 0), 0);
  const avgNow = ws ? weightAverage(ws.daily, to, 7) : null;
  const avgBefore = ws ? weightAverage(ws.daily, addDays(from, -1), 7) : null;
  return {
    from, to, days, dayTotals, workouts, well, weighIns, avgNow, avgBefore,
    avg: {
      kcal: average(dayTotals.map((d) => d.kcal)), protein: average(dayTotals.map((d) => d.protein)), carbs: average(dayTotals.map((d) => d.carbs)),
      fat: average(dayTotals.map((d) => d.fat)), fiber: average(dayTotals.map((d) => d.fiber)),
      sleep: average(well.map((w) => w.sleep)), fatigue: average(well.map((w) => w.fatigue)), stress: average(well.map((w) => w.stress)),
      motivation: average(well.map((w) => w.motivation)), water: average(well.map((w) => w.water))
    },
    alcohol: drinks.std + declared,
    alcoholKcal: drinks.kcal,
    painMax: well.reduce((a, w) => Math.max(a, Number(w.pain) || 0), 0),
    kneeMax: well.reduce((a, w) => Math.max(a, Number(w.kneeBefore) || 0, Number(w.kneeDuring) || 0, Number(w.kneeNext) || 0), 0)
  };
}

function renderReview() {
  const p = periodData(reviewDays);
  const g = state.targets;
  const rows = [
    ["Calories (moyenne)", p.avg.kcal === null ? "—" : `${fmt(p.avg.kcal, 0)} kcal${g.kcal ? ` / ${fmt(g.kcal, 0)}` : ""}`, `${p.dayTotals.length}/${p.days} jours renseignés`],
    ["Protéines (moyenne)", p.avg.protein === null ? "—" : `${fmt(p.avg.protein, 0)} g${g.protein ? ` / ${fmt(g.protein, 0)}` : ""}`, ""],
    ["Séances", fmt(p.workouts.length, 0), p.workouts.map((w) => w.sessionType).join(" · ")],
    ["Poids (moyenne 7 j)", p.avgNow === null ? "—" : `${fmt(p.avgNow, 1)} kg`, p.avgNow !== null && p.avgBefore !== null ? `${fmtSigned(p.avgNow - p.avgBefore, 1)} kg sur la période` : ""],
    ["Sommeil (moyenne)", p.avg.sleep === null ? "—" : `${fmt(p.avg.sleep, 1)} h`, ""],
    ["Alcool (total)", `${fmt(p.alcohol, 1)} verre(s) std`, p.alcoholKcal ? `${fmt(p.alcoholKcal, 0)} kcal` : ""]
  ];
  document.getElementById("review-table").innerHTML = `<tbody>${rows.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td><b>${esc(b)}</b></td><td class="muted">${esc(c)}</td></tr>`).join("")}</tbody>`;
  document.getElementById("review-period").textContent = `${fmtDate(p.from)} → ${fmtDate(p.to)}`;
}

/* Résumé texte à coller dans un projet Claude « Coach » : Claude analyse avec ton abonnement, sans API payante. */
function buildClaudeSummary(days = reviewDays) {
  const p = periodData(days);
  const g = state.targets;
  const L = [];
  L.push(`# Bilan Personal Performance du ${fmtDate(p.from)} au ${fmtDate(p.to)} (${days} jours)`);
  const goals = [g.kcal && `${fmt(g.kcal, 0)} kcal/j`, g.protein && `${fmt(g.protein, 0)} g de protéines/j`, g.carbs && `${fmt(g.carbs, 0)} g de glucides/j`, g.fat && `${fmt(g.fat, 0)} g de lipides/j`, g.weight && `poids cible ${fmt(g.weight, 1)} kg`].filter(Boolean);
  L.push(`Objectifs : ${goals.length ? goals.join(", ") : "non définis"}`);
  L.push("", `## Nutrition (${p.dayTotals.length}/${days} jours renseignés)`);
  if (p.dayTotals.length) {
    L.push(`- Moyenne par jour renseigné : ${fmt(p.avg.kcal, 0)} kcal, protéines ${fmt(p.avg.protein, 0)} g, glucides ${fmt(p.avg.carbs, 0)} g, lipides ${fmt(p.avg.fat, 0)} g, fibres ${fmt(p.avg.fiber, 0)} g`);
    p.dayTotals.forEach((d) => L.push(`- ${fmtWeekday(d.date)} : ${fmt(d.kcal, 0)} kcal, P ${fmt(d.protein, 0)} g, G ${fmt(d.carbs, 0)} g, L ${fmt(d.fat, 0)} g`));
  } else L.push("- Aucun repas saisi.");
  if (p.alcohol) L.push(`- Alcool : ${fmt(p.alcohol, 1)} verre(s) standard au total${p.alcoholKcal ? ` (${fmt(p.alcoholKcal, 0)} kcal, compris dans les calories)` : ""}`);
  L.push("", "## Poids");
  if (p.weighIns.length) {
    L.push(`- Moyenne 7 jours en fin de période : ${fmt(p.avgNow, 1)} kg${p.avgBefore !== null ? ` (avant la période : ${fmt(p.avgBefore, 1)} kg, soit ${fmtSigned(p.avgNow - p.avgBefore, 1)} kg)` : ""}`);
    L.push(`- Pesées : ${p.weighIns.map((d) => `${fmtShortDate(d.date)} ${fmt(d.weight, 1)}`).join(" ; ")}`);
  } else L.push("- Aucune pesée sur la période.");
  L.push("", `## Entraînement (${p.workouts.length} séance${p.workouts.length > 1 ? "s" : ""})`);
  p.workouts.forEach((w) => {
    L.push(`- ${fmtWeekday(w.date)} · ${w.sessionType}${w.duration ? ` (${fmt(w.duration, 0)} min)` : ""}${w.cardio ? ` · cardio : ${w.cardio}` : ""}`);
    (w.exercises || []).forEach((e) => L.push(`  - ${e.name} : ${validSets(e.sets).map(fmtSet).join(", ")}`));
    if (w.notes) L.push(`  - Notes : ${w.notes}`);
  });
  const flags = computeRecordFlags();
  const records = p.workouts.flatMap((w) => {
    return (w.exercises || []).filter((e) => flags.has(`${w.id}|${fold(e.name)}`)).map((e) => `${e.name} ${fmtSet(bestSet(e.sets))}`);
  });
  if (records.length) L.push(`- Records battus : ${records.join(", ")}`);
  L.push("", `## Récupération (${p.well.length} check-in${p.well.length > 1 ? "s" : ""})`);
  if (p.well.length) {
    L.push(`- Moyennes : sommeil ${fmt(p.avg.sleep, 1)} h, eau ${fmt(p.avg.water, 1)} L, fatigue ${fmt(p.avg.fatigue, 1)}/10, stress ${fmt(p.avg.stress, 1)}/10, motivation ${fmt(p.avg.motivation, 1)}/10`);
    L.push(`- Douleur genou maximale : ${fmt(p.kneeMax, 1)}/10 · autre douleur maximale : ${fmt(p.painMax, 0)}/10`);
    p.well.filter((w) => w.notes).forEach((w) => L.push(`- ${fmtWeekday(w.date)} : ${w.notes}`));
  } else L.push("- Aucun check-in.");
  L.push("", "Analyse cette période : ce qui va, ce qui bloque, et 3 ajustements concrets pour la suivante (nutrition, charges, récupération).");
  return L.join("\n");
}

async function copyClaudeSummary() {
  const text = buildClaudeSummary();
  try {
    await navigator.clipboard.writeText(text);
    showToast("Bilan copié : colle-le dans ton projet Claude « Coach ».");
  } catch {
    const dialog = document.getElementById("summary-dialog");
    document.getElementById("summary-text").value = text;
    dialog.showModal();
    document.getElementById("summary-text").select();
  }
}
async function shareClaudeSummary() {
  try {
    await navigator.share({ title: "Bilan Personal Performance", text: buildClaudeSummary() });
  } catch (err) {
    if (err && err.name !== "AbortError") copyClaudeSummary();
  }
}

function renderDashboard() {
  document.getElementById("today-label").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
  safeRender("cartes du tableau de bord", renderDashboardCards);
  safeRender("checklist", renderChecklist);
  safeRender("bilan", renderReview);
  safeRender("activité récente", renderRecentActivity);
  renderBackupStatus().catch(console.error);
}

function setupDashboard() {
  document.getElementById("review-days").addEventListener("change", (e) => { reviewDays = Number(e.target.value) || 7; renderReview(); });
  document.getElementById("copy-claude").addEventListener("click", copyClaudeSummary);
  const share = document.getElementById("share-claude");
  share.hidden = !navigator.share;
  share.addEventListener("click", shareClaudeSummary);
  document.getElementById("summary-close").addEventListener("click", () => document.getElementById("summary-dialog").close());
}
