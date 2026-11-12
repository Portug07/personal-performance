"use strict";
/* ==========================================================================
   Musculation automatique :
   - générateur de séance (« j'ai 50 min ») : type, exercices, séries, charges, cibles, repos, cardio ;
   - remplacement d'un exercice (machine prise) ;
   - plateaux (pas de progrès depuis 3 séances) ;
   - renommer / fusionner un exercice dans tout l'historique ;
   - import du programme proposé par le coach (bloc JSON du gabarit).
   ========================================================================== */

/* ---------- Plateaux ---------- */

/* Pas de progrès : aucune des 3 dernières séances ne bat le meilleur résultat d'avant
   (1RM estimé, ou reps au poids du corps). Au moins 4 séances d'historique. */
function plateauInfo(name) {
  const hist = exerciseHistory(name);
  if (hist.length < 4) return null;
  const bw = exerciseIsBodyweight(name);
  const score = (h) => (bw && !maxLoad(h.sets) ? maxBwReps(h.sets) : Math.max(0, ...validSets(h.sets).map(e1rm)));
  let best = -Infinity, since = 0;
  hist.slice().reverse().forEach((h) => { const v = score(h); if (v > best + 0.01) { best = v; since = 0; } else since++; });
  return since >= 3 ? { sessions: since } : null;
}

/* ---------- Remplacer un exercice ---------- */

let replaceTarget = null;       // bloc d'exercice à remplacer
function lastTimeText(name) {
  const last = exerciseHistory(name)[0];
  if (!last) return "jamais fait";
  const bw = exerciseIsBodyweight(name);
  return `${fmtShortDate(last.date)} : ${last.sets.slice(0, 2).map((s) => fmtSet(s, bw)).join(" · ")}${last.sets.length > 2 ? "…" : ""}`;
}
function openReplaceDialog(block) {
  replaceTarget = block;
  const name = $(".exercise-name", block).value.trim();
  const inSession = $$(".exercise-block", editorEl()).map((b) => $(".exercise-name", b).value);
  const alts = alternativesFor(name, inSession);
  document.getElementById("replace-title").textContent = `Remplacer « ${name || "exercice"} »`;
  document.getElementById("replace-group").textContent = `Mêmes muscles (${GROUP_LABELS[exerciseGroup(name)] || "autre"}). Tes charges et ton historique suivent l'exercice choisi.`;
  document.getElementById("replace-list").innerHTML = alts.length
    ? alts.map((n) => `<button type="button" class="replace-item" data-replace="${esc(n)}"><b>${esc(n)}</b><small>${esc((libraryEntry(n) || {}).equip || "")}${libraryEntry(n) ? " · " : ""}${esc(lastTimeText(n))}</small></button>`).join("")
    : `<p class="hint">Pas d'équivalent connu pour cet exercice : tape un autre nom ci-dessous.</p>`;
  document.getElementById("replace-form").elements.custom.value = "";
  document.getElementById("replace-dialog").showModal();
}
/* Remplace l'exercice d'un bloc : même nombre de séries, charges de l'historique du nouvel exercice. */
function replaceExercise(block, newName) {
  const name = cleanText(newName, 80);
  if (!name) return;
  const def = findExerciseDef(name);
  const count = Math.max(1, $$(".set-row", block).length);
  const input = $(".exercise-name", block);
  input.value = name;
  input.readOnly = false;
  block.dataset.exerciseId = def ? def.id : "";
  const sets = initialSets(def, name, count);
  $(".set-rows", block).innerHTML = sets.map((s, i) => setRowHTML(s, i)).join("");
  if (sets.autoIncrement) block.dataset.autoInc = String(sets.autoIncrement); else delete block.dataset.autoInc;
  delete block.dataset.bwManual;
  setBodyweight(block, exerciseIsBodyweight(name));
  renderBlockMeta(block);
  saveWorkoutDraft();
}

/* ---------- Générateur de séance ---------- */

