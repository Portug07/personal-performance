"use strict";
/* ==========================================================================
   Entraînement : saisie des séances, mémoire des charges, conseils de progression,
   records, historique détaillé, minuteur de repos, progression par exercice.
   ========================================================================== */

const WORKOUT_DRAFT_KEY = "pp-workout-draft";
const WORKOUT_PAGE_SIZE = 10;
/* Champs ajoutés en version 3 : pesée avant séance, vélo d'échauffement chronométré, marche du retour. */
const WORKOUT_EXTRA_FIELDS = ["weighIn", "bikeKm", "bikeTime", "bikeLevel", "walkKm"];
const GYM_WEIGH_IN = "Soir, avant séance";

/* ---------- Programme ---------- */

function findSession(id) { return (state.program?.sessions || []).find((s) => s.id === id) || null; }
function findExerciseDef(name) {
  const key = fold(name);
  for (const s of state.program?.sessions || []) {
    const def = s.exercises.find((e) => fold(e.name) === key);
    if (def) return def;
  }
  return null;
}

/* ---------- Calculs sur les séries ---------- */

function validSets(sets) { return (sets || []).filter((s) => s && Number(s.reps) > 0); }
/* Répétitions totales d'une série (avant l'échec + complément de rest-pause). */
function totalReps(s) { return (Number(s.reps) || 0) + (Number(s.rpReps) || 0); }
function isRestPause(def) { return !def || def.mode !== "classic"; }
/* 1RM estimé (formule d'Epley) sur les reps AVANT l'échec : c'est la vraie limite de la série.
   Permet de comparer 70 kg × 10 et 75 kg × 6. */
