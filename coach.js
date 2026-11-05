"use strict";
/* ==========================================================================
   Envoi vers l'agent coach (projet Claude « Personal Performance »), sans API ni serveur :
   - « Copier le récap du jour » : texte au format de la saisie rapide, à coller chaque soir ;
   - « Exporter la période » : fichier JSON (schéma version 2) pour la semaine ou le mois.
   Règle : une donnée absente est omise, jamais remplacée par zéro.
   ========================================================================== */

const COACH_SCHEMA_VERSION = 2;

/* ---------- Périodes ---------- */

function periodBounds(kind, ref = today()) {
  const firstOfMonth = (iso) => `${iso.slice(0, 8)}01`;
  switch (kind) {
    case "last-week": { const monday = addDays(mondayOf(ref), -7); return { from: monday, to: addDays(monday, 6) }; }
    case "last-7": return { from: addDays(ref, -6), to: ref };
    case "this-month": return { from: firstOfMonth(ref), to: ref };
    case "last-month": { const end = addDays(firstOfMonth(ref), -1); return { from: firstOfMonth(end), to: end }; }
    default: return { from: mondayOf(ref), to: ref };
  }
}
function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ---------- Données d'un jour ---------- */

/* Retire les valeurs vides (null, undefined, "", [], {}) à tous les niveaux. */
function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const arr = value.map(pruneEmpty).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === "object") {
    const obj = {};
    Object.entries(value).forEach(([k, v]) => { const c = pruneEmpty(v); if (c !== undefined) obj[k] = c; });
    return Object.keys(obj).length ? obj : undefined;
  }
  return value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value)) ? undefined : value;
}
const num = (v, d = 1) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? undefined : round(Number(v), d));

/* Rassemble tout ce qui a été saisi un jour donné. « meals » : repas de ce jour (lus dans la base). */
function collectDay(date, meals) {
  const weighIns = state.measurements.filter((m) => m.date === date && m.weight !== null && m.weight !== undefined);
  const weighIn = weighIns.find((m) => m.moment === GYM_WEIGH_IN) || weighIns[0] || null;
  const tape = state.measurements.find((m) => m.date === date && MEASURE_FIELDS.slice(1).some(([k]) => m[k] !== null && m[k] !== undefined)) || null;
  return {
    date, weighIn, tape, meals,
    well: state.wellbeing.find((w) => w.date === date) || null,
    workouts: state.workouts.filter((w) => w.date === date).slice().reverse(),
    test: state.battery.find((t) => t.date === date) || null
  };
}

function dayToJSON(day) {
  const food = day.meals.filter((m) => !isAlcoholEntry(m));
  const drinks = day.meals.filter(isAlcoholEntry);
  const w = day.well || {};
  const totals = mealTotals(day.meals);
  const repas = MEAL_KINDS.filter((k) => k !== "Alcool").map((kind) => ({
    nom: kind,
    aliments: food.filter((m) => m.kind === kind).map((m) => ({
      nom: m.name, quantite_g: num(m.grams, 0), portion: m.quantity, kcal: num(m.kcal, 0),
      proteines_g: num(m.protein), glucides_g: num(m.carbs), lipides_g: num(m.fat), fibres_g: num(m.fiber)
    }))
  }));
  const cardio = [];
  day.workouts.forEach((wo) => {
    if (wo.bikeTimeS || wo.bikeKm) cardio.push({ type: "velo", distance_km: num(wo.bikeKm, 2), duree_s: num(wo.bikeTimeS, 0), niveau: num(wo.bikeLevel, 0) });
    if (wo.walkKm) cardio.push({ type: "marche", distance_km: num(wo.walkKm, 2) });
    if (wo.cardio) cardio.push({ type: "autre", description: wo.cardio });
  });
  const t = day.test || {};
  return pruneEmpty({
    date: day.date,
    pesee: day.weighIn ? { poids_kg: num(day.weighIn.weight, 2), moment: day.weighIn.moment ? day.weighIn.moment.toLowerCase() : undefined } : undefined,
    sommeil: { heures: num(w.sleep, 2), qualite_5: num(w.sleepQuality, 0) },
    ressenti_10: { fatigue: num(w.fatigue, 0), stress: num(w.stress, 0), motivation: num(w.motivation, 0) },
    eau_l: num(w.water, 1),
    repas,
    alcool: drinks.map((m) => ({
      type: m.name, volume_ml: num(m.volumeMl, 0), degre: num(m.abv, 1),
      verres_standard: m.volumeMl && m.abv ? num(standardDrinks(m.volumeMl, m.abv), 1) : undefined, kcal: num(m.kcal, 0)
    })),
    alcool_declare_verres: drinks.length ? undefined : num(w.alcohol, 1),
    totaux: day.meals.length ? {
      kcal: num(totals.kcal, 0), kcal_alcool: drinks.length ? num(sum(drinks, "kcal"), 0) : undefined,
      proteines_g: num(totals.protein, 0), glucides_g: num(totals.carbs, 0), lipides_g: num(totals.fat, 0), fibres_g: num(totals.fiber, 0)
    } : undefined,
    seances: day.workouts.map((wo) => ({
      type: wo.sessionType, duree_min: num(wo.duration, 0),
      exercices: (wo.exercises || []).map((e) => ({
        nom: e.name,
        series: validSets(e.sets).map((s) => ({ charge_kg: num(s.load, 2), reps: num(s.reps, 0), reps_rest_pause: num(s.rpReps, 0), pause_s: s.rpReps ? num(s.rpPause, 0) : undefined }))
      })),
      notes: wo.notes
    })),
    cardio,
    mesures: day.tape ? {
      tour_de_taille_cm: num(day.tape.waist), tour_de_ventre_cm: num(day.tape.belly), tour_de_poitrine_cm: num(day.tape.chest),
      tour_de_bras_cm: num(day.tape.arm), tour_de_cuisse_cm: num(day.tape.thigh)
    } : undefined,
    tests: day.test ? {
      velo_5km_s: num(t.bikeS, 0), chest_press_8rm_kg: num(t.chestPress8rm, 2), tirage_horizontal_8rm_kg: num(t.row8rm, 2),
      pompes_max: num(t.pushups, 0), planche_s: num(t.plankS, 0),
      back_scratch_cm: { droite: num(t.backScratchR, 1), gauche: num(t.backScratchL, 1) }, notes: t.notes
    } : undefined,
    douleurs: [
      { zone: "genou gauche", avant: num(w.kneeBefore, 1), pendant: num(w.kneeDuring, 1), lendemain: num(w.kneeNext, 1) },
      { zone: "autre", niveau: num(w.pain, 0) }
    ].filter((d) => Object.keys(d).some((k) => k !== "zone" && d[k] !== undefined)),
    notes: w.notes
  });
}