const GEN_SLOTS = {
  push: ["pecs", "pecs", "epaules", "triceps", "epaules", "triceps", "pecs"],
  pull: ["dos", "dos", "arriere", "biceps", "dos", "biceps", "arriere"],
  upper: ["pecs", "dos", "epaules", "dos", "biceps", "triceps", "abdos", "arriere"]
};
const GEN_TYPE_LABELS = { push: "Push", pull: "Pull", upper: "Haut du corps" };
let genPlan = null;
let genSeed = 1;
let genVariety = false;

function seededRandom(seed) {
  let x = seed % 2147483647; if (x <= 0) x += 2147483646;
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
}
/* Séries par groupe musculaire sur une période (séances enregistrées + séance en cours exclue). */
function setsByGroup(fromDate, toDate) {
  const out = {};
  state.workouts.filter((w) => w.date >= fromDate && w.date <= toDate).forEach((w) => (w.exercises || []).forEach((e) => {
    const g = exerciseGroup(e.name);
    out[g] = (out[g] || 0) + validSets(e.sets).length;
  }));
  return out;
}
function roleOf(groups) {
  let push = 0, pull = 0;
  Object.entries(groups).forEach(([g, n]) => { if (GROUP_ROLE[g] === "push") push += n; if (GROUP_ROLE[g] === "pull") pull += n; });
  if (!push && !pull) return null;
  if (push >= pull * 2) return "push";
  if (pull >= push * 2) return "pull";
  return "upper";
}
/* Type conseillé : l'inverse de la dernière séance (Push → Pull), haut du corps si les deux sont frais ou mélangés. */
function autoSessionType() {
  const t = today();
  for (const n of [0, 1, 2]) {
    const role = roleOf(setsByGroup(addDays(t, -n), addDays(t, -n)));
    if (role === "push") return { type: "pull", why: `${n === 0 ? "Push aujourd'hui" : n === 1 ? "Push hier" : "Push avant-hier"} → Pull` };
    if (role === "pull") return { type: "push", why: `${n === 0 ? "Pull aujourd'hui" : n === 1 ? "Pull hier" : "Pull avant-hier"} → Push` };
    if (role === "upper") return { type: n === 0 ? "pull" : "upper", why: "séance mixte récente → haut du corps" };
  }
  return { type: "upper", why: "pas de séance ces 3 derniers jours → haut du corps complet" };
}
function firstTimeText(def) {
  return def && def.loads && def.loads.length ? "première fois : charges de départ du programme" : "première fois : choisis une charge où tu fais 12 à 15 reps";
}
/* Durée d'une série (min) : travail + pause rest-pause + repos. */
function setMinutes(rp) { return (rp ? 1.4 : 0.8) + restDuration() / 60; }

