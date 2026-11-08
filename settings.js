"use strict";
/* ==========================================================================
   Réglages : objectifs, programme d'entraînement modifiable, rappel quotidien.
   ========================================================================== */

/* ---------- Objectifs ---------- */

function renderTargetsForm() {
  const form = document.getElementById("targets-form");
  Object.keys(DEFAULT_TARGETS).forEach((k) => setField(form, k, state.targets[k]));
}
async function onTargetsSubmit(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = event.target;
    const targets = {
      kcal: readNumber(form, "kcal", { min: 500, max: 10000, decimals: 0, label: "Calories" }),
      protein: readNumber(form, "protein", { min: 0, max: 1000, decimals: 0, label: "Protéines" }),
      carbs: readNumber(form, "carbs", { min: 0, max: 2000, decimals: 0, label: "Glucides" }),
      fat: readNumber(form, "fat", { min: 0, max: 1000, decimals: 0, label: "Lipides" }),
      fiber: readNumber(form, "fiber", { min: 0, max: 200, decimals: 0, label: "Fibres" }),
      weight: readNumber(form, "weight", { min: 20, max: 400, decimals: 1, label: "Poids cible" })
    };
    await setSetting("targets", targets);
    state.targets = targets;
    showToast("Objectifs enregistrés.");
  });
}

/* ---------- Programme ---------- */

