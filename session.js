"use strict";
/* ==========================================================================
   Mode séance plein écran : un exercice à la fois, gros boutons, charge et reps de la dernière
   fois déjà proposées. Les réglages de la série en cours (+ / −, clavier) restent en attente jusqu'au
   bouton du bas, puis sont écrits dans le formulaire « Nouvelle séance » (brouillon compris).
   Fermer le mode séance ne perd donc rien, et l'enregistrement se fait comme d'habitude.
   ========================================================================== */

const SESSION_MODE_KEY = "pp-session-mode";
const sm = { ex: 0, set: 0, pending: {} };   // pending : valeurs réglées pour la série active, pas encore validées

function sessionDialog() { return document.getElementById("session-dialog"); }
function sessionModeOpen() { const d = sessionDialog(); return Boolean(d && d.open); }
function smBlocks() { return $$(".exercise-block", editorEl()); }
function smBlock() { return smBlocks()[sm.ex] || null; }
function smRows(block = smBlock()) { return block ? $$(".set-row", block) : []; }
function smInput(row, field) { return $(`[data-field="${field}"]`, row); }
function smName(block = smBlock()) { return block ? $(".exercise-name", block).value.trim() : ""; }
function smNumber(text) { const v = parseNumber(text); return v === null || Number.isNaN(v) ? null : v; }
/* Valeur saisie, sinon celle de la dernière fois (affichée en gris). */
function smValueOrPrevious(input) { return smNumber(input.value) ?? smNumber(input.placeholder); }
function smRowDone(row) { return smNumber(smInput(row, "reps").value) > 0; }
function smWrite(row, field, value) {
  smInput(row, field).value = value === null || value === undefined ? "" : String(round(value, 2)).replace(".", ",");
  saveWorkoutDraft();
}
/* Valeur affichée : réglage en attente, sinon celle du formulaire. */
function smShown(row, field) { return field in sm.pending ? sm.pending[field] : smInput(row, field).value; }
/* Valeur retenue : affichée, sinon celle de la dernière fois (en gris). */
function smValue(row, field) { return smNumber(smShown(row, field)) ?? smNumber(smInput(row, field).placeholder); }
/* Écrit dans le formulaire les réglages en attente de la série active. */
function smCommit(fields = ["load", "reps", "rp"]) {
  const row = smRows()[sm.set];
  if (row) fields.forEach((f) => { if (f in sm.pending) smWrite(row, f, smNumber(sm.pending[f])); });
  fields.forEach((f) => { delete sm.pending[f]; });
}
function smGoTo(ex, set) {
  smCommit();
  sm.pending = {};
  sm.ex = ex;
  sm.set = set;
}

/* Premier exercice / première série encore vide. */
function smFirstOpen() {
  const blocks = smBlocks();
  for (let e = 0; e < blocks.length; e++) {
    const i = smRows(blocks[e]).findIndex((r) => !smRowDone(r));
    if (i >= 0) return { ex: e, set: i };
  }
  return null;
}
function smNextOpen() {
  const rows = smRows();
  const i = rows.findIndex((r, k) => k > sm.set && !smRowDone(r));
  if (i >= 0) return { ex: sm.ex, set: i };
  const blocks = smBlocks();
  for (let e = sm.ex + 1; e < blocks.length; e++) {
    const k = smRows(blocks[e]).findIndex((r) => !smRowDone(r));
    if (k >= 0) return { ex: e, set: k };
  }
  return smFirstOpen();
}