function e1rm(set) {
  const load = Number(set.load) || 0, reps = Number(set.reps) || 0;
  return load > 0 && reps > 0 ? load * (1 + reps / 30) : 0;
}
function bestSet(sets) {
  return validSets(sets).reduce((best, s) => (!best || e1rm(s) > e1rm(best) || (e1rm(s) === e1rm(best) && (s.load || 0) > (best.load || 0)) ? s : best), null);
}
function maxLoad(sets) { return Math.max(0, ...validSets(sets).map((s) => Number(s.load) || 0)); }
function volume(sets) { return validSets(sets).reduce((acc, s) => acc + (Number(s.load) || 0) * totalReps(s), 0); }
/* « 65 × 8+7 » en rest-pause, « 65 × 12 » sinon. */
function fmtSet(s) {
  const load = s.load === null || s.load === undefined ? "PDC" : fmt(s.load, 2);
  const reps = s.reps ? fmt(s.reps, 0) : "?";
  return `${load}\u00a0×\u00a0${reps}${s.rpReps ? `+${fmt(s.rpReps, 0)}` : ""}`;
}
function sortWorkouts(list) {
  return list.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

/* Historique d'un exercice (du plus récent au plus ancien), en ignorant éventuellement une séance. */
function exerciseHistory(name, { excludeId = null, beforeOrOn = null } = {}) {
  const key = fold(name);
  const out = [];
  for (const w of state.workouts) {
    if (w.id === excludeId) continue;
    if (beforeOrOn && w.date > beforeOrOn) continue;
    for (const ex of w.exercises || []) {
      if (fold(ex.name) !== key) continue;
      const sets = validSets(ex.sets);
      if (sets.length) out.push({ date: w.date, workoutId: w.id, sets });
    }
  }
  return out; // state.workouts est déjà trié du plus récent au plus ancien
}
function exerciseRecord(name, opts) {
  let best = null;
  let heaviest = 0;
  for (const h of exerciseHistory(name, opts)) {
    const s = bestSet(h.sets);
    if (s && (!best || e1rm(s) > e1rm(best.set))) best = { set: s, date: h.date };
    heaviest = Math.max(heaviest, maxLoad(h.sets));
  }
  if (best) best.maxLoad = heaviest;
  return best;
}
/* Record = meilleur 1RM estimé OU charge la plus lourde jamais soulevée sur l'exercice. */
function isRecord(sets, previousBestE1rm, previousMaxLoad) {
  const s = bestSet(sets);
  if (!s) return false;
  return e1rm(s) > previousBestE1rm + 0.01 || maxLoad(sets) > previousMaxLoad + 0.001;
}
/* Conseil de progression.
   - Rest-pause : on regarde les reps de la 1re série AVANT l'échec. Seuil atteint (12 par défaut) → on ajoute le palier.
   - Classique (« double progression ») : on monte quand toutes les séries atteignent le haut de la fourchette. */
function progressionAdvice(def, last) {
  if (!def || !last) return null;
  const sets = last.sets;
  if (def.mode !== "classic") {
    const first = Number(sets[0]?.reps) || 0;
    if (first >= def.upAt && def.increment > 0) {
      return { kind: "up", increment: def.increment, text: `1re série : ${first} reps avant l'échec (seuil ${def.upAt}) : ajoute ${fmt(def.increment, 2)} kg.` };
    }
    return { kind: "reps", text: `1re série : ${first} reps avant l'échec. Garde les charges et vise ${first + 1} avant l'échec (on monte à ${def.upAt}).` };
  }
  if (sets.every((s) => s.reps >= def.repMax) && def.increment > 0) {
    return { kind: "up", increment: def.increment, text: `Toutes tes séries ont atteint ${def.repMax} reps : ajoute ${fmt(def.increment, 2)} kg.` };
  }
  if (sets.some((s) => s.reps < def.repMin)) {
    return { kind: "hold", text: `Moins de ${def.repMin} reps la dernière fois : garde les mêmes charges.` };
  }
  return { kind: "reps", text: `Garde les charges et vise une rep de plus par série (objectif ${def.repMax}).` };
}
function objectiveText(def) {
  if (def.mode === "classic") return `objectif ${def.repMin} à ${def.repMax} reps`;
  return `objectif ${def.target} reps en rest-pause (pause ${def.rpPause} s) · on monte quand la 1re série atteint ${def.upAt} reps avant l'échec`;
}
/* « Vélo 5 km en 8:15 (difficulté 25) · Marche 4,8 km · autre cardio » */
function workoutCardioText(w) {
  const parts = [];
  if (w.bikeTimeS) parts.push(`Vélo ${fmt(w.bikeKm ?? 5, 2)} km en ${fmtDuration(w.bikeTimeS)}${w.bikeLevel !== undefined && w.bikeLevel !== null ? ` (difficulté ${fmt(w.bikeLevel, 0)})` : ""}`);
  else if (w.bikeKm) parts.push(`Vélo ${fmt(w.bikeKm, 2)} km`);
  if (w.walkKm) parts.push(`Marche ${fmt(w.walkKm, 2)} km`);
  if (w.cardio) parts.push(w.cardio);
  return parts.join(" · ");
}
/* Pesée du soir à la salle enregistrée pour ce jour-là (créée depuis la séance ou depuis « Progrès »). */
function gymWeighIn(date) {
  return state.measurements.find((m) => m.date === date && m.weight !== null && m.weight !== undefined && m.moment === GYM_WEIGH_IN) || null;
}
function updateWorkoutPlaceholders() {
  const form = workoutForm();
  const last = state.workouts.find((w) => w.bikeTimeS || w.walkKm || w.bikeLevel !== undefined);
  form.elements.bikeKm.placeholder = last && last.bikeKm ? String(last.bikeKm).replace(".", ",") : "5";
  form.elements.bikeTime.placeholder = last && last.bikeTimeS ? fmtDuration(last.bikeTimeS) : "8:15";
  form.elements.bikeLevel.placeholder = last && last.bikeLevel !== undefined ? String(last.bikeLevel) : "25";
  form.elements.walkKm.placeholder = last && last.walkKm ? String(last.walkKm).replace(".", ",") : "4,8";
  const w = state.measurements.find((m) => m.weight !== null && m.weight !== undefined);
  form.elements.weighIn.placeholder = w ? String(w.weight).replace(".", ",") : "106";
}

/* Records battus par une séance, comparés à tout l'historique précédent. */
function detectRecords(workout) {
  const records = [];
  for (const ex of workout.exercises) {
    const previous = exerciseRecord(ex.name, { excludeId: workout.id });
    if (!previous || !isRecord(ex.sets, e1rm(previous.set), previous.maxLoad)) continue;
    const heaviest = validSets(ex.sets).reduce((a, s) => ((s.load || 0) > (a.load || 0) ? s : a));
    records.push(`${ex.name} ${fmtSet(maxLoad(ex.sets) > previous.maxLoad ? heaviest : bestSet(ex.sets))}`);
  }
  return records;
}
/* Repère les records dans l'historique, dans l'ordre chronologique. */
function computeRecordFlags() {
  const flags = new Set();
  const best = new Map(); // clé → { e1rm, load }
  [...state.workouts].reverse().forEach((w) => {
    (w.exercises || []).forEach((ex) => {
      const s = bestSet(ex.sets);
      if (!s) return;
      const key = fold(ex.name);
      const prev = best.get(key);
      if (prev && isRecord(ex.sets, prev.e1rm, prev.load)) flags.add(`${w.id}|${key}`);
      best.set(key, { e1rm: Math.max(prev ? prev.e1rm : 0, e1rm(s)), load: Math.max(prev ? prev.load : 0, maxLoad(ex.sets)) });
    });
  });
  return flags;
}

/* ---------- Éditeur de séance ---------- */

function knownExerciseNames() {
  const names = new Map();
  (state.program?.sessions || []).forEach((s) => s.exercises.forEach((e) => names.set(fold(e.name), e.name)));
  state.workouts.forEach((w) => (w.exercises || []).forEach((e) => { if (!names.has(fold(e.name))) names.set(fold(e.name), e.name); }));
  return [...names.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

function workoutForm() { return document.getElementById("workout-form"); }
function editorEl() { return document.getElementById("exercise-editor"); }

function renderSessionOptions() {
  const select = workoutForm().elements.session;
  const current = select.value;
  select.innerHTML = (state.program?.sessions || []).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")
    + `<option value="${FREE_SESSION_ID}">Séance libre</option>`;
  if ([...select.options].some((o) => o.value === current)) select.value = current;
  document.getElementById("exercise-names").innerHTML = knownExerciseNames().map((n) => `<option value="${esc(n)}"></option>`).join("");
}

/* Charges proposées : celles de ta dernière séance sur cet exercice, sinon les charges de départ du programme. */
function initialSets(def, name, count) {
  const last = exerciseHistory(name, { excludeId: state.editing.workout, beforeOrOn: workoutForm().elements.date.value })[0];
  const sets = [];
  for (let i = 0; i < count; i++) {
    let load = null;
    if (last) load = (last.sets[i] || last.sets[last.sets.length - 1]).load;
    else if (def && def.loads && def.loads.length) load = def.loads[i] ?? def.loads[def.loads.length - 1];
    sets.push({ load: load ?? null, reps: null, rpReps: null });
  }
  return sets;
}

function blockHTML(ex, fixedName) {
  return `<div class="exercise-block" data-exercise-id="${esc(ex.exerciseId || "")}">
    <div class="exercise-head">
      <input class="exercise-name" list="exercise-names" value="${esc(ex.name)}" placeholder="Nom de l'exercice" aria-label="Nom de l'exercice" ${fixedName ? "readonly" : ""} maxlength="80">
      <button type="button" class="link-button danger-text" data-action="remove-exercise">Retirer</button>
    </div>
    <div class="exercise-meta"></div>
    <div class="set-rows">${ex.sets.map((s, i) => setRowHTML(s, i)).join("")}</div>
    <div class="exercise-actions">
      <button type="button" class="chip-button" data-action="add-set">+ Série</button>
      <button type="button" class="chip-button" data-action="remove-set">− Série</button>
    </div>
  </div>`;
}
/* Une ligne de série : charge × reps avant l'échec + complément après la pause (rest-pause, facultatif). */
function setRowHTML(s, i) {
  const load = s.load === null || s.load === undefined ? "" : String(s.load).replace(".", ",");
  const reps = s.reps === null || s.reps === undefined ? "" : String(s.reps);
  const rp = s.rpReps === null || s.rpReps === undefined ? "" : String(s.rpReps);
  return `<div class="set-row">
    <span class="set-num">S${i + 1}</span>
    <label class="set-field"><input data-field="load" inputmode="decimal" autocomplete="off" value="${esc(load)}" aria-label="Série ${i + 1}, charge en kg"><span>kg</span></label>
    <span class="set-x">×</span>
    <label class="set-field"><input data-field="reps" inputmode="numeric" autocomplete="off" value="${esc(reps)}" aria-label="Série ${i + 1}, répétitions avant l'échec"><span>reps</span></label>
    <span class="set-x">+</span>
    <label class="set-field set-rp"><input data-field="rp" inputmode="numeric" autocomplete="off" value="${esc(rp)}" aria-label="Série ${i + 1}, complément après la pause (rest-pause)"><span>RP</span></label>
    <span class="set-prev"></span>
  </div>`;
}
function renumberSets(block) {
  $$(".set-row", block).forEach((row, i) => {
    $(".set-num", row).textContent = `S${i + 1}`;
    $('[data-field="load"]', row).setAttribute("aria-label", `Série ${i + 1}, charge en kg`);
    $('[data-field="reps"]', row).setAttribute("aria-label", `Série ${i + 1}, répétitions avant l'échec`);
    $('[data-field="rp"]', row).setAttribute("aria-label", `Série ${i + 1}, complément après la pause (rest-pause)`);
  });
}

/* Affiche la dernière performance, le record et le conseil de progression d'un exercice. */
function renderBlockMeta(block) {
  const name = $(".exercise-name", block).value.trim();
  const meta = $(".exercise-meta", block);
  const rows = $$(".set-row", block);
  rows.forEach((r) => { $(".set-prev", r).textContent = ""; $('[data-field="reps"]', r).placeholder = "—"; $('[data-field="rp"]', r).placeholder = "—"; });
  if (!name) { meta.innerHTML = ""; return; }
  const opts = { excludeId: state.editing.workout, beforeOrOn: workoutForm().elements.date.value };
  const last = exerciseHistory(name, opts)[0];
  const record = exerciseRecord(name, opts);
  const def = findExerciseDef(name);
  if (!last) {
    meta.innerHTML = `<span class="muted">Première fois : pas encore d'historique${def ? ` · ${esc(objectiveText(def))}` : ""}.</span>`;
    return;
  }
  rows.forEach((r, i) => {
    const s = last.sets[i];
    if (s) {
      $(".set-prev", r).textContent = `préc. ${fmtSet(s)}`;
      $('[data-field="reps"]', r).placeholder = String(s.reps);
      if (s.rpReps) $('[data-field="rp"]', r).placeholder = String(s.rpReps);
    }
  });
  const advice = progressionAdvice(def, last);
  meta.innerHTML = `<div><span class="muted">Dernière fois (${esc(fmtShortDate(last.date))}) :</span> ${esc(last.sets.map(fmtSet).join(" · "))}</div>
    ${record ? `<div><span class="muted">Record :</span> ${esc(fmtSet(record.set))} <span class="muted">(1RM estimé ${esc(fmt(e1rm(record.set), 1))} kg, ${esc(fmtShortDate(record.date))}) · charge max ${esc(fmt(record.maxLoad, 2))} kg</span></div>` : ""}
    ${advice ? `<div class="advice advice-${advice.kind}">${esc(advice.text)}${advice.kind === "up" ? ` <button type="button" class="chip-button" data-action="apply-increment" data-increment="${advice.increment}">Appliquer +${esc(fmt(advice.increment, 2))} kg</button>` : ""}</div>` : ""}`;
}

function renderEditor(exercises, { fixedNames = false } = {}) {
  workoutForm().elements.session.dataset.previous = workoutForm().elements.session.value;
  editorEl().innerHTML = exercises.map((ex) => blockHTML(ex, fixedNames)).join("")
    || `<p class="empty">Ajoute ton premier exercice avec le bouton ci-dessous.</p>`;
  $$(".exercise-block", editorEl()).forEach(renderBlockMeta);
}
function renderTemplate(sessionId) {
  const session = findSession(sessionId);
  if (!session) { renderEditor([]); return; }
  renderEditor(session.exercises.map((def) => ({ exerciseId: def.id, name: def.name, sets: initialSets(def, def.name, def.sets) })), { fixedNames: true });
}

/* Lit et vérifie l'éditeur. Les séries sans répétitions ne sont pas enregistrées (audit I4). */
function readEditor() {
  return $$(".exercise-block", editorEl()).map((block) => {
    const name = $(".exercise-name", block).value.trim().slice(0, 80);
    const def = findExerciseDef(name);
    const sets = $$(".set-row", block).map((row, i) => {
      const load = parseNumber($('[data-field="load"]', row).value);
      const reps = parseNumber($('[data-field="reps"]', row).value);
      const rp = parseNumber($('[data-field="rp"]', row).value);
      const where = `${name || "Exercice sans nom"}, série ${i + 1}`;
      if (Number.isNaN(load) || (load !== null && (load < 0 || load > 1000))) throw new UserError(`${where} : charge invalide.`);
      if (Number.isNaN(reps) || (reps !== null && (reps < 0 || reps > 1000 || !Number.isInteger(reps)))) throw new UserError(`${where} : nombre de répétitions invalide.`);
      if (Number.isNaN(rp) || (rp !== null && (rp < 0 || rp > 1000 || !Number.isInteger(rp)))) throw new UserError(`${where} : complément de rest-pause invalide.`);
      if (rp && !reps) throw new UserError(`${where} : indique d'abord les reps avant l'échec, puis le complément (ex. 8 + 7).`);
      const set = { load: load === null ? null : round(load, 2), reps };
      if (rp) { set.rpReps = rp; set.rpPause = def ? def.rpPause : RP_DEFAULTS.rpPause; }
      return set;
    });
    return { exerciseId: block.dataset.exerciseId || null, name, sets };
  });
}
function editorHasReps() {
  return $$('[data-field="reps"]', editorEl()).some((i) => i.value.trim() !== "");
}

/* ---------- Brouillon automatique : une séance en cours survit à la fermeture de l'app ---------- */

let draftTimer = null;
function saveWorkoutDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      const form = workoutForm();
      localSet(WORKOUT_DRAFT_KEY, {
        savedAt: Date.now(), editId: state.editing.workout, date: form.elements.date.value, session: form.elements.session.value,
        duration: form.elements.duration.value, cardio: form.elements.cardio.value, notes: form.elements.notes.value,
        extra: Object.fromEntries(WORKOUT_EXTRA_FIELDS.map((k) => [k, form.elements[k].value])),
        exercises: $$(".exercise-block", editorEl()).map((b) => ({
          exerciseId: b.dataset.exerciseId || null, name: $(".exercise-name", b).value, fixed: $(".exercise-name", b).readOnly,
          sets: $$(".set-row", b).map((r) => ({ load: $('[data-field="load"]', r).value, reps: $('[data-field="reps"]', r).value, rpReps: $('[data-field="rp"]', r).value }))
        }))
      });
    } catch (err) { console.warn("Brouillon non enregistré", err); }
  }, 300);
}
function restoreWorkoutDraft() {
  const draft = localGet(WORKOUT_DRAFT_KEY);
  if (!draft || !Array.isArray(draft.exercises)) return false;
  if (Date.now() - (draft.savedAt || 0) > 3 * 86400000) { localRemove(WORKOUT_DRAFT_KEY); return false; }
  const form = workoutForm();
  state.editing.workout = draft.editId && state.workouts.some((w) => w.id === draft.editId) ? draft.editId : null;
  form.elements.date.value = isValidISO(draft.date) ? draft.date : today();
  if ([...form.elements.session.options].some((o) => o.value === draft.session)) form.elements.session.value = draft.session;
  form.elements.duration.value = draft.duration || "";
  form.elements.cardio.value = draft.cardio || "";
  form.elements.notes.value = draft.notes || "";
  WORKOUT_EXTRA_FIELDS.forEach((k) => { form.elements[k].value = (draft.extra && draft.extra[k]) || ""; });
  form.elements.session.dataset.previous = form.elements.session.value;
  editorEl().innerHTML = draft.exercises.map((ex) => blockHTML({ exerciseId: ex.exerciseId, name: ex.name || "", sets: (ex.sets || []).map((s) => ({ load: s.load, reps: s.reps, rpReps: s.rpReps })) }, ex.fixed)).join("");
  $$(".exercise-block", editorEl()).forEach(renderBlockMeta);
  updateWorkoutFormMode();
  return true;
}
function clearWorkoutDraft() { clearTimeout(draftTimer); localRemove(WORKOUT_DRAFT_KEY); }

