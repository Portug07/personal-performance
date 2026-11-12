"use strict";
/* ==========================================================================
   Démarrage, navigation, actions communes, mises à jour de l'application.
   Chargé en dernier.
   ========================================================================== */

const VIEWS = ["dashboard", "training", "nutrition", "progress", "wellbeing", "settings"];

async function reloadAll() {
  await Promise.all([reloadWorkouts(), reloadMeals(), reloadMeasurements(), reloadWellbeing(), reloadBattery(), reloadRuns()]);
  renderView(state.view);
}

function renderView(view) {
  switch (view) {
    case "dashboard": renderDashboard(); break;
    case "training": renderTraining(); break;
    case "nutrition": renderNutrition(); break;
    case "progress": renderProgress(); break;
    case "wellbeing": renderWellbeing(); break;
    case "settings": renderSettings(); break;
    default: break;
  }
}
function switchView(view) {
  if (!VIEWS.includes(view)) view = "dashboard";
  state.view = view;
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  $$("button[data-view]").forEach((b) => {
    const active = b.dataset.view === view;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.body.dataset.current = view;
  renderView(view);
  window.scrollTo({ top: 0 });
}

/* Actions des listes (boutons générés dans l'historique). */
async function onGlobalClick(e) {
  const go = e.target.closest("[data-go]");
  if (go) { switchView(go.dataset.go); return; }
  const nav = e.target.closest("button[data-view]");
  if (nav) { switchView(nav.dataset.view); return; }
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case "delete-record":
      if (!confirm("Supprimer définitivement cette entrée ?")) return;
      await withBusy(btn, async () => {
        await deleteRecord(id);
        /* On ne recharge que la catégorie concernée : plus rapide avec des années d'historique. */
        if (state.workouts.some((r) => r.id === id)) await reloadWorkouts();
        else if (state.measurements.some((r) => r.id === id)) await reloadMeasurements();
        else if (state.wellbeing.some((r) => r.id === id)) await reloadWellbeing();
        else if (state.battery.some((r) => r.id === id)) await reloadBattery();
        else await reloadMeals();
        renderView(state.view);
        showToast("Entrée supprimée.");
      });
      break;
    case "edit-workout": startEditWorkout(id); break;
    case "edit-meal": startEditMeal(id); break;
    case "repeat-meal": await withBusy(btn, () => repeatMeal(id)); break;
    case "view-photo": viewPhoto(btn.dataset.photo).catch(console.error); break;
    case "edit-measurement": startEditMeasurement(id); break;
    case "edit-wellbeing": startEditWellbeing(id); break;
    case "edit-battery": startEditBattery(id); break;
    case "more":
      state.pages[btn.dataset.list] += 1;
      renderView(state.view);
      break;
    default: break;
  }
}

/* Passage à minuit pendant que l'application reste ouverte (audit M1). */
function checkDayChange() {
  const t = today();
  if (state.day === t) return;
  const previous = state.day;
  state.day = t;
  if (state.nutritionDate === previous) state.nutritionDate = t;
  ["measurement-form", "wellbeing-form", "battery-form"].forEach((id) => {
    const f = document.getElementById(id);
    if (f && f.elements.date.value === previous) f.elements.date.value = t;
  });
  const recapDate = document.getElementById("recap-date");
  if (recapDate.value === previous) recapDate.value = t;
  if (!state.editing.meal) mealForm().elements.date.value = state.nutritionDate;
  if (!editorHasReps() && !state.editing.workout) workoutForm().elements.date.value = t;
  reloadAll().catch(console.error);
}

/* ---------- Mises à jour (audit C3) ---------- */

function showUpdateBanner(text, onAccept) {
  const banner = document.getElementById("update-banner");
  document.getElementById("update-text").textContent = text;
  banner.hidden = false;
  document.getElementById("update-button").onclick = onAccept;
}
function setupServiceWorker() {
  const status = document.getElementById("connection-status");
  const updateStatus = (ready) => {
    if (!navigator.onLine) status.textContent = ready ? "● Hors ligne · prêt" : "● Hors ligne";
    else status.textContent = ready ? "● Disponible hors ligne" : "● En ligne";
    status.classList.toggle("warn", !navigator.onLine && !ready);
  };
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) {
    updateStatus(false);
    window.addEventListener("online", () => updateStatus(false));
    window.addEventListener("offline", () => updateStatus(false));
    return;
  }
  let ready = false;
  window.addEventListener("online", () => updateStatus(ready));
  window.addEventListener("offline", () => updateStatus(ready));
  updateStatus(false);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    const offerUpdate = (worker) => showUpdateBanner("Une nouvelle version est disponible.", () => {
      saveWorkoutDraft();
      worker.postMessage("SKIP_WAITING");
    });
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    return navigator.serviceWorker.ready;
  }).then(() => { ready = true; updateStatus(true); })
    .catch((err) => console.warn("Service worker non enregistré", err));
}