function programExerciseHTML(e) {
  const loads = (e.loads || []).filter((l) => l !== null && l !== undefined).map((l) => String(l).replace(".", ",")).join(" / ");
  const classic = e.mode === "classic";
  return `<div class="program-ex${classic ? " is-classic" : ""}" data-id="${esc(e.id || "")}">
    <label class="pe-name-label">Exercice<input class="pe-name" value="${esc(e.name || "")}" maxlength="80" placeholder="Nom de l'exercice"></label>
    <label class="pe-mode-label">Méthode<select class="pe-mode"><option value="restpause"${classic ? "" : " selected"}>Rest-pause</option><option value="classic"${classic ? " selected" : ""}>Classique</option></select></label>
    <label>Séries<input class="pe-sets" inputmode="numeric" value="${esc(e.sets ?? 4)}"></label>
    <label>Palier (kg)<input class="pe-inc" inputmode="decimal" value="${esc(String(e.increment ?? 2.5).replace(".", ","))}"></label>
    <label class="pe-rp">Reps visées<input class="pe-target" inputmode="numeric" value="${esc(e.target ?? RP_DEFAULTS.target)}"></label>
    <label class="pe-rp">Monter à (1re série)<input class="pe-upat" inputmode="numeric" value="${esc(e.upAt ?? RP_DEFAULTS.upAt)}"></label>
    <label class="pe-rp">Pause RP (s)<input class="pe-pause" inputmode="numeric" value="${esc(e.rpPause ?? RP_DEFAULTS.rpPause)}"></label>
    <label class="pe-classic">Reps min<input class="pe-min" inputmode="numeric" value="${esc(e.repMin ?? 8)}"></label>
    <label class="pe-classic">Reps max<input class="pe-max" inputmode="numeric" value="${esc(e.repMax ?? 12)}"></label>
    <label class="pe-loads-label">Charges de départ (kg)<input class="pe-loads" value="${esc(loads)}" placeholder="65 / 65 / 70 / 70"></label>
    <div class="pe-actions">
      <button type="button" class="chip-button" data-action="pe-up" aria-label="Monter">↑</button>
      <button type="button" class="chip-button" data-action="pe-down" aria-label="Descendre">↓</button>
      <button type="button" class="chip-button danger-text" data-action="pe-delete" aria-label="Supprimer l'exercice">Retirer</button>
    </div>
  </div>`;
}
function programSessionHTML(s) {
  return `<div class="program-session" data-id="${esc(s.id || "")}">
    <div class="program-session-head">
      <label>Nom de la séance<input class="ps-name" value="${esc(s.name || "")}" maxlength="40"></label>
      <button type="button" class="link-button danger-text" data-action="ps-delete">Supprimer la séance</button>
    </div>
    <div class="program-ex-list">${(s.exercises || []).map(programExerciseHTML).join("")}</div>
    <button type="button" class="chip-button" data-action="pe-add">+ Exercice</button>
  </div>`;
}
function renderProgramEditor() {
  document.getElementById("program-editor").innerHTML = (state.program?.sessions || []).map(programSessionHTML).join("");
}
function readProgramEditor() {
  const sessions = $$(".program-session", document.getElementById("program-editor")).map((sEl, si) => {
    const name = $(".ps-name", sEl).value.trim();
    if (!name) throw new UserError(`Séance n° ${si + 1} : donne-lui un nom.`);
    const exercises = $$(".program-ex", sEl).map((eEl) => {
      const exName = $(".pe-name", eEl).value.trim();
      if (!exName) throw new UserError(`Séance « ${name} » : un exercice n'a pas de nom.`);
      const get = (cls, label, min, max, integer = true) => {
        const n = parseNumber($(cls, eEl).value);
        if (n === null || Number.isNaN(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new UserError(`« ${exName} » : ${label} doit être entre ${min} et ${max}.`);
        return n;
      };
      const mode = $(".pe-mode", eEl).value === "classic" ? "classic" : "restpause";
      const sets = get(".pe-sets", "le nombre de séries", 1, 10);
      const repMin = get(".pe-min", "les reps min", 1, 100);
      const repMax = get(".pe-max", "les reps max", repMin, 100);
      const increment = get(".pe-inc", "le palier", 0, 50, false);
      const target = get(".pe-target", "les reps visées", 1, 100);
      const upAt = get(".pe-upat", "le seuil « Monter à »", 1, 100);
      const rpPause = get(".pe-pause", "la pause de rest-pause", 0, 600);
      const loadsText = $(".pe-loads", eEl).value.trim();
      const loads = loadsText ? loadsText.split(/[/;|]+/).map((t) => parseNumber(t)) : [];
      if (loads.some((l) => l === null || Number.isNaN(l) || l < 0 || l > 1000)) throw new UserError(`« ${exName} » : charges de départ invalides (exemple : 65 / 65 / 70 / 70).`);
      return { id: eEl.dataset.id || uid(), name: exName, sets, mode, target, upAt, rpPause, repMin, repMax, increment, loads };
    });
    return { id: sEl.dataset.id || uid(), name, exercises };
  });
  if (!sessions.length) throw new UserError("Garde au moins une séance dans le programme.");
  return normalizeProgram({ schema: PROGRAM_SCHEMA, sessions });
}
/* Exercice renommé : propose de renommer aussi l'historique pour ne pas perdre la progression. */
async function propagateRenames(oldProgram, newProgram) {
  const oldById = new Map();
  (oldProgram?.sessions || []).forEach((s) => s.exercises.forEach((e) => oldById.set(e.id, e.name)));
  const renames = [];
  newProgram.sessions.forEach((s) => s.exercises.forEach((e) => {
    const before = oldById.get(e.id);
    if (before && fold(before) !== fold(e.name)) renames.push([before, e.name]);
  }));
  if (!renames.length) return;
  const touched = state.workouts.filter((w) => (w.exercises || []).some((ex) => renames.some(([b]) => fold(b) === fold(ex.name))));
  if (!touched.length) return;
  if (!confirm(`Renommer aussi ces exercices dans ton historique (${plural(touched.length, "séance")}) ?\n${renames.map(([b, a]) => `${b} → ${a}`).join("\n")}\n\nSinon, l'exercice renommé repartira sans historique.`)) return;
  const tx = writeTx("records");
  const store = tx.objectStore("records");
  touched.forEach((w) => {
    const copy = { ...w, updatedAt: Date.now(), exercises: w.exercises.map((ex) => {
      const r = renames.find(([b]) => fold(b) === fold(ex.name));
      return r ? { ...ex, name: r[1] } : ex;
    }) };
    store.put(copy);
  });
  await txDone(tx);
  await reloadWorkouts();
}
async function saveProgram(button) {
  await withBusy(button, async () => {
    const program = readProgramEditor();
    await propagateRenames(state.program, program);
    await setSetting("program", program);
    state.program = program;
    renderProgramEditor();
    renderSessionOptions();
    if (!editorHasReps() && !state.editing.workout) renderTemplate(workoutForm().elements.session.value);
    showToast("Programme enregistré.");
  });
}

/* ---------- Rappel quotidien (via le service worker : fonctionne sur Android, audit I2) ---------- */

function reminderConfig() {
  /* Reprise des réglages de la version 1. */
  try {
    const oldEnabled = localStorage.getItem("pp-reminder-enabled");
    if (oldEnabled !== null) {
      localSet("pp-reminder", { enabled: oldEnabled === "true", time: localStorage.getItem("pp-reminder-time") || "21:00" });
      localStorage.removeItem("pp-reminder-enabled");
      localStorage.removeItem("pp-reminder-time");
    }
  } catch { /* stockage indisponible */ }
  return localGet("pp-reminder", { enabled: false, time: "21:00" });
}
async function notify(body) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await reg.showNotification("Personal Performance", { body, icon: "icon-192.png", tag: "pp-reminder", lang: "fr" });
    return true;
  } catch (err) {
    console.warn("Notification impossible", err);
    return false;
  }
}
async function checkReminder() {
  const cfg = reminderConfig();
  if (!cfg.enabled || !db) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (hhmm < cfg.time || localGet("pp-reminder-last") === today()) return;
  localSet("pp-reminder-last", today());
  const missing = [];
  if (!(await countByTypeDate("meal", today()))) missing.push("tes repas");
  if (!(await countByTypeDate("wellbeing", today()))) missing.push("ton check-in");
  if (!missing.length) return;
  const body = `Pense à renseigner ${missing.join(" et ")} du jour.`;
  if (!(await notify(body))) showToast(body);
}