function stepperHTML(field, label, row, unit, active, placeholder = null) {
  const raw = smInput(row, field).placeholder;
  const ph = placeholder ?? (smNumber(raw) === null ? "" : raw);
  return `<div class="sm-field">
    <span class="sm-field-label">${esc(label)}</span>
    <div class="sm-stepper">
      <button type="button" class="sm-step" data-sm-step="${field}" data-dir="-1" aria-label="${esc(label)} : moins" ${active ? "" : "disabled"}>−</button>
      <input class="sm-input" data-sm-field="${field}" inputmode="${field === "load" ? "decimal" : "numeric"}" autocomplete="off"
        value="${esc(smShown(row, field))}" placeholder="${esc(ph)}" aria-label="${esc(label)}" ${active ? "" : "disabled"}>
      <button type="button" class="sm-step" data-sm-step="${field}" data-dir="1" aria-label="${esc(label)} : plus" ${active ? "" : "disabled"}>+</button>
    </div>
    <span class="sm-unit">${esc(unit)}</span>
  </div>`;
}

function renderSessionMode() {
  const blocks = smBlocks();
  if (!blocks.length) { closeSessionMode(); return; }
  sm.ex = Math.min(Math.max(0, sm.ex), blocks.length - 1);
  const block = smBlock();
  const rows = smRows();
  sm.set = Math.min(Math.max(0, sm.set), Math.max(0, rows.length - 1));
  const name = smName();
  const def = findExerciseDef(name);
  const rp = isRestPause(def);
  const bw = block.classList.contains("is-bw");
  const loadText = (load) => (bw ? (load ? `PDC+${load}` : "PDC") : (load ? `${load} kg` : ""));
  localSet(SESSION_MODE_KEY, { ex: sm.ex, at: Date.now() });

  document.getElementById("sm-progress").textContent = `Exercice ${sm.ex + 1}/${blocks.length}${def ? ` · ${def.mode === "classic" ? `${def.repMin} à ${def.repMax} reps` : `rest-pause, cible ${def.target} reps`}` : ""}`;
  document.getElementById("sm-name").textContent = name || "Exercice sans nom";
  document.getElementById("sm-prev").disabled = sm.ex === 0;
  document.getElementById("sm-next").disabled = sm.ex >= blocks.length - 1;
  /* Dernière fois, record et conseil : repris de la carte de l'exercice dans le formulaire. */
  document.getElementById("sm-meta").innerHTML = $(".exercise-meta", block).innerHTML;

  const list = rows.map((row, i) => {
    const load = smInput(row, "load").value, reps = smInput(row, "reps").value, rpv = smInput(row, "rp").value;
    const done = smRowDone(row);
    const prev = $(".set-prev", row).textContent;
    const text = done ? `${loadText(load) || "PDC"} × ${reps}${rpv ? ` + ${rpv}` : ""}` : `${loadText(load) || "charge ?"}${prev ? ` · ${prev}` : ""}`;
    return `<button type="button" class="sm-set ${i === sm.set ? "is-active" : ""} ${done ? "is-done" : ""}" data-sm-set="${i}" aria-label="Série ${i + 1} : ${esc(text)}">
      <span class="sm-set-num">S${i + 1}</span><span class="sm-set-text">${esc(done ? text : (loadText(load) || "—"))}</span><span class="sm-set-check">${done ? "✓" : ""}</span></button>`;
  }).join("");

  const row = rows[sm.set];
  let panel = "", actions = "";
  if (!row) {
    panel = `<p class="muted">Aucune série pour cet exercice.</p>`;
  } else {
    const repsSet = smRowDone(row);
    const rpSet = smNumber(smInput(row, "rp").value) > 0;
    const phaseRp = rp && repsSet && !rpSet;
    const pause = rpPauseFor(name);
    let buttons;
    if (!rp) {
      buttons = `<button type="button" class="primary-button sm-main" data-sm-action="done">Série faite → repos ${esc(fmtClock(restDuration()))}</button>`;
    } else if (!repsSet) {
      buttons = `<button type="button" class="secondary-button sm-alt" data-sm-action="done-no-rp">Sans complément</button>
        <button type="button" class="primary-button sm-main" data-sm-action="fail">Échec → pause ${esc(String(pause))} s</button>`;
    } else if (phaseRp) {
      buttons = `<button type="button" class="secondary-button sm-alt" data-sm-action="done-no-rp">Sans complément</button>
        <button type="button" class="primary-button sm-main" data-sm-action="done-rp">Complément fait → repos</button>`;
    } else {
      buttons = `<button type="button" class="primary-button sm-main" data-sm-action="next">Série suivante</button>`;
    }
    const prev = $(".set-prev", row).textContent;
    panel = `<div class="sm-current">
        <p class="eyebrow">SÉRIE ${sm.set + 1}${phaseRp ? " · COMPLÉMENT APRÈS LA PAUSE" : ""}${prev ? ` · <span class="sm-prev">${esc(prev)}</span>` : ""}</p>
        ${bw ? stepperHTML("load", "Lest (facultatif)", row, "kg", true, "PDC") : stepperHTML("load", "Charge", row, "kg", true)}
        ${stepperHTML("reps", "Reps avant l'échec", row, "reps", true)}
        ${rp ? stepperHTML("rp", "Complément (RP)", row, "reps", repsSet) : ""}
        <p class="hint">En gris : tes chiffres de la dernière fois. Le bouton du bas les reprend tels quels si tu n'y touches pas.</p>
      </div>`;
    actions = buttons;
  }
  const allDone = !smFirstOpen();
  if (allDone) {
    panel = `<p class="sm-done">Toutes les séries sont notées. Bravo !</p>${panel}`;
    actions = `<button type="button" class="primary-button sm-main" data-sm-action="finish">Terminer la séance ✓</button>`;
  }
  document.getElementById("sm-sets").innerHTML = list;
  document.getElementById("sm-panel").innerHTML = panel;
  document.getElementById("sm-actions").innerHTML = actions;
  if (restTimer.end) tickRestTimer(); else renderRestDisplays(null);
}