function updateWorkoutFormMode() {
  const editing = state.editing.workout ? state.workouts.find((w) => w.id === state.editing.workout) : null;
  document.getElementById("workout-form-title").textContent = editing ? `Modifier la séance du ${fmtDate(editing.date)}` : "Nouvelle séance";
  document.getElementById("workout-cancel").hidden = !editing && !localGet(WORKOUT_DRAFT_KEY);
  document.getElementById("workout-submit").textContent = editing ? "Enregistrer les modifications" : "Enregistrer la séance";
}

function resetWorkoutForm() {
  const form = workoutForm();
  state.editing.workout = null;
  clearWorkoutDraft();
  form.reset();
  form.elements.date.value = today();
  updateWorkoutPlaceholders();
  const firstSession = state.program?.sessions?.[0];
  form.elements.session.value = guessNextSession() || (firstSession ? firstSession.id : FREE_SESSION_ID);
  renderTemplate(form.elements.session.value);
  updateWorkoutFormMode();
}
/* Propose la séance suivante du programme (ex. Pull après un Push). */
function guessNextSession() {
  const sessions = state.program?.sessions || [];
  if (!sessions.length) return null;
  const last = state.workouts.find((w) => findSession(w.sessionId));
  if (!last) return sessions[0].id;
  const idx = sessions.findIndex((s) => s.id === last.sessionId);
  return sessions[(idx + 1) % sessions.length].id;
}