/* ---------- Récap du jour (texte) ---------- */

function dayToText(day) {
  const L = [`JOUR ${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`];
  const w = day.well || {};
  const food = day.meals.filter((m) => !isAlcoholEntry(m));
  const drinks = day.meals.filter(isAlcoholEntry);
  if (day.weighIn) L.push(`Poids : ${fmt(day.weighIn.weight, 2)} kg${day.weighIn.moment ? ` (${day.weighIn.moment.toLowerCase()})` : ""}`);
  const sleep = [w.sleep !== null && w.sleep !== undefined ? `${fmt(w.sleep, 2)} h` : "", w.sleepQuality ? `qualité ${fmt(w.sleepQuality, 0)}/5` : ""].filter(Boolean);
  if (sleep.length) L.push(`Sommeil : ${sleep.join(" · ")}`);
  const feel = [["fatigue", "Fatigue"], ["stress", "Stress"], ["motivation", "Motivation"]].filter(([k]) => w[k] !== null && w[k] !== undefined).map(([k, label]) => `${label} ${fmt(w[k], 0)}/10`);
  if (feel.length) L.push(feel.join(" · "));
  if (w.water !== null && w.water !== undefined) L.push(`Eau : ${fmt(w.water, 1)} L`);
  if (food.length) {
    const groups = MEAL_KINDS.map((kind) => {
      const items = food.filter((m) => m.kind === kind);
      if (!items.length) return "";
      return `${kind} — ${items.map((m) => `${m.name}${m.grams ? ` ${fmt(m.grams, 0)} g` : m.quantity ? ` (${m.quantity})` : ""} (${fmt(m.kcal, 0)} kcal)`).join(", ")}`;
    }).filter(Boolean);
    L.push(`Repas : ${groups.join(" ; ")}`);
  }
  if (drinks.length) {
    L.push(`Alcool : ${drinks.map((m) => {
      const bits = [m.name, m.volumeMl ? `${fmt(m.volumeMl, 0)} ml` : "", m.abv ? `${fmt(m.abv, 1)} %` : ""].filter(Boolean).join(", ");
      const extra = [m.volumeMl && m.abv ? `${fmt(standardDrinks(m.volumeMl, m.abv), 1)} verres std` : "", `${fmt(m.kcal, 0)} kcal`].filter(Boolean).join(", ");
      return `${bits} (${extra})`;
    }).join(" ; ")}`);
  } else if (w.alcohol) {
    L.push(`Alcool : ${fmt(w.alcohol, 1)} verre(s) déclaré(s) au check-in`);
  }
  if (day.meals.length) {
    const t = mealTotals(day.meals);
    const alcoholKcal = sum(drinks, "kcal");
    L.push(`Totaux : ${fmt(t.kcal, 0)} kcal${drinks.length ? ` (dont alcool ${fmt(alcoholKcal, 0)})` : ""} · P ${fmt(t.protein, 0)} g · G ${fmt(t.carbs, 0)} g · L ${fmt(t.fat, 0)} g · fibres ${fmt(t.fiber, 0)} g`);
  }
  day.workouts.forEach((wo) => {
    L.push(`Séance : ${wo.sessionType}${wo.duration ? ` (${fmt(wo.duration, 0)} min)` : ""}`);
    (wo.exercises || []).forEach((e) => {
      const sets = validSets(e.sets);
      const rp = sets.find((s) => s.rpReps);
      L.push(`- ${e.name} : ${sets.map(fmtSet).join(", ").replace(/ /g, " ")}${rp ? ` (rest-pause${rp.rpPause ? `, pause ${fmt(rp.rpPause, 0)} s` : ""})` : ""}`);
    });
    if (wo.notes) L.push(`- Notes : ${wo.notes}`);
  });
  const cardio = day.workouts.map(workoutCardioText).filter(Boolean).join(" · ").split(" · ").filter(Boolean)
    .map((part) => part.charAt(0).toLowerCase() + part.slice(1));
  if (cardio.length) L.push(`Cardio : ${cardio.join(" · ")}`);
  if (day.tape) {
    const tape = MEASURE_FIELDS.slice(1).filter(([k]) => day.tape[k] !== null && day.tape[k] !== undefined).map(([k, label]) => `${label.toLowerCase()} ${fmt(day.tape[k], 1)} cm`);
    L.push(`Mesures : ${tape.join(" · ")}`);
  }
  if (day.test) {
    const bits = BATTERY_FIELDS.filter(([k]) => day.test[k] !== null && day.test[k] !== undefined).map(([k, label, kind]) => `${label} ${fmtBatteryValue(kind, day.test[k])}`);
    L.push(`Tests : ${bits.join(" · ")}${day.test.notes ? ` (${day.test.notes})` : ""}`);
  }
  const knee = [["kneeBefore", "avant"], ["kneeDuring", "pendant"], ["kneeNext", "lendemain"]].filter(([k]) => w[k] !== null && w[k] !== undefined).map(([k, label]) => `${label} ${fmt(w[k], 1)}/10`);
  if (knee.length) L.push(`Douleur genou : ${knee.join(" · ")}`);
  if (w.pain !== null && w.pain !== undefined) L.push(`Douleur autre : ${fmt(w.pain, 0)}/10`);
  if (w.notes) L.push(`Remarques : ${w.notes}`);
  if (L.length === 1) L.push("Aucune donnée saisie ce jour.");
  return L.join("\n");
}