function smAdvance() {
  const next = smNextOpen();
  if (next) smGoTo(next.ex, next.set);
  renderSessionMode();
}
function smFinish() {
  closeSessionMode();
  switchView("training");
  document.getElementById("workout-submit").scrollIntoView({ behavior: "smooth", block: "center" });
  showToast(smFirstOpen() ? "Séance gardée en brouillon : reprends-la quand tu veux." : "Ajoute ta pesée, ton vélo et tes notes si besoin, puis enregistre la séance.");
}
/* Boutons du bas. Sans réglage, ce sont les chiffres de la dernière fois qui sont notés. */
function smAction(action) {
  if (action === "finish") { smFinish(); return; }
  const row = smRows()[sm.set];
  if (!row) return;
  const name = smName();
  const needReps = action === "fail" || action === "done" || (action === "done-no-rp" && !smRowDone(row));
  if (needReps) {
    const reps = smValue(row, "reps");
    if (!reps || reps < 1) { showToast("Indique le nombre de reps avant l'échec.", "error"); $('[data-sm-field="reps"]', sessionDialog())?.focus(); return; }
    sm.pending.reps = String(Math.round(reps));
  }
  if (action === "fail") {
    smCommit(["load", "reps"]);
    startRestTimer(rpPauseFor(name), "Pause RP");
    renderSessionMode();
    return;
  }
  if (action === "done-rp") {
    const rpv = smValue(row, "rp");
    sm.pending.rp = rpv && rpv > 0 ? String(Math.round(rpv)) : "";
  }
  if (action === "done-no-rp") sm.pending.rp = "";
  smCommit();
  if (action !== "next") startRestTimer(restDuration(), "Repos");
  smAdvance();
}
function smStep(field, dir) {
  const row = smRows()[sm.set];
  if (!row) return;
  const def = findExerciseDef(smName());
  const step = field === "load" ? (def && def.increment > 0 ? def.increment : 2.5) : 1;
  const current = smValue(row, field) ?? 0;
  sm.pending[field] = String(Math.max(0, round(current + dir * step, 2))).replace(".", ",");
  const input = $(`[data-sm-field="${field}"]`, sessionDialog());
  if (input) input.value = sm.pending[field];
}