/* variety : « Autre proposition » → on pioche aussi parmi les équivalents (pas seulement le 1er du programme). */
function generateSession({ minutes = 50, type = "auto", cardio = "warmup", cardioMachine = "Vélo", seed = 1, variety = false } = {}) {
  const rnd = seededRandom(seed * 7919 + minutes);
  const auto = type === "auto" ? autoSessionType() : null;
  const kind = auto ? auto.type : type;
  const notes = auto ? [auto.why] : [];
  const yesterday = setsByGroup(addDays(today(), -1), today());
  const twoDays = setsByGroup(addDays(today(), -2), addDays(today(), -2));
  const cardioWarm = cardio === "warmup" || cardio === "both" ? 5 : 0;
  const cardioEnd = cardio === "end" || cardio === "both" ? (minutes >= 60 ? 15 : 10) : 0;
  let budget = minutes - cardioWarm - cardioEnd - 2;
  const chosen = [];
  const taken = new Set();
  const usedYesterday = new Set();
  state.workouts.filter((w) => w.date >= addDays(today(), -1)).forEach((w) => (w.exercises || []).forEach((e) => usedYesterday.add(fold(e.name))));
  /* Candidats d'un groupe : ton programme d'abord, puis tes exercices connus, puis la bibliothèque ; un peu de hasard dans chaque niveau. */
  const candidates = (group) => {
    const program = [], known = [], lib = [];
    (state.program?.sessions || []).forEach((s) => s.exercises.forEach((e) => { if (exerciseGroup(e.name) === group) program.push(e.name); }));
    knownExerciseNames().forEach((n) => { if (exerciseGroup(n) === group) known.push(n); });
    EXERCISE_LIBRARY.forEach((e) => { if (e.group === group) lib.push(e.name); });
    const shuffle = (list) => list.map((n) => [rnd(), n]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const seen = new Set();
    return [...shuffle(program), ...shuffle(known), ...shuffle(lib)].filter((n) => { const k = fold(n); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const slots = GEN_SLOTS[kind];
  for (const group of slots) {
    if (budget < 6) break;
    const fresh = !yesterday[group];
    /* Muscles travaillés hier : 2 séries maximum, un seul exercice. */
    if (!fresh && chosen.some((c) => c.group === group)) continue;
    const list = candidates(group).filter((n) => !taken.has(fold(n)));
    /* Pas un exercice fait hier s'il y a une autre option, pas un exercice en plateau s'il y a une variante. */
    const good = list.filter((n) => !usedYesterday.has(fold(n)) && !plateauInfo(n));
    let pick = (variety && good.length > 1 ? good[Math.floor(rnd() * Math.min(3, good.length))] : good[0]) || list.find((n) => !plateauInfo(n)) || list[0];
    if (!pick) continue;
    const def = findExerciseDef(pick);
    const rp = isRestPause(def);
    let sets = def ? def.sets : 3;
    if (!fresh) sets = Math.min(sets, 2);
    else if (twoDays[group] >= 8) sets = Math.min(sets, 3);
    const perSet = setMinutes(rp);
    const fit = Math.floor((budget - 1) / perSet);
    if (fit < 2) break;
    sets = Math.min(sets, fit);
    budget -= 1 + sets * perSet;
    taken.add(fold(pick));
    const plateauSkipped = list.slice(0, list.indexOf(pick)).find((n) => plateauInfo(n));
    const why = [];
    if (!fresh) why.push(`${GROUP_LABELS[group]} travaillés hier : 2 séries max`);
    if (plateauSkipped) why.push(`variante : plateau sur ${plateauSkipped}`);
    if (!exerciseHistory(pick).length) why.push(firstTimeText(def));
    chosen.push({ name: pick, group, def, rp, sets, why });
  }
  /* Temps restant : une série de plus aux premiers exercices (4 max). */
  for (const c of chosen) {
    const perSet = setMinutes(c.rp);
    while (budget >= perSet && c.sets < 4 && (!(c.group in yesterday) || c.sets < 2)) { c.sets++; budget -= perSet; }
  }
  /* Ordre : polyarticulaires d'abord, isolation ensuite. */
  chosen.sort((a, b) => Number(Boolean((libraryEntry(b.name) || {}).compound)) - Number(Boolean((libraryEntry(a.name) || {}).compound)));
  const exercises = chosen.map((c) => {
    const sets = initialSets(c.def, c.name, c.sets);
    return { ...c, sets, autoIncrement: sets.autoIncrement || 0, target: c.def ? objectiveText(c.def) : "rest-pause : reps jusqu'à l'échec, pause 20 s, complément" };
  });
  const strength = exercises.reduce((a, e) => a + 1 + e.sets.length * setMinutes(e.rp), 0);
  return {
    kind, label: GEN_TYPE_LABELS[kind], minutes, notes, exercises,
    cardio: { warmup: cardioWarm ? { machine: "Vélo", minutes: cardioWarm } : null, end: cardioEnd ? { machine: cardioMachine, minutes: cardioEnd } : null },
    estimate: Math.round(strength + cardioWarm + cardioEnd + 2)
  };
}

function renderGenPlan() {
  const out = document.getElementById("gen-result");
  const plan = genPlan;
  if (!plan) { out.innerHTML = ""; return; }
  if (!plan.exercises.length) {
    out.innerHTML = `<p class="hint">Pas assez de temps pour une séance de musculation utile : prévois au moins 20 minutes.</p>`;
    document.getElementById("gen-start").disabled = true;
    return;
  }
  document.getElementById("gen-start").disabled = false;
  const rest = fmtClock(restDuration());
  out.innerHTML = `<p class="gen-summary"><b>${esc(plan.label)}</b> · environ ${fmt(plan.estimate, 0)} min${plan.notes.length ? ` · <span class="muted">${esc(plan.notes.join(" · "))}</span>` : ""}</p>
    ${plan.cardio.warmup ? `<div class="gen-item gen-cardio"><b>Échauffement : ${esc(plan.cardio.warmup.machine)} ${plan.cardio.warmup.minutes} min</b><small>facile, pour monter en température</small></div>` : ""}
    ${plan.exercises.map((e, i) => {
      const loads = e.sets.map((s) => (s.load === null || s.load === undefined ? "?" : fmt(s.load, 2)));
      const bw = exerciseIsBodyweight(e.name);
      return `<div class="gen-item">
        <div class="gen-head"><b>${i + 1}. ${esc(e.name)}</b><button type="button" class="small-button" data-gen-replace="${i}">Remplacer</button></div>
        <small>${e.sets.length} séries · ${bw ? "poids du corps" : `${esc(loads.join(" / "))} kg`}${e.autoIncrement ? ` (+${esc(fmt(e.autoIncrement, 2))} kg : seuil atteint)` : ""} · repos ${esc(rest)}${e.rp ? ` · pause RP ${esc(String(rpPauseFor(e.name)))} s` : ""}</small>
        <small class="muted">${esc(e.target)}</small>
        ${e.why.length ? `<small class="gen-why">${esc(e.why.join(" · "))}</small>` : ""}
      </div>`;
    }).join("")}
    ${plan.cardio.end ? `<div class="gen-item gen-cardio"><b>Cardio : ${esc(plan.cardio.end.machine)} ${plan.cardio.end.minutes} min</b><small>effort modéré : tu peux encore parler</small></div>` : ""}`;
}
function runGenerator(newSeed = false) {
  const form = document.getElementById("gen-form");
  if (newSeed) { genSeed++; genVariety = true; }
  genPlan = generateSession({
    minutes: Number(form.elements.minutes.value) || 50, type: form.elements.type.value,
    cardio: form.elements.cardio.value, cardioMachine: form.elements.machine.value, seed: genSeed, variety: genVariety
  });
  renderGenPlan();
}
/* La séance générée remplit le formulaire « Nouvelle séance » puis s'ouvre en mode séance. */
function startGeneratedSession() {
  if (!genPlan || !genPlan.exercises.length) return;
  if (editorHasReps() && !confirm("Une séance est en cours de saisie : la remplacer par la séance générée ?")) return;
  resetWorkoutForm();
  const form = workoutForm();
  form.elements.session.value = FREE_SESSION_ID;
  form.dataset.generated = `Séance générée · ${genPlan.label}`;
  const cardio = [genPlan.cardio.warmup && `Échauffement ${genPlan.cardio.warmup.machine.toLowerCase()} ${genPlan.cardio.warmup.minutes} min`, genPlan.cardio.end && `${genPlan.cardio.end.machine} ${genPlan.cardio.end.minutes} min en fin de séance`].filter(Boolean).join(" · ");
  if (genPlan.cardio.end) form.elements.cardio.value = `${genPlan.cardio.end.machine} ${genPlan.cardio.end.minutes} min`;
  renderEditor(genPlan.exercises.map((e) => ({ exerciseId: e.def ? e.def.id : null, name: e.name, sets: e.sets, autoInc: e.autoIncrement })));
  updateWorkoutFormMode();
  saveWorkoutDraft();
  document.getElementById("gen-dialog").close();
  switchView("training");
  openSessionMode();
  showToast(`Séance générée : ${genPlan.label}, ${plural(genPlan.exercises.length, "exercice")}${cardio ? ` · ${cardio}` : ""}.`);
}
function openGenerator() {
  const form = document.getElementById("gen-form");
  form.elements.machine.innerHTML = CARDIO_OPTIONS.map((m) => `<option>${esc(m)}</option>`).join("");
  form.elements.machine.value = localGet("pp-gen-machine", "Elliptique");
  form.elements.minutes.value = String(localGet("pp-gen-minutes", 50));
  form.elements.cardio.value = localGet("pp-gen-cardio", "warmup");
  form.elements.type.value = "auto";
  genSeed = Date.now() % 100000;
  genVariety = false;
  runGenerator();
  document.getElementById("gen-dialog").showModal();
}

/* ---------- Renommer / fusionner un exercice ---------- */

async function renameExerciseEverywhere(oldName, newName) {
  const target = cleanText(newName, 80);
  if (!target) throw new UserError("Indique le nouveau nom.");
  if (fold(target) === fold(oldName) && target === oldName) throw new UserError("C'est déjà son nom.");
  const key = fold(oldName);
  const workouts = await getByType("workout");
  const changed = workouts.filter((w) => (w.exercises || []).some((e) => fold(e.name) === key))
    .map((w) => ({ ...w, exercises: w.exercises.map((e) => (fold(e.name) === key ? { ...e, name: target } : e)) }));
  if (changed.length) await saveRecords(changed);
  let programChanged = false;
  const program = JSON.parse(JSON.stringify(state.program || { sessions: [] }));
  program.sessions.forEach((s) => s.exercises.forEach((e) => { if (fold(e.name) === key) { e.name = target; programChanged = true; } }));
  if (programChanged) {
    const clean = normalizeProgram({ ...program, schema: PROGRAM_SCHEMA });
    await setSetting("program", clean);
    state.program = clean;
  }
  await reloadWorkouts();
  renderSessionOptions();
  state.progressExercise = target;
  return { workouts: changed.length, programChanged };
}
function openRenameDialog() {
  const name = state.progressExercise;
  if (!name) return;
  document.getElementById("rename-old").textContent = name;
  document.getElementById("rename-form").elements.name.value = name;
  updateRenameHint();
  document.getElementById("rename-dialog").showModal();
}
function updateRenameHint() {
  const v = document.getElementById("rename-form").elements.name.value.trim();
  const other = knownExerciseNames().find((n) => fold(n) === fold(v) && fold(n) !== fold(state.progressExercise));
  document.getElementById("rename-hint").textContent = other
    ? `« ${other} » existe déjà : les deux historiques seront fusionnés (records et courbes réunis).`
    : "Le nouveau nom s'applique à toutes tes séances passées et au programme.";
}

/* ---------- Programme proposé par le coach ---------- */

let coachProgramDraft = null;
function slugId(text) { return fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || uid(); }
/* Lit le bloc JSON du gabarit (```json … ```), même entouré de texte. */
function parseCoachProgram(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new UserError("Aucun programme trouvé : colle toute la réponse du coach, bloc entre accolades { } compris.");
  let data;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { throw new UserError("Le bloc du programme est incomplet ou abîmé : demande au coach de le renvoyer en entier."); }
  const root = data.programme || data.program || data;
  const seances = root.seances || root.séances || root.sessions;
  if (!Array.isArray(seances) || !seances.length) throw new UserError("Le bloc ne contient pas de séances (« seances »).");
  const num = (v) => (v === null || v === undefined || v === "" ? undefined : Number(String(v).replace(",", ".")));
  const sessions = seances.map((s) => ({
    id: slugId(s.nom || s.name), name: s.nom || s.name,
    exercises: (s.exercices || s.exercises || []).map((e) => {
      const nom = e.nom || e.name;
      const existing = findExerciseDef(nom);
      const loads = Array.isArray(e.charges_kg) ? e.charges_kg.map(num) : (existing ? existing.loads : []);
      return {
        id: existing ? existing.id : slugId(nom), name: nom, sets: num(e.series) || (Array.isArray(e.charges_kg) ? e.charges_kg.length : undefined),
        mode: /class/i.test(String(e.methode || e.method || "")) ? "classic" : "restpause",
        target: num(e.cible_reps), upAt: num(e.monter_a), rpPause: num(e.pause_s), repMin: num(e.reps_min), repMax: num(e.reps_max),
        increment: num(e.palier_kg), loads
      };
    })
  }));
  const program = normalizeProgram({ schema: PROGRAM_SCHEMA, sessions });
  if (!program || !program.sessions.some((s) => s.exercises.length)) throw new UserError("Aucun exercice lisible dans ce programme.");
  program.schema = PROGRAM_SCHEMA;
  return program;
}
function programSummaryHTML(program) {
  const before = new Set(); (state.program?.sessions || []).forEach((s) => s.exercises.forEach((e) => before.add(fold(e.name))));
  const after = new Set(); program.sessions.forEach((s) => s.exercises.forEach((e) => after.add(fold(e.name))));
  const added = [], removed = [];
  program.sessions.forEach((s) => s.exercises.forEach((e) => { if (!before.has(fold(e.name))) added.push(e.name); }));
  (state.program?.sessions || []).forEach((s) => s.exercises.forEach((e) => { if (!after.has(fold(e.name))) removed.push(e.name); }));
  return program.sessions.map((s) => `<div class="gen-item"><b>${esc(s.name)}</b>${s.exercises.map((e) => `<small>${esc(e.name)} · ${e.sets} séries · ${esc(objectiveText(e))} · palier ${esc(fmt(e.increment, 2))} kg${e.loads.length ? ` · ${esc(e.loads.map((l) => fmt(l, 2)).join(" / "))} kg` : ""}</small>`).join("")}</div>`).join("")
    + `<p class="hint">${added.length ? `Nouveaux : ${esc(added.join(", "))}. ` : ""}${removed.length ? `Retirés : ${esc(removed.join(", "))} (leur historique est gardé). ` : ""}${!added.length && !removed.length ? "Mêmes exercices, réglages mis à jour." : ""}</p>`;
}
async function applyCoachProgram() {
  if (!coachProgramDraft) throw new UserError("Colle d'abord le programme du coach.");
  const previous = JSON.parse(JSON.stringify(state.program));
  await setSetting("program", coachProgramDraft);
  state.program = coachProgramDraft;
  renderProgramEditor();
  renderSessionOptions();
  if (!editorHasReps() && !state.editing.workout) resetWorkoutForm();
  document.getElementById("coach-program-dialog").close();
  showToast("Programme du coach installé.", "ok", { label: "Annuler", run: async () => {
    await setSetting("program", previous);
    state.program = previous;
    renderProgramEditor();
    renderSessionOptions();
    if (!editorHasReps() && !state.editing.workout) resetWorkoutForm();
    showToast("Ancien programme remis.");
  } });
}

function setupGenerator() {
  const gen = document.getElementById("gen-dialog");
  const form = document.getElementById("gen-form");
  document.getElementById("gen-open").addEventListener("click", openGenerator);
  document.getElementById("gen-cancel").addEventListener("click", () => gen.close());
  form.addEventListener("change", () => {
    localSet("pp-gen-minutes", Number(form.elements.minutes.value) || 50);
    localSet("pp-gen-cardio", form.elements.cardio.value);
    localSet("pp-gen-machine", form.elements.machine.value);
    form.elements.machine.disabled = !["end", "both"].includes(form.elements.cardio.value);
    runGenerator();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("gen-again").addEventListener("click", () => runGenerator(true));
  document.getElementById("gen-start").addEventListener("click", startGeneratedSession);
  document.getElementById("gen-result").addEventListener("click", (e) => {
    const b = e.target.closest("[data-gen-replace]");
    if (!b || !genPlan) return;
    const i = Number(b.dataset.genReplace);
    const cur = genPlan.exercises[i];
    const alts = alternativesFor(cur.name, genPlan.exercises.map((x) => x.name));
    if (!alts.length) { showToast("Pas d'autre exercice connu pour ces muscles.", "error"); return; }
    /* Remplacement en boucle : chaque appui propose l'équivalent suivant. */
    const next = alts[(cur.altIndex || 0) % alts.length];
    const def = findExerciseDef(next);
    const sets = initialSets(def, next, cur.sets.length);
    genPlan.exercises[i] = { ...cur, name: next, def, rp: isRestPause(def), sets, autoIncrement: sets.autoIncrement || 0, altIndex: (cur.altIndex || 0) + 1,
      why: exerciseHistory(next).length ? [] : [firstTimeText(def)],
      target: def ? objectiveText(def) : "rest-pause : reps jusqu'à l'échec, pause 20 s, complément" };
    renderGenPlan();
  });
  /* Remplacer (formulaire et mode séance) */
  const rep = document.getElementById("replace-dialog");
  document.getElementById("replace-cancel").addEventListener("click", () => rep.close());
  document.getElementById("replace-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-replace]");
    if (!b || !replaceTarget) return;
    replaceExercise(replaceTarget, b.dataset.replace);
    rep.close();
    if (sessionModeOpen()) renderSessionMode();
    showToast(`Remplacé par ${b.dataset.replace}.`);
  });
  document.getElementById("replace-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = e.target.elements.custom.value.trim();
    if (!v || !replaceTarget) return;
    replaceExercise(replaceTarget, v);
    rep.close();
    if (sessionModeOpen()) renderSessionMode();
  });
  /* Renommer / fusionner */
  const ren = document.getElementById("rename-dialog");
  document.getElementById("rename-open").addEventListener("click", openRenameDialog);
  document.getElementById("rename-cancel").addEventListener("click", () => ren.close());
  document.getElementById("rename-form").elements.name.addEventListener("input", updateRenameHint);
  document.getElementById("rename-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const res = await renameExerciseEverywhere(state.progressExercise, e.target.elements.name.value);
      ren.close();
      renderProgress();
      showToast(`Renommé dans ${plural(res.workouts, "séance")}${res.programChanged ? " et dans le programme" : ""}.`);
    });
  });
  /* Programme du coach */
  const cp = document.getElementById("coach-program-dialog");
  document.getElementById("coach-program-open").addEventListener("click", () => {
    document.getElementById("coach-program-text").value = "";
    document.getElementById("coach-program-preview").innerHTML = "";
    document.getElementById("coach-program-apply").disabled = true;
    coachProgramDraft = null;
    cp.showModal();
  });
  document.getElementById("coach-program-cancel").addEventListener("click", () => cp.close());
  document.getElementById("coach-program-text").addEventListener("input", (e) => {
    const out = document.getElementById("coach-program-preview");
    coachProgramDraft = null;
    document.getElementById("coach-program-apply").disabled = true;
    if (!e.target.value.trim()) { out.innerHTML = ""; return; }
    try {
      coachProgramDraft = parseCoachProgram(e.target.value);
      out.innerHTML = programSummaryHTML(coachProgramDraft);
      document.getElementById("coach-program-apply").disabled = false;
    } catch (err) {
      out.innerHTML = `<p class="danger-text">${esc(humanError(err).replace(" Rien n'a été enregistré.", ""))}</p>`;
    }
  });
  document.getElementById("coach-program-apply").addEventListener("click", (e) => withBusy(e.currentTarget, applyCoachProgram));
}