function setupInstall() {
  let deferred = null;
  const btn = document.getElementById("install-button");
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
  btn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { requestPersistence().then(() => renderStorageInfo().catch(() => {})); });
}

async function init() {
  try {
    db = await openDB();
  } catch (err) {
    console.error(err);
    document.getElementById("fatal-error").hidden = false;
    return;
  }
  state.day = today();
  state.nutritionDate = today();
  await loadSyncAccount();
  await loadStrava();
  const storedProgram = normalizeProgram(await getSetting("program", null));
  if (storedProgram) {
    /* Programme d'une version précédente : passage au rest-pause et ajout du Reverse butterfly (une seule fois). */
    const { program, changed } = upgradeProgram(storedProgram);
    state.program = program;
    if (changed) await setSetting("program", program);
  } else {
    state.program = JSON.parse(JSON.stringify(DEFAULT_PROGRAM));
  }
  state.targets = { ...DEFAULT_TARGETS, ...(await getSetting("targets", {})) };

  setupTraining();
  setupSessionMode();
  setupGenerator();
  setupRun();
  setupNutrition();
  setupScan();
  setupQuickMeals();
  setupRecipes();
  setupExpress();
  setupDayMenu();
  setupProgress();
  setupWellbeing();
  setupDashboard();
  setupCoach();
  setupCoachSheet();
  setupBattery();
  setupBackup();
  setupSettings();
  setupDayTargets();
  setupSync();
  setupCloudBackups();
  setupStrava();
  setupInstall();
  document.body.addEventListener("click", (e) => { onGlobalClick(e).catch((err) => showToast(humanError(err), "error")); });

  await Promise.all([reloadWorkouts(), reloadMeals(), reloadMeasurements(), reloadWellbeing(), reloadBattery(), reloadRuns()]);
  renderSessionOptions();
  if (restoreWorkoutDraft()) { showToast("Séance en cours restaurée."); resumeSessionMode(); }
  else resetWorkoutForm();
  resetMealForm();
  resetMeasurementForm();
  resetWellbeingForm();
  resetBatteryForm();

  const query = new URLSearchParams(location.search);
  /* Retour de la page Strava → Réglages ; fichier GPX partagé → Séance. */
  const requested = query.has("shared-gpx") ? "training" : query.has("state") && (query.has("code") || query.has("error")) ? "settings" : query.get("view");
  switchView(VIEWS.includes(requested) ? requested : "dashboard");
  handleStravaRedirect().catch(console.error);
  checkSharedGpx().catch(console.error);

  setupServiceWorker();
  requestPersistence().catch(() => {});
  autoFolderBackup().catch(() => {});
  checkReminder().catch(console.error);
  startSync();
  maybeStravaImport();
  setInterval(() => { checkDayChange(); checkReminder().catch(console.error); }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { checkDayChange(); checkReminder().catch(console.error); if (restTimer.end) tickRestTimer(); if (restTimer.end || sessionModeOpen()) keepScreenOn(true); }
  });
}

document.addEventListener("DOMContentLoaded", init);