function startEditWorkout(id) {
  const w = state.workouts.find((x) => x.id === id);
  if (!w) return;
  const form = workoutForm();
  state.editing.workout = id;
  form.elements.date.value = w.date;
  form.elements.session.value = findSession(w.sessionId) ? w.sessionId : FREE_SESSION_ID;
  setField(form, "duration", w.duration);
  form.elements.cardio.value = w.cardio || "";
  form.elements.notes.value = w.notes || "";
  setField(form, "bikeKm", w.bikeKm);
  form.elements.bikeTime.value = w.bikeTimeS ? fmtDuration(w.bikeTimeS) : "";
  setField(form, "bikeLevel", w.bikeLevel);
  setField(form, "walkKm", w.walkKm);
  const weighIn = gymWeighIn(w.date);
  setField(form, "weighIn", weighIn ? weighIn.weight : null);
  renderEditor(w.exercises.map((e) => ({ exerciseId: e.exerciseId, name: e.name, sets: e.sets.map((s) => ({ ...s })) })));
  updateWorkoutFormMode();
  saveWorkoutDraft();
  switchView("training");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function onWorkoutSubmit(event) {
  event.preventDefault();
  const button = event.submitter || document.getElementById("workout-submit");
  await withBusy(button, async () => {
    const form = workoutForm();
    const date = form.elements.date.value;
    if (!isValidISO(date)) throw new UserError("Choisis une date valide.");
    const exercises = readEditor()
      .map((ex) => ({ ...ex, sets: ex.sets.filter((s) => s.reps !== null && s.reps > 0) }))
      .filter((ex) => ex.name && ex.sets.length);
    if (!exercises.length) throw new UserError("Renseigne les répétitions d'au moins une série.");
    const sessionId = form.elements.session.value;
    const session = findSession(sessionId);
    const existing = state.editing.workout ? await getRecord(state.editing.workout) : null;
    const record = {
      id: existing ? existing.id : uid(), type: "workout", date,
      sessionId: session ? session.id : FREE_SESSION_ID,
      sessionType: session ? session.name : (existing && !findSession(existing.sessionId) ? existing.sessionType : "Séance libre"),
      duration: readNumber(form, "duration", { min: 0, max: 1440, decimals: 0, label: "Durée", integer: true }),
      cardio: readText(form, "cardio", 200), notes: readText(form, "notes", 2000), exercises,
      createdAt: existing ? existing.createdAt : undefined
    };
    const extras = readWorkoutExtras(form);
    assignDefined(record, extras.workout);
    const toSave = [record];
    if (extras.weighIn !== null) {
      /* La pesée avant séance devient une mesure « Soir, avant séance » : elle alimente la moyenne sur 7 jours. */
      const previous = gymWeighIn(date);
      toSave.push(previous
        ? { ...previous, weight: extras.weighIn }
        : { id: uid(), type: "measurement", date, weight: extras.weighIn, waist: null, belly: null, chest: null, arm: null, thigh: null, notes: "", moment: GYM_WEIGH_IN });
    }
    const records = detectRecords(record);
    await saveRecords(toSave);
    await reloadWorkouts();
    if (toSave.length > 1) await reloadMeasurements();
    resetWorkoutForm();
    renderTraining();
    showToast(records.length ? `Séance enregistrée. Nouveau record : ${records.join(", ")} !` : (existing ? "Séance modifiée." : "Séance enregistrée."));
  });
}

function readWorkoutExtras(form) {
  const bikeTimeS = parseDuration(form.elements.bikeTime.value, "min");
  if (Number.isNaN(bikeTimeS) || (bikeTimeS !== null && (bikeTimeS <= 0 || bikeTimeS > 86400))) {
    form.elements.bikeTime.focus();
    throw new UserError("« Vélo : temps » : écris par exemple 8:15 (minutes:secondes).");
  }
  const bikeKm = readNumber(form, "bikeKm", { min: 0, max: 300, decimals: 2, label: "Vélo : distance (km)" });
  return {
    weighIn: readNumber(form, "weighIn", { min: 20, max: 400, decimals: 2, label: "Pesée avant séance (kg)" }),
    workout: {
      bikeKm: bikeTimeS && bikeKm === null ? 5 : bikeKm, bikeTimeS,
      bikeLevel: readNumber(form, "bikeLevel", { min: 0, max: 100, decimals: 0, label: "Vélo : difficulté", integer: true }),
      walkKm: readNumber(form, "walkKm", { min: 0, max: 300, decimals: 2, label: "Marche (km)" })
    }
  };
}

/* ---------- Historique ---------- */

function renderWorkoutHistory() {
  const el = document.getElementById("workout-history");
  const list = state.workouts;
  if (!list.length) { el.innerHTML = '<p class="empty">Aucune séance enregistrée.</p>'; return; }
  const flags = computeRecordFlags();
  const shown = list.slice(0, state.pages.workouts * WORKOUT_PAGE_SIZE);
  el.innerHTML = shown.map((w) => {
    const ex = w.exercises || [];
    const setCount = ex.reduce((a, e) => a + validSets(e.sets).length, 0);
    const vol = ex.reduce((a, e) => a + volume(e.sets), 0);
    const lines = ex.map((e) => `<li><b>${esc(e.name)}</b> <span>${esc((e.sets || []).map(fmtSet).join(" · "))}</span>${flags.has(`${w.id}|${fold(e.name)}`) ? ' <span class="badge">Record</span>' : ""}</li>`).join("");
    const cardio = workoutCardioText(w);
    const extra = [cardio ? `Cardio : ${cardio}` : "", w.notes].filter(Boolean).map((t) => `<p class="record-note">${esc(t)}</p>`).join("");
    return `<article class="record-item">
      <div class="record-main">
        <b>${esc(w.sessionType || "Séance")} · ${esc(fmtDate(w.date))}</b>
        <small>${[w.duration ? `${fmt(w.duration, 0)} min` : "", plural(ex.length, "exercice"), plural(setCount, "série"), vol ? `volume ${fmt(vol, 0)} kg` : ""].filter(Boolean).map(esc).join(" · ")}</small>
        <ul class="set-list">${lines}</ul>${extra}
      </div>
      <div class="record-actions">
        <button type="button" class="small-button" data-action="edit-workout" data-id="${esc(w.id)}">Modifier</button>
        <button type="button" class="small-button delete" data-action="delete-record" data-id="${esc(w.id)}">Supprimer</button>
      </div>
    </article>`;
  }).join("") + (list.length > shown.length ? `<button type="button" class="secondary-button" data-action="more" data-list="workouts">Afficher plus (${list.length - shown.length} restantes)</button>` : "");
}

function renderTraining() {
  safeRender("programme", renderSessionOptions);
  safeRender("historique des séances", renderWorkoutHistory);
  updateWorkoutFormMode();
}

async function reloadWorkouts() {
  state.workouts = sortWorkouts(await getByType("workout"));
}

/* ---------- Progression par exercice (onglet Progression) ---------- */

function renderExerciseProgress() {
  const select = document.getElementById("progress-exercise");
  const container = document.getElementById("exercise-progress");
  const names = [];
  const seen = new Set();
  state.workouts.forEach((w) => (w.exercises || []).forEach((e) => {
    const k = fold(e.name);
    if (!seen.has(k) && validSets(e.sets).length) { seen.add(k); names.push(e.name); }
  }));
  if (!names.length) {
    select.innerHTML = "";
    select.disabled = true;
    container.innerHTML = '<p class="empty">Enregistre des séances pour voir la progression de chaque exercice.</p>';
    return;
  }
  select.disabled = false;
  if (!state.progressExercise || !seen.has(fold(state.progressExercise))) state.progressExercise = names[0];
  select.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  select.value = names.find((n) => fold(n) === fold(state.progressExercise));

  const history = exerciseHistory(state.progressExercise).slice().reverse(); // chronologique
  const record = exerciseRecord(state.progressExercise);
  container.innerHTML = `<div class="stat-row">
      <div><span class="metric-label">Record</span><strong>${record ? esc(fmtSet(record.set)) : "—"}</strong><small>${record ? `1RM estimé ${esc(fmt(e1rm(record.set), 1))} kg` : ""}</small></div>
      <div><span class="metric-label">Séances</span><strong>${fmt(history.length, 0)}</strong><small>depuis le ${esc(fmtShortDate(history[0].date))}</small></div>
    </div>
    <div class="chart-box" id="exercise-chart"></div>
    <table class="data-table"><thead><tr><th>Date</th><th>Séries</th><th>1re série avant l'échec</th><th>Volume</th></tr></thead><tbody>
      ${history.slice().reverse().slice(0, 8).map((h) => `<tr><td>${esc(fmtShortDate(h.date))}</td><td>${esc(h.sets.map(fmtSet).join(" · "))}</td><td>${esc(fmt(h.sets[0].reps, 0))} reps</td><td>${esc(fmt(volume(h.sets), 0))} kg</td></tr>`).join("")}
    </tbody></table>`;
  lineChart(document.getElementById("exercise-chart"), {
    unit: "kg",
    series: [
      { name: "Charge max", cls: "s-load", dots: true, points: history.map((h) => ({ x: h.date, y: maxLoad(h.sets) })) },
      { name: "1RM estimé", cls: "s-trend", points: history.map((h) => ({ x: h.date, y: round(e1rm(bestSet(h.sets)), 1) })) }
    ],
    emptyText: "Au moins deux séances sont nécessaires pour tracer la courbe."
  });
}

/* ---------- Minuteur de repos ---------- */

const restTimer = { end: 0, interval: null };
function startRestTimer(seconds) {
  restTimer.end = Date.now() + seconds * 1000;
  clearInterval(restTimer.interval);
  restTimer.interval = setInterval(tickRestTimer, 250);
  tickRestTimer();
}
function stopRestTimer() {
  clearInterval(restTimer.interval);
  restTimer.end = 0;
  document.getElementById("rest-pill").hidden = true;
}
function tickRestTimer() {
  const pill = document.getElementById("rest-pill");
  const left = Math.ceil((restTimer.end - Date.now()) / 1000);
  if (left <= 0) {
    stopRestTimer();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    beep();
    showToast("Repos terminé : série suivante !");
    return;
  }
  pill.hidden = false;
  $("#rest-pill-time").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch { /* son indisponible : la vibration suffit */ }
}
function restDuration() { return localGet("pp-rest-seconds", 90); }

/* ---------- Branchements ---------- */

function setupTraining() {
  const form = workoutForm();
  form.addEventListener("submit", onWorkoutSubmit);
  form.addEventListener("input", saveWorkoutDraft);
  form.elements.session.addEventListener("change", (e) => {
    const previous = e.target.dataset.previous;
    if (editorHasReps() && !confirm("Changer de séance efface les séries déjà saisies. Continuer ?")) {
      if (previous) e.target.value = previous;
      return;
    }
    renderTemplate(e.target.value);
    saveWorkoutDraft();
  });
  form.elements.date.addEventListener("change", () => $$(".exercise-block", editorEl()).forEach(renderBlockMeta));

  editorEl().addEventListener("change", (e) => {
    if (e.target.classList.contains("exercise-name")) renderBlockMeta(e.target.closest(".exercise-block"));
  });
  /* Démarre le minuteur quand une série est complétée (option). */
  editorEl().addEventListener("change", (e) => {
    if (e.target.dataset.field === "reps" && e.target.value.trim() && localGet("pp-rest-auto", false)) startRestTimer(restDuration());
  });
  editorEl().addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const block = btn.closest(".exercise-block");
    if (btn.dataset.action === "add-set") {
      const rows = $(".set-rows", block);
      const lastLoad = $$('[data-field="load"]', rows).pop()?.value || "";
      rows.insertAdjacentHTML("beforeend", setRowHTML({ load: lastLoad.replace(",", "."), reps: null, rpReps: null }, $$(".set-row", rows).length));
      renderBlockMeta(block);
    } else if (btn.dataset.action === "remove-set") {
      const rows = $$(".set-row", block);
      if (rows.length > 1) rows[rows.length - 1].remove();
    } else if (btn.dataset.action === "remove-exercise") {
      if (!$$('[data-field="reps"], [data-field="rp"]', block).some((i) => i.value.trim()) || confirm("Retirer cet exercice et ses séries ?")) block.remove();
    } else if (btn.dataset.action === "apply-increment") {
      const inc = Number(btn.dataset.increment);
      $$('[data-field="load"]', block).forEach((input) => {
        const v = parseNumber(input.value);
        if (v !== null && !Number.isNaN(v)) input.value = String(round(v + inc, 2)).replace(".", ",");
      });
      btn.disabled = true;
      showToast(`+${fmt(inc, 2)} kg appliqués à chaque série.`);
    }
    renumberSets(block);
    saveWorkoutDraft();
  });
  document.getElementById("add-exercise").addEventListener("click", () => {
    $(".empty", editorEl())?.remove();
    editorEl().insertAdjacentHTML("beforeend", blockHTML({ exerciseId: null, name: "", sets: [{ load: null, reps: null }, { load: null, reps: null }, { load: null, reps: null }] }, false));
    const block = $$(".exercise-block", editorEl()).pop();
    $(".exercise-name", block).focus();
    saveWorkoutDraft();
  });
  document.getElementById("workout-cancel").addEventListener("click", () => {
    if (editorHasReps() && !confirm("Abandonner la saisie en cours ?")) return;
    resetWorkoutForm();
    showToast("Saisie abandonnée.");
  });

  /* Minuteur */
  $$("[data-rest]").forEach((b) => b.addEventListener("click", () => startRestTimer(Number(b.dataset.rest))));
  document.getElementById("rest-stop").addEventListener("click", stopRestTimer);
  const auto = document.getElementById("rest-auto");
  auto.checked = localGet("pp-rest-auto", false);
  auto.addEventListener("change", () => localSet("pp-rest-auto", auto.checked));
  const dur = document.getElementById("rest-seconds");
  dur.value = String(restDuration());
  dur.addEventListener("change", () => localSet("pp-rest-seconds", Number(dur.value) || 90));

  document.getElementById("progress-exercise").addEventListener("change", (e) => { state.progressExercise = e.target.value; renderExerciseProgress(); });
}
