"use strict";
/* ==========================================================================
   Fiche « État actuel » du projet coach, mise à jour avec les données de l'app.
   Tu colles une fois ta fiche actuelle (gardée sur cet appareil) ; l'app garde tous tes textes et
   remplace seulement : la date, le poids de référence, le tour de taille, la cible calorique,
   le tableau des charges, et les lignes marquées « (app) » (rythme, genou, moyennes, batterie).
   ========================================================================== */

const COACH_SHEET_KEY = "coachSheetBase";
let coachSheetBase = "";
let coachSheetOutput = "";

function frDate(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function frShort(iso) { const [, m, d] = iso.split("-"); return `${d}/${m}`; }

/* « 2 séries à 65 kg + 2 à 70 kg » d'après la dernière séance de l'exercice. */
function loadsSummary(name) {
  const last = exerciseHistory(name)[0];
  const def = findExerciseDef(name);
  const bw = exerciseIsBodyweight(name);
  const loads = last ? last.sets.map((s) => s.load) : (def ? def.loads : []);
  if (!loads.length) return "pas encore fait";
  if (bw && loads.every((l) => !l)) return `poids du corps${last ? ` (${last.sets.map((s) => s.reps).join(", ")} reps, ${frShort(last.date)})` : ""}`;
  const groups = [];
  loads.forEach((l) => { const g = groups[groups.length - 1]; if (g && g.load === l) g.n++; else groups.push({ load: l, n: 1 }); });
  const kg = (l) => (l === null || l === undefined ? "?" : fmt(l, 2));
  /* Charges toutes différentes : « séries à 90, 95, 100 et 105 kg ». */
  const text = groups.length > 2 && groups.every((g) => g.n === 1)
    ? `séries à ${groups.slice(0, -1).map((g) => kg(g.load)).join(", ")} et ${kg(groups[groups.length - 1].load)} kg`
    : groups.map((g, i) => `${i === 0 ? `${g.n} série${g.n > 1 ? "s" : ""} à` : `${g.n} à`} ${kg(g.load)} kg`).join(" + ");
  const reps = last ? ` (${last.sets.map((s) => `${s.reps}${fmtRp(s)}`).join(", ")} reps, ${frShort(last.date)})` : " (charges du programme)";
  return text + reps;
}
/* Tableau du programme ; « notes » = remarques entre parenthèses de l'ancien tableau, gardées. */
function coachTrainingTable(notes = {}) {
  const rows = [];
  (state.program?.sessions || []).forEach((s) => s.exercises.forEach((e) => {
    const note = notes[fold(e.name)];
    rows.push(`| ${s.name.toUpperCase()} | ${e.name} | ${loadsSummary(e.name)}${note ? ` ${note}` : ""} |`);
  }));
  return ["| Séance | Exercice | Repère de charge |", "| --- | --- | --- |", ...rows].join("\n");
}
function oldTableNotes(rows) {
  const notes = {};
  rows.forEach((r) => {
    const cells = r.split("|").map((c) => c.trim());
    if (cells.length < 4) return;
    /* Les parenthèses écrites par l'app (reps, « charges du programme ») sont recalculées, pas gardées. */
    const own = [...(cells[3] || "").matchAll(/\([^()]*[a-zà-ÿ][^()]*\)/gi)].map((m) => m[0])
      .filter((n) => !/\breps\b/.test(n) && n !== "(charges du programme)");
    if (own.length) notes[fold(cells[2])] = own.join(" ");
  });
  return notes;
}
/* Lignes calculées par l'app, rangées par section de la fiche. */
function coachAppLines() {
  const t = today();
  const from28 = addDays(t, -27);
  const lines = { "Profil": [], "Objectifs en cours": [], "Entraînement": [], "Santé": [], "Nutrition et habitudes": [], "Batterie de tests": [] };
  /* Rythme d'entraînement */
  const sessions = state.workouts.filter((w) => w.date >= from28);
  if (sessions.length) lines["Entraînement"].push(`- Rythme réel (app, 4 dernières semaines) : ${fmt(sessions.length / 4, 1)} séance${sessions.length / 4 >= 2 ? "s" : ""} par semaine (${sessions.length} au total).`);
  const bikes = state.workouts.filter((w) => w.bikeTimeS && w.bikeKm).sort(newestFirst);
  if (bikes.length) lines["Entraînement"].push(`- Vélo d'échauffement (app) : dernier ${fmt(bikes[0].bikeKm, 1)} km en ${fmtDuration(bikes[0].bikeTimeS)} (${frShort(bikes[0].date)}).`);
  /* Course : où en est le plan de reprise, dernière sortie. */
  if ((state.runs || []).length) {
    const ps = runPlanState();
    const r = state.runs[0];
    const pain = runPain(r);
    lines["Entraînement"].push(`- Course (app) : ${ps.done ? "plan de reprise terminé" : `plan de reprise à l'étape ${ps.suggested} sur ${RUN_PLAN.length} (${runStepText(ps.suggested)})`} ; dernière sortie le ${frShort(r.date)} : ${runSummaryText(r)}${pain !== null ? `, genou ${fmt(pain, 1)}/10` : ""}.`);
  }
  const plateaus = knownExerciseNames().filter((n) => plateauInfo(n));
  if (plateaus.length) lines["Entraînement"].push(`- Plateaux (app) : ${plateaus.join(", ")} (pas de progrès depuis 3 séances ou plus).`);
  /* Poids */
  const daily = dailyWeights();
  if (daily.length >= 2) {
    const last4 = daily.slice(-4);
    const prev = daily.filter((d) => d.date <= addDays(daily[daily.length - 1].date, -28)).pop();
    lines["Profil"].push(`- Tendance du poids (app) : moyenne des ${last4.length} dernières pesées ${fmt(average(last4.map((d) => d.weight)), 1)} kg${prev ? ` ; ${fmt(daily[daily.length - 1].weight - prev.weight, 1)} kg sur 4 semaines` : ""}.`);
  }
  /* Genou */
  const knee = state.wellbeing.find((w) => w.kneeBefore !== null && w.kneeBefore !== undefined || w.kneeDuring !== null && w.kneeDuring !== undefined || w.kneeNext !== null && w.kneeNext !== undefined);
  if (knee) lines["Santé"].push(`- Genou, dernier relevé (app, ${frShort(knee.date)}) : avant ${knee.kneeBefore ?? "?"}/10 · pendant ${knee.kneeDuring ?? "?"}/10 · lendemain ${knee.kneeNext ?? "?"}/10.`);
  /* Nutrition sur 28 jours (jours renseignés) */
  const meals = state.recentMeals.filter((m) => m.date >= from28 && m.date < t);
  const days = new Set(meals.map((m) => m.date));
  if (days.size) {
    const kcal = meals.reduce((a, m) => a + (m.kcal || 0), 0) / days.size;
    const prot = meals.reduce((a, m) => a + (m.protein || 0), 0) / days.size;
    const drinks = meals.filter(isAlcoholEntry).reduce((a, m) => a + (m.volumeMl && m.abv ? standardDrinks(m.volumeMl, m.abv) : 0), 0);
    lines["Nutrition et habitudes"].push(`- Moyennes (app, 4 dernières semaines, ${days.size} jours renseignés) : ${fmt(kcal, 0)} kcal et ${fmt(prot, 0)} g de protéines par jour ; alcool ${fmt(drinks / 4, 1)} verre${drinks / 4 >= 2 ? "s" : ""} standard par semaine.`);
  }
  /* Batterie */
  const bat = state.battery[0];
  if (bat) {
    const res = BATTERY_FIELDS.filter(([k]) => bat[k] !== null && bat[k] !== undefined).map(([k, label, kind]) => `${label} ${fmtBatteryValue(kind, bat[k])}`);
    if (res.length) lines["Batterie de tests"].push(`- Derniers résultats (app, ${frShort(bat.date)}) : ${res.join(" · ")}.`);
  }
  return lines;
}
/* Met à jour la fiche collée ; sans fiche, produit une fiche minimale avec les données de l'app. */
function buildCoachSheet(base) {
  const t = today();
  const app = coachAppLines();
  let text = String(base || "").replace(/\r\n/g, "\n");
  if (!text.trim()) {
    text = `# Fiche État actuel\n\nDernière mise à jour : ${frDate(t)}.\n\n## Profil\n\n## Objectifs en cours\n\n## Entraînement\n\n${coachTrainingTable()}\n\n## Santé\n\n## Nutrition et habitudes\n\n## Batterie de tests\n`;
  }
  /* 1. Lignes « (app) » précédentes retirées, elles sont recalculées. */
  text = text.split("\n").filter((l) => !/\(app[,)]/.test(l)).join("\n");
  /* 2. Date de mise à jour. */
  text = text.replace(/Dernière mise à jour\s*:\s*\d{1,2}\/\d{1,2}\/\d{2,4}/i, `Dernière mise à jour : ${frDate(t)}`);
  /* 3. Poids de référence et tour de taille : dernières mesures. */
  const lastWeight = state.measurements.find((m) => m.weight);
  if (lastWeight) {
    text = text.replace(/^- Poids de référence\s*:.*$/m, `- Poids de référence : ${fmt(lastWeight.weight, 1)} kg, mesuré le ${frDate(lastWeight.date)}${lastWeight.moment ? ` (${lastWeight.moment.toLowerCase()})` : ""}.`);
  }
  const lastWaist = state.measurements.find((m) => m.waist);
  if (lastWaist) {
    text = text.replace(/^(- Tour de taille\s*:\s*)\d+(?:[.,]\d+)?\s*cm(?:\s*\(mesuré le [^)]*\))?/m, `$1${fmt(lastWaist.waist, 1)} cm (mesuré le ${frDate(lastWaist.date)})`);
  }
  /* 4. Cible calorique et macros (Réglages → Objectifs). */
  const g = state.targets;
  if (dayTargetsEnabled()) {
    const parts = DAY_TYPES.filter(([k]) => g.days[k]).map(([k, label]) => `${label.toLowerCase()} ${dayTargetsText(g.days[k])}`);
    text = text.replace(/^- Cible calorique et macros\s*:.*$/m, `- Cible calorique et macros : selon la journée — ${parts.join(" ; ")}${g.fiber ? ` ; fibres ${fmt(g.fiber, 0)} g` : ""} (réglée dans l'app).`);
  } else if (g.kcal || g.protein) {
    const parts = [g.kcal && `${fmt(g.kcal, 0)} kcal`, g.protein && `protéines ${fmt(g.protein, 0)} g`, g.carbs && `glucides ${fmt(g.carbs, 0)} g`, g.fat && `lipides ${fmt(g.fat, 0)} g`, g.fiber && `fibres ${fmt(g.fiber, 0)} g`].filter(Boolean);
    text = text.replace(/^- Cible calorique et macros\s*:.*$/m, `- Cible calorique et macros : ${parts.join(" · ")} (réglée dans l'app).`);
  }
  /* 5. Tableau des charges (section Entraînement) : remplacé par le programme et tes dernières charges. */
  /*    Sans programme dans l'app, le tableau de la fiche reste tel quel. */
  const lines = text.split("\n");
  const secStart = lines.findIndex((l) => /^##\s+Entraînement/i.test(l));
  if (secStart >= 0 && state.program?.sessions?.some((s) => s.exercises.length)) {
    let end = lines.findIndex((l, i) => i > secStart && /^##\s/.test(l));
    if (end < 0) end = lines.length;
    const tStart = lines.findIndex((l, i) => i > secStart && i < end && /^\|/.test(l));
    if (tStart >= 0) {
      let tEnd = tStart;
      while (tEnd < end && /^\|/.test(lines[tEnd])) tEnd++;
      const notes = oldTableNotes(lines.slice(tStart + 2, tEnd));
      lines.splice(tStart, tEnd - tStart, ...coachTrainingTable(notes).split("\n"));
    } else {
      lines.splice(end, 0, "", ...coachTrainingTable().split("\n"), "");
    }
  }
  text = lines.join("\n");
  /* 6. Lignes « (app) » ajoutées à la fin de leur section (avant un tableau éventuel). */
  Object.entries(app).forEach(([section, add]) => {
    if (!add.length) return;
    const ls = text.split("\n");
    const start = ls.findIndex((l) => new RegExp(`^##\\s+${section}`, "i").test(l));
    if (start < 0) { text = `${text.trimEnd()}\n\n## ${section}\n\n${add.join("\n")}\n`; return; }
    let end = ls.findIndex((l, i) => i > start && /^##\s/.test(l));
    if (end < 0) end = ls.length;
    /* Après la dernière puce de la section (avant le tableau s'il y en a un). */
    let at = start + 1;
    for (let i = start + 1; i < end; i++) { if (/^\|/.test(ls[i])) break; if (/^\s*-\s/.test(ls[i]) || /^\d+\.\s/.test(ls[i])) at = i + 1; }
    if (at === start + 1) { while (at < end && !ls[at].trim()) at++; }
    ls.splice(at, 0, ...add);
    text = ls.join("\n");
  });
  return text.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

async function renderCoachSheet() {
  coachSheetBase = await getSetting(COACH_SHEET_KEY, "");
  document.getElementById("coach-sheet-status").textContent = coachSheetBase
    ? "Ta fiche est enregistrée sur cet appareil : la mise à jour garde tous tes textes."
    : "Colle d'abord ta fiche actuelle (une seule fois) pour garder tes textes. Sans elle, l'app produit une fiche courte avec ses seules données.";
}
function setupCoachSheet() {
  const dialog = document.getElementById("coach-sheet-dialog");
  document.getElementById("coach-sheet-open").addEventListener("click", async () => {
    await renderCoachSheet();
    coachSheetOutput = buildCoachSheet(coachSheetBase);
    document.getElementById("coach-sheet-output").value = coachSheetOutput;
    document.getElementById("coach-sheet-base").value = "";
    document.getElementById("coach-sheet-base-box").hidden = Boolean(coachSheetBase);
    dialog.showModal();
  });
  document.getElementById("coach-sheet-close").addEventListener("click", () => dialog.close());
  document.getElementById("coach-sheet-edit-base").addEventListener("click", () => {
    document.getElementById("coach-sheet-base-box").hidden = false;
    document.getElementById("coach-sheet-base").value = coachSheetBase;
  });
  document.getElementById("coach-sheet-save-base").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const text = document.getElementById("coach-sheet-base").value.trim();
    if (!text) throw new UserError("Colle le texte de ta fiche « État actuel ».");
    if (text.length > 30000) throw new UserError("Fiche trop longue (30 000 caractères maximum).");
    await setSetting(COACH_SHEET_KEY, text);
    await renderCoachSheet();
    coachSheetOutput = buildCoachSheet(coachSheetBase);
    document.getElementById("coach-sheet-output").value = coachSheetOutput;
    document.getElementById("coach-sheet-base-box").hidden = true;
    showToast("Fiche enregistrée : la version à jour est prête.");
  }));
  document.getElementById("coach-sheet-copy").addEventListener("click", () => copyText(document.getElementById("coach-sheet-output").value, "Fiche copiée : remplace l'ancienne dans ton projet coach."));
  document.getElementById("coach-sheet-download").addEventListener("click", () => {
    downloadBlob("Fiche État actuel.md", new Blob([document.getElementById("coach-sheet-output").value], { type: "text/markdown" }));
    showToast("Fiche téléchargée : remplace l'ancienne dans ton projet coach.");
  });
}