function openSessionMode(at = null) {
  if (!smBlocks().length) { showToast("Choisis une séance ou ajoute un exercice d'abord.", "error"); return; }
  const first = smFirstOpen();
  sm.pending = {};
  if (at && Number.isInteger(at.ex) && smBlocks()[at.ex]) { sm.ex = at.ex; sm.set = Math.max(0, smRows(smBlocks()[at.ex]).findIndex((r) => !smRowDone(r))); }
  else if (first) { sm.ex = first.ex; sm.set = first.set; }
  else { sm.ex = 0; sm.set = 0; }
  const dialog = sessionDialog();
  if (!dialog.open) dialog.showModal();
  keepScreenOn(true);
  renderSessionMode();
}
function closeSessionMode() {
  smCommit();
  localRemove(SESSION_MODE_KEY);
  const dialog = sessionDialog();
  if (dialog.open) dialog.close();
}
/* Séance en cours retrouvée au redémarrage (app fermée par le téléphone) : on rouvre le mode séance. */
function resumeSessionMode() {
  const saved = localGet(SESSION_MODE_KEY);
  if (!saved || Date.now() - (saved.at || 0) > 3 * 3600000 || !localGet(WORKOUT_DRAFT_KEY)) { localRemove(SESSION_MODE_KEY); return; }
  switchView("training");
  openSessionMode({ ex: saved.ex });
}

function setupSessionMode() {
  const dialog = sessionDialog();
  document.getElementById("session-open").addEventListener("click", () => openSessionMode());
  document.getElementById("sm-close").addEventListener("click", closeSessionMode);
  dialog.addEventListener("close", () => {
    smCommit();
    localRemove(SESSION_MODE_KEY);
    $$(".exercise-block", editorEl()).forEach(renderBlockMeta);
    if (restTimer.end) tickRestTimer();
    keepScreenOn(false);
  });
  const goExercise = (delta) => {
    const ex = Math.min(Math.max(0, sm.ex + delta), smBlocks().length - 1);
    smGoTo(ex, Math.max(0, smRows(smBlocks()[ex]).findIndex((r) => !smRowDone(r))));
    renderSessionMode();
  };
  document.getElementById("sm-prev").addEventListener("click", () => goExercise(-1));
  document.getElementById("sm-next").addEventListener("click", () => goExercise(1));
  document.getElementById("sm-timer-more").addEventListener("click", () => addRestTime(15));
  document.getElementById("sm-timer-stop").addEventListener("click", stopRestTimer);
  document.getElementById("sm-add-set").addEventListener("click", () => {
    smCommit();
    $('[data-action="add-set"]', smBlock())?.click();
    smGoTo(sm.ex, smRows().length - 1);
    renderSessionMode();
  });
  document.getElementById("sm-finish").addEventListener("click", smFinish);
  dialog.addEventListener("click", (e) => {
    const setBtn = e.target.closest("[data-sm-set]");
    if (setBtn) { smGoTo(sm.ex, Number(setBtn.dataset.smSet)); renderSessionMode(); return; }
    const step = e.target.closest("[data-sm-step]");
    if (step) { smStep(step.dataset.smStep, Number(step.dataset.dir)); return; }
    const act = e.target.closest("[data-sm-action]");
    if (act) { smAction(act.dataset.smAction); return; }
    /* « Appliquer +5 kg » du conseil de progression : même effet que dans le formulaire. */
    const inc = e.target.closest('[data-action="apply-increment"]');
    if (inc) { smCommit(); $('[data-action="apply-increment"]', smBlock())?.click(); renderSessionMode(); }
  });
  /* Saisie au clavier dans les grands champs : gardée en attente jusqu'au bouton du bas. */
  dialog.addEventListener("input", (e) => {
    const field = e.target.dataset.smField;
    if (field) sm.pending[field] = e.target.value;
  });
}