async function buildDayRecap(date) {
  const meals = await getByTypeRange("meal", date, date);
  return dayToText(collectDay(date, meals));
}

/* ---------- Export d'une période (JSON) ---------- */

function localTimestamp(d = new Date()) {
  return `${isoDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
async function buildPeriodExport(from, to) {
  const meals = await getByTypeRange("meal", from, to);
  const byDay = new Map();
  meals.forEach((m) => { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push(m); });
  const dates = datesBetween(from, to);
  const jours = dates.map((d) => dayToJSON(collectDay(d, (byDay.get(d) || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)))))
    .filter((j) => Object.keys(j).length > 1);
  const g = state.targets;
  return pruneEmpty({
    export: {
      genere_le: localTimestamp(), periode: { debut: from, fin: to }, version_schema: COACH_SCHEMA_VERSION,
      application: `Personal Performance ${APP_VERSION}`, jours_periode: dates.length, jours_renseignes: jours.length,
      echelles: { ressenti: "1 à 10", sommeil_qualite: "1 à 5", douleur: "0 à 10" }
    },
    objectifs: { kcal: g.kcal, proteines_g: g.protein, glucides_g: g.carbs, lipides_g: g.fat, fibres_g: g.fiber, poids_cible_kg: g.weight },
    jours
  });
}
function exportFilename(from, to) { return `personal-performance_${from}_${to}.json`; }

/* ---------- Boutons ---------- */

async function copyText(text, toastText) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(toastText);
  } catch {
    const dialog = document.getElementById("summary-dialog");
    document.getElementById("summary-text").value = text;
    dialog.showModal();
    document.getElementById("summary-text").select();
  }
}
async function copyDayRecap() {
  const input = document.getElementById("recap-date");
  const date = isValidISO(input.value) ? input.value : today();
  await copyText(await buildDayRecap(date), "Récap copié : colle-le dans la conversation de la semaine de ton coach.");
}
async function exportPeriod({ share = false } = {}) {
  const { from, to } = periodBounds(document.getElementById("export-period").value);
  const data = await buildPeriodExport(from, to);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const name = exportFilename(from, to);
  if (share) {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Export Personal Performance" });
        showToast("Export partagé.");
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
  }
  downloadBlob(name, blob);
  showToast(`Export téléchargé : ${plural(data.export.jours_renseignes || 0, "jour renseigné", "jours renseignés")} du ${fmtShortDate(from)} au ${fmtShortDate(to)}.`);
}

function setupCoach() {
  document.getElementById("recap-date").value = today();
  document.getElementById("copy-recap").addEventListener("click", (e) => withBusy(e.currentTarget, copyDayRecap));
  document.getElementById("export-period-json").addEventListener("click", (e) => withBusy(e.currentTarget, () => exportPeriod()));
  const share = document.getElementById("share-period-json");
  share.hidden = !(navigator.share && navigator.canShare);
  share.addEventListener("click", (e) => withBusy(e.currentTarget, () => exportPeriod({ share: true })));
}