function setupSettings() {
  document.getElementById("targets-form").addEventListener("submit", onTargetsSubmit);

  const editor = document.getElementById("program-editor");
  editor.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const ex = btn.closest(".program-ex");
    const session = btn.closest(".program-session");
    switch (btn.dataset.action) {
      case "pe-up": if (ex.previousElementSibling) ex.parentNode.insertBefore(ex, ex.previousElementSibling); break;
      case "pe-down": if (ex.nextElementSibling) ex.parentNode.insertBefore(ex.nextElementSibling, ex); break;
      case "pe-delete": if (confirm(`Retirer « ${$(".pe-name", ex).value || "cet exercice"} » du programme ? (Son historique est conservé.)`)) ex.remove(); break;
      case "pe-add":
        $(".program-ex-list", session).insertAdjacentHTML("beforeend", programExerciseHTML({ id: uid(), name: "", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [] }));
        $$(".pe-name", session).pop().focus();
        break;
      case "ps-delete": if (confirm(`Supprimer la séance « ${$(".ps-name", session).value} » du programme ? (Les séances déjà faites sont conservées.)`)) session.remove(); break;
      default: break;
    }
  });
  /* Rest-pause / classique : n'affiche que les réglages utiles à la méthode choisie. */
  editor.addEventListener("change", (e) => {
    if (e.target.classList.contains("pe-mode")) e.target.closest(".program-ex").classList.toggle("is-classic", e.target.value === "classic");
  });
  document.getElementById("program-add-session").addEventListener("click", () => {
    editor.insertAdjacentHTML("beforeend", programSessionHTML({ id: uid(), name: "Nouvelle séance", exercises: [] }));
    $$(".ps-name", editor).pop().select();
  });
  document.getElementById("program-save").addEventListener("click", (e) => saveProgram(e.currentTarget));
  document.getElementById("program-reset").addEventListener("click", () => {
    if (!confirm("Remettre le programme d'origine dans l'éditeur ? (Rien n'est enregistré tant que tu ne cliques pas sur « Enregistrer le programme ».)")) return;
    document.getElementById("program-editor").innerHTML = JSON.parse(JSON.stringify(DEFAULT_PROGRAM)).sessions.map(programSessionHTML).join("");
  });

  const cfg = reminderConfig();
  const enabled = document.getElementById("reminder-enabled");
  const time = document.getElementById("reminder-time");
  enabled.checked = cfg.enabled;
  time.value = cfg.time;
  const saveCfg = () => localSet("pp-reminder", { enabled: enabled.checked, time: time.value || "21:00" });
  enabled.addEventListener("change", async () => {
    saveCfg();
    if (enabled.checked && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    showToast(enabled.checked ? "Rappel activé (vérifié quand l'application est ouverte)." : "Rappel désactivé.");
  });
  time.addEventListener("change", () => { saveCfg(); localRemove("pp-reminder-last"); });
  document.getElementById("notification-test").addEventListener("click", async () => {
    if (!("Notification" in window)) { showToast("Notifications non prises en charge par ce navigateur.", "error"); return; }
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") { showToast("Notifications refusées : autorise-les dans les réglages du navigateur.", "error"); return; }
    showToast((await notify("Test : les rappels fonctionnent.")) ? "Notification envoyée." : "Notification impossible : ouvre l'application depuis son adresse https.", "ok");
  });
  document.getElementById("app-version").textContent = APP_VERSION;
}

function renderSettings() {
  safeRender("objectifs", renderTargetsForm);
  safeRender("programme", renderProgramEditor);
  safeRender("synchronisation", renderSyncPanel);
  renderStorageInfo().catch(console.error);
}
