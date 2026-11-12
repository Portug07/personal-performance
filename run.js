"use strict";
/* ==========================================================================
   Course : plan de reprise course / marche (on avance si le genou suit), journal des sorties,
   import d'un fichier GPX (export Strava, montre, partage Android).
   Règle de douleur (0 à 10, la plus forte de « pendant », « juste après » et « le lendemain ») :
   0–2 → séance validée (2 séances validées = étape suivante) ; 3–5 → on répète l'étape ;
   plus de 5 → on recule d'une étape. Ce n'est qu'une proposition : la décision t'appartient.
   ========================================================================== */

/* Étapes : répétitions de (course + marche), précédées et suivies de 5 min de marche. */
const RUN_PLAN = [
  { reps: 8, run: 60, walk: 120 }, { reps: 8, run: 90, walk: 120 }, { reps: 7, run: 120, walk: 120 },
  { reps: 6, run: 180, walk: 120 }, { reps: 5, run: 240, walk: 120 }, { reps: 4, run: 300, walk: 120 },
  { reps: 3, run: 420, walk: 120 }, { reps: 3, run: 480, walk: 60 }, { reps: 2, run: 600, walk: 60 },
  { reps: 2, run: 720, walk: 60 }, { reps: 1, run: 1200, walk: 0 }, { reps: 1, run: 1500, walk: 0 },
  { reps: 1, run: 1800, walk: 0 }
];
const RUN_WARMUP_S = 300;
const RUN_COOLDOWN_S = 300;
const RUN_OK_PAIN = 2;
const RUN_STOP_PAIN = 5;
const RUN_VALIDATIONS = 2;
const RUN_PAUSE_DAYS = 14;        // plus de 14 jours sans courir : on conseille de reculer d'une étape
const RUN_SOURCES = ["app", "manuel", "strava", "gpx"];
let runEditing = null;            // entrée en cours de modification (ou bilan d'une séance chronométrée)

/* ---------- Plan ---------- */

function fmtMinSec(s) {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r ? `${m} min ${String(r).padStart(2, "0")}` : `${m} min`;
}
function runStepDef(step) { return RUN_PLAN[step - 1] || null; }
function runStepText(step) {
  const d = runStepDef(step);
  if (!d) return "";
  return d.reps === 1 && !d.walk ? `${fmtMinSec(d.run)} de course continue` : `${d.reps} × (${fmtMinSec(d.run)} de course + ${fmtMinSec(d.walk)} de marche)`;
}
function runPhases(def) {
  const phases = [{ kind: "walk", label: "Échauffement en marchant", s: RUN_WARMUP_S }];
  for (let i = 0; i < def.reps; i++) {
    phases.push({ kind: "run", label: def.reps > 1 ? `Course ${i + 1}/${def.reps}` : "Course", s: def.run });
    if (def.walk && i < def.reps - 1) phases.push({ kind: "walk", label: "Marche", s: def.walk });
  }
  phases.push({ kind: "walk", label: "Retour au calme en marchant", s: RUN_COOLDOWN_S });
  return phases;
}
function phasesTotal(phases) { return phases.reduce((a, p) => a + p.s, 0); }

/* Douleur retenue pour une sortie : la plus forte notée (null si rien n'est noté). */
function runPain(r) {
  const v = [r.painDuring, r.painAfter, r.painNext].filter((x) => x !== null && x !== undefined);
  return v.length ? Math.max(...v) : null;
}
function runVerdict(r) {
  const pain = runPain(r);
  if (pain !== null && pain > RUN_STOP_PAIN) return "back";
  if (pain !== null && pain > RUN_OK_PAIN) return "repeat";
  if (!r.completed) return "repeat";
  if (pain === null) return "unknown";
  return "ok";
}
/* Où tu en es : rejoue toutes les sorties du plan dans l'ordre. */
function runPlanState(runs = state.runs) {
  const planRuns = runs.filter((r) => r.planStep).slice().sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  let step = 1, ok = 0, last = null, verdict = null;
  for (const r of planRuns) {
    if (r.planStep !== step) { step = Math.min(r.planStep, RUN_PLAN.length); ok = 0; }
    verdict = runVerdict(r);
    if (verdict === "back") { step = Math.max(1, step - 1); ok = 0; }
    else if (verdict === "repeat") ok = 0;
    else if (verdict === "ok") {
      ok++;
      if (ok >= RUN_VALIDATIONS) { step++; ok = 0; verdict = "up"; }
    }
    last = r;
  }
  const t = today();
  const lastAny = runs.slice().sort(newestFirst)[0] || null;
  let suggested = Math.min(step, RUN_PLAN.length);
  let pauseBack = false;
  if (lastAny && lastAny.date < addDays(t, -RUN_PAUSE_DAYS) && suggested > 1) { suggested--; pauseBack = true; }
  return {
    step, ok, last, verdict, suggested, pauseBack, done: step > RUN_PLAN.length,
    /* Un jour de repos entre deux sorties. */
    nextDate: lastAny ? addDays(lastAny.date, 2) : t,
    /* Genou le lendemain pas encore noté (on le demande pendant 2 jours). */
    pendingNext: lastAny && lastAny.painNext === undefined && lastAny.date < t && lastAny.date >= addDays(t, -2) && (lastAny.planStep || lastAny.source === "app") ? lastAny : null
  };
}
function runPaceText(r) {
  if (!r.distanceKm || !r.durationS) return "";
  const s = r.durationS / r.distanceKm;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`;
}
/* Durées « 1:05:30 », « 32:10 », « 32 » (minutes). */
function parseRunDuration(value) {
  const text = String(value || "").trim().replace(",", ".");
  if (!text) return null;
  let m = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const d = parseDuration(text, "min");
  return Number.isFinite(d) ? d : NaN;
}
function fmtRunDuration(s) {
  if (!s) return "—";
  s = Math.round(s);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : fmtDuration(s);
}
function runTitle(r) {
  if (r.planStep) return `Étape ${r.planStep} du plan`;
  return r.name || "Course";
}
function runSummaryText(r) {
  return [fmtRunDuration(r.durationS), r.distanceKm ? `${fmt(r.distanceKm, 2)} km` : "", runPaceText(r)].filter((x) => x && x !== "—").join(" · ");
}

/* ---------- Données ---------- */

async function reloadRuns() {
  state.runs = (await getByType("run")).sort(newestFirst);
}
async function saveRun(raw) {
  const norm = normalizeRecord({ ...raw, type: "run" });
  if (!norm) throw new UserError("Note au moins une durée ou une distance.");
  await saveRecord(norm.record);
  await reloadRuns();
  return norm.record;
}
/* Course importée (Strava, GPX) : déjà connue → rien ; même jour qu'une séance chronométrée sans distance → on la complète. */
async function mergeImportedRun(rec) {
  const known = state.runs.find((r) => r.id === rec.id || (rec.stravaId && r.stravaId === rec.stravaId)
    || (r.date === rec.date && r.startTime && rec.startTime && Math.abs(minutesOf(r.startTime) - minutesOf(rec.startTime)) <= 3 && r.distanceKm));
  if (known) return "known";
  const twin = state.runs.find((r) => r.date === rec.date && (r.source === "app" || r.source === "manuel") && !r.stravaId && !r.importedFrom);
  if (twin) {
    const merged = assignDefined({ ...twin, importedFrom: rec.source }, {
      distanceKm: twin.distanceKm || rec.distanceKm, stravaId: rec.stravaId, avgHr: rec.avgHr, elevationM: rec.elevationM,
      startTime: twin.startTime || rec.startTime, durationS: twin.durationS || rec.durationS
    });
    await saveRecord(normalizeRecord(merged).record);
    state.runs = state.runs.map((r) => (r.id === twin.id ? merged : r));
    return "merged";
  }
  const norm = normalizeRecord({ ...rec, type: "run" });
  if (!norm) return "invalid";
  await saveRecord(norm.record);
  state.runs.push(norm.record);
  return "new";
}
function minutesOf(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; }

/* ---------- GPX ---------- */

function haversineM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function parseGpx(text) {
  const doc = new DOMParser().parseFromString(String(text || ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new UserError("Fichier GPX illisible.");
  const val = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ""; };
  const pts = [...doc.getElementsByTagName("trkpt")].map((p) => ({
    lat: Number(p.getAttribute("lat")), lon: Number(p.getAttribute("lon")),
    ele: val(p, "ele") === "" ? null : Number(val(p, "ele")), t: Date.parse(val(p, "time"))
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  if (pts.length < 2) throw new UserError("Aucun tracé dans ce fichier GPX.");
  let dist = 0, moving = 0, climb = 0, lastEle = null;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineM(pts[i - 1], pts[i]);
    dist += d;
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    /* Temps en mouvement : on ignore les arrêts (moins de 1,8 km/h) et les trous de plus de 30 s. */
    if (Number.isFinite(dt) && dt > 0 && dt <= 30 && d / dt >= 0.5) moving += dt;
    if (pts[i].ele !== null && Number.isFinite(pts[i].ele)) {
      if (lastEle === null) lastEle = pts[i].ele;
      else if (pts[i].ele - lastEle >= 2) { climb += pts[i].ele - lastEle; lastEle = pts[i].ele; }
      else if (lastEle - pts[i].ele >= 2) lastEle = pts[i].ele;
    }
  }
  const first = pts.find((p) => Number.isFinite(p.t));
  if (!first) throw new UserError("Ce GPX n'a pas d'horaires : impossible de savoir quand tu as couru.");
  const start = new Date(first.t);
  const name = val(doc.getElementsByTagName("trk")[0] || doc, "name") || val(doc, "name");
  return {
    id: `gpx-${first.t}`, source: "gpx", date: isoDate(start),
    startTime: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
    name: name.slice(0, 120) || "Course (GPX)", durationS: Math.round(moving) || null,
    distanceKm: round(dist / 1000, 2), elevationM: Math.round(climb) || null
  };
}
async function importGpxText(text) {
  const rec = parseGpx(text);
  const res = await mergeImportedRun(rec);
  await reloadRuns();
  renderRunPanel();
  const label = `${fmtDate(rec.date)} · ${fmt(rec.distanceKm, 2)} km`;
  if (res === "known") showToast(`Déjà dans ton journal : ${label}.`);
  else if (res === "merged") showToast(`GPX ajouté à ta séance du ${fmtDate(rec.date)} (distance, allure).`);
  else showToast(`Course importée : ${label}.`);
  return res;
}
/* Fichier partagé depuis une autre app Android (menu Partager → Personal Performance). */
async function checkSharedGpx() {
  const q = new URLSearchParams(location.search);
  if (!q.has("shared-gpx") || typeof caches === "undefined") return;
  history.replaceState(null, "", location.pathname + "?view=training");
  try {
    const cache = await caches.open("pp-shared");
    const res = await cache.match("./shared-gpx");
    if (!res) { showToast("Fichier partagé introuvable : réessaie, ou utilise « Importer un GPX ».", "error"); return; }
    await cache.delete("./shared-gpx");
    await importGpxText(await res.text());
  } catch (err) {
    showToast(humanError(err), "error");
  }
}

/* ---------- Affichage ---------- */

function runStepOptions(selected, { free = false, custom = false } = {}) {
  return (free ? `<option value="">Aucune (sortie libre)</option>` : "")
    + RUN_PLAN.map((d, i) => {
      const total = Math.round(phasesTotal(runPhases(d)) / 60);
      return `<option value="${i + 1}"${selected === i + 1 ? " selected" : ""}>Étape ${i + 1} · ${esc(runStepText(i + 1))} · ${total} min</option>`;
    }).join("")
    + (custom ? `<option value="custom"${selected === "custom" ? " selected" : ""}>Personnalisée</option>` : "");
}
function runStatusHTML(ps) {
  const t = today();
  const parts = [];
  if (ps.done) parts.push(`<p><b>Plan terminé</b> : 30 min de course continue validées. Tu peux passer à des sorties libres (note-les dans le journal), en gardant la règle de douleur.</p>`);
  else {
    parts.push(`<p class="run-step"><b>Étape ${ps.suggested} sur ${RUN_PLAN.length}</b> · ${esc(runStepText(ps.suggested))}</p>`);
    if (ps.pauseBack) parts.push(`<p class="hint">Plus de ${RUN_PAUSE_DAYS} jours sans courir : on reprend une étape plus bas.</p>`);
    else if (ps.ok) parts.push(`<p class="hint">1 séance validée à cette étape : encore ${RUN_VALIDATIONS - ps.ok} sans douleur pour passer à la suivante.</p>`);
  }
  if (ps.last) {
    const pain = runPain(ps.last);
    const msg = { up: "validée : étape suivante débloquée", ok: "validée", repeat: ps.last.completed ? "douleur à surveiller : on répète l'étape" : "pas terminée : on répète l'étape",
      back: "douleur forte : on recule d'une étape (parles-en à ton kiné ou ton médecin si ça dure)", unknown: "douleur non notée : elle ne compte pas pour avancer" }[ps.verdict];
    parts.push(`<p class="hint">Dernière séance du plan (${esc(fmtShortDate(ps.last.date))}${pain !== null ? `, genou ${esc(fmt(pain, 1))}/10` : ""}) : ${esc(msg)}.</p>`);
  }
  if (ps.nextDate > t) parts.push(`<p class="hint run-rest">Repos : prochaine sortie ${ps.nextDate === addDays(t, 1) ? "demain" : `le ${esc(fmtShortDate(ps.nextDate))}`} au plus tôt (un jour sans courir entre deux sorties).</p>`);
  return parts.join("");
}
function runItemHTML(r) {
  const pain = [["painDuring", "pendant"], ["painAfter", "après"], ["painNext", "lendemain"]].filter(([k]) => r[k] !== undefined && r[k] !== null).map(([k, l]) => `${l} ${fmt(r[k], 1)}`);
  const src = { strava: "Strava", gpx: "GPX" }[r.source] || (r.importedFrom ? { strava: "+ Strava", gpx: "+ GPX" }[r.importedFrom] : "");
  return `<div class="record-item run-item">
    <div><b>${esc(runTitle(r))}</b>${src ? ` <span class="badge">${esc(src)}</span>` : ""}
      <small>${esc(fmtDate(r.date))}${r.startTime ? ` · ${esc(r.startTime)}` : ""} · ${esc(runSummaryText(r))}${r.planStep ? ` · ${r.completed ? "terminée" : "interrompue"}` : ""}</small>
      ${pain.length ? `<small>Genou : ${esc(pain.join(" · "))} /10</small>` : ""}
      ${r.notes ? `<small class="muted">${esc(r.notes)}</small>` : ""}</div>
    <div class="record-actions">
      <button type="button" class="small-button" data-run-edit="${esc(r.id)}">Modifier</button>
      <button type="button" class="small-button danger-text" data-run-delete="${esc(r.id)}">Supprimer</button>
    </div>
  </div>`;
}
let runListPage = 1;
function renderRunPanel() {
  const ps = runPlanState();
  document.getElementById("run-status").innerHTML = runStatusHTML(ps);
  /* Genou le lendemain */
  const next = document.getElementById("run-next-day");
  next.hidden = !ps.pendingNext;
  if (ps.pendingNext) {
    next.innerHTML = `<p><b>Ton genou ce matin</b>, après ta course du ${esc(fmtShortDate(ps.pendingNext.date))} ? (0 = rien)</p>
      <div class="run-scale">${Array.from({ length: 11 }, (_, i) => `<button type="button" class="chip-button" data-run-next="${i}">${i}</button>`).join("")}</div>`;
    next.dataset.id = ps.pendingNext.id;
  }
  /* Séance à lancer */
  const form = document.getElementById("run-launch");
  const current = form.elements.step.value;
  form.elements.step.innerHTML = runStepOptions(ps.suggested, { custom: true });
  if (current && current !== String(runLaunchDefault)) form.elements.step.value = current;
  runLaunchDefault = ps.suggested;
  document.getElementById("run-custom").hidden = form.elements.step.value !== "custom";
  renderRunResume();
  /* Journal */
  const shown = state.runs.slice(0, runListPage * 8);
  document.getElementById("run-list").innerHTML = shown.length
    ? shown.map(runItemHTML).join("") + (state.runs.length > shown.length ? `<button type="button" class="link-button" id="run-more">Voir plus</button>` : "")
    : `<p class="empty">Aucune course pour l'instant.</p>`;
}
let runLaunchDefault = null;

/* ---------- Saisie / bilan ---------- */

function openRunForm(rec = null, { title = "Course" } = {}) {
  runEditing = rec;
  const form = document.getElementById("run-form");
  form.reset();
  form.elements.planStep.innerHTML = runStepOptions(rec && rec.planStep ? rec.planStep : null, { free: true });
  document.getElementById("run-form-title").textContent = title;
  setField(form, "date", rec ? rec.date : today());
  setField(form, "duration", rec && rec.durationS ? fmtRunDuration(rec.durationS) : "");
  setField(form, "distanceKm", rec ? rec.distanceKm : null);
  form.elements.planStep.value = rec && rec.planStep ? String(rec.planStep) : "";
  form.elements.completed.checked = rec ? Boolean(rec.completed) : false;
  ["painDuring", "painAfter", "painNext", "effort"].forEach((k) => setField(form, k, rec ? rec[k] : null));
  setField(form, "notes", rec ? rec.notes : "");
  document.getElementById("run-completed-row").hidden = !form.elements.planStep.value;
  document.getElementById("run-dialog").showModal();
}
async function onRunSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  await withBusy(form.querySelector("[type=submit]"), async () => {
    const date = form.elements.date.value;
    if (!isValidISO(date)) throw new UserError("Choisis la date de la course.");
    const durationS = parseRunDuration(form.elements.duration.value);
    if (Number.isNaN(durationS)) throw new UserError("Durée : écris par exemple 32:30 ou 32 (minutes) ou 1:05:00.");
    const distanceKm = readNumber(form, "distanceKm", { min: 0, max: 300, label: "Distance" });
    if (!durationS && !distanceKm) throw new UserError("Note au moins la durée ou la distance.");
    const planStep = form.elements.planStep.value ? Number(form.elements.planStep.value) : null;
    const pain = (k, label) => readNumber(form, k, { min: 0, max: 10, decimals: 1, label });
    const painDuring = pain("painDuring", "Genou pendant");
    const painAfter = pain("painAfter", "Genou juste après");
    if (planStep && painDuring === null && painAfter === null) throw new UserError("Pour le plan, note la douleur du genou (0 si rien) : c'est elle qui décide de la suite.");
    /* Bilan d'une séance chronométrée : garde l'heure de départ, le temps couru, la source « app ». */
    const base = { id: uid(), source: "manuel", ...(runEditing || {}) };
    const rec = {
      ...base, date, durationS: durationS || null, distanceKm, planStep, completed: planStep ? form.elements.completed.checked : false,
      painDuring, painAfter, painNext: pain("painNext", "Genou le lendemain"),
      effort: readNumber(form, "effort", { min: 1, max: 10, decimals: 0, integer: true, label: "Effort ressenti" }), notes: readText(form, "notes", 1000)
    };
    ["painDuring", "painAfter", "painNext", "effort", "distanceKm", "durationS"].forEach((k) => { if (rec[k] === null) delete rec[k]; });
    if (!planStep) delete rec.planStep;
    const saved = await saveRun(rec);
    document.getElementById("run-dialog").close();
    runEditing = null;
    renderRunPanel();
    const ps = runPlanState();
    const after = saved.planStep ? ` ${ps.done ? "Plan terminé !" : `Prochaine séance : étape ${ps.suggested}.`}` : "";
    showToast(`Course enregistrée.${after}`);
  });
}
async function onRunNextDay(value) {
  const id = document.getElementById("run-next-day").dataset.id;
  const r = state.runs.find((x) => x.id === id);
  if (!r) return;
  await saveRun({ ...r, painNext: value });
  renderRunPanel();
  const ps = runPlanState();
  showToast(value > RUN_STOP_PAIN ? "Noté. Douleur forte le lendemain : on recule d'une étape, et parles-en à ton kiné ou ton médecin."
    : value > RUN_OK_PAIN ? "Noté : on répète l'étape la prochaine fois." : `Noté : genou OK.${ps.done ? "" : ` Prochaine séance : étape ${ps.suggested}.`}`);
}

function setupRun() {
  const panel = document.getElementById("run-panel");
  const launch = document.getElementById("run-launch");
  launch.elements.step.addEventListener("change", () => { document.getElementById("run-custom").hidden = launch.elements.step.value !== "custom"; });
  launch.elements.screenOff.checked = localGet("pp-run-screen-off", false) === true;
  launch.addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const v = launch.elements.step.value;
      let def, label, planStep = null;
      if (v === "custom") {
        const runMin = readNumber(launch, "runMin", { min: 0.25, max: 120, label: "Course (min)", required: true });
        const walkMin = readNumber(launch, "walkMin", { min: 0, max: 30, label: "Marche (min)" }) || 0;
        const reps = readNumber(launch, "reps", { min: 1, max: 30, decimals: 0, integer: true, label: "Répétitions", required: true });
        def = { reps, run: Math.round(runMin * 60), walk: Math.round(walkMin * 60) };
        label = `Personnalisée · ${reps} × ${fmtMinSec(def.run)}${def.walk ? ` / ${fmtMinSec(def.walk)}` : ""}`;
      } else {
        planStep = Number(v);
        def = runStepDef(planStep);
        label = `Étape ${planStep} · ${runStepText(planStep)}`;
      }
      localSet("pp-run-screen-off", launch.elements.screenOff.checked);
      startRunTimer({ phases: runPhases(def), label, planStep, screenOff: launch.elements.screenOff.checked });
    } catch (err) {
      showToast(humanError(err), "error");
    }
  });
  document.getElementById("run-add").addEventListener("click", () => openRunForm(null, { title: "Noter une course" }));
  document.getElementById("run-gpx").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new UserError("Fichier trop gros (20 Mo maximum).");
      await importGpxText(await file.text());
    } catch (err) { showToast(humanError(err), "error"); }
  });
  panel.addEventListener("click", (e) => {
    const nextBtn = e.target.closest("[data-run-next]");
    const edit = e.target.closest("[data-run-edit]");
    const del = e.target.closest("[data-run-delete]");
    if (nextBtn) withBusy(nextBtn, () => onRunNextDay(Number(nextBtn.dataset.runNext)));
    else if (edit) { const r = state.runs.find((x) => x.id === edit.dataset.runEdit); if (r) openRunForm(r, { title: "Modifier la course" }); }
    else if (del) {
      if (!confirm("Supprimer cette course ?")) return;
      withBusy(del, async () => { await deleteRecord(del.dataset.runDelete); await reloadRuns(); renderRunPanel(); showToast("Course supprimée."); });
    } else if (e.target.id === "run-more") { runListPage++; renderRunPanel(); }
  });
  const form = document.getElementById("run-form");
  form.addEventListener("submit", onRunSubmit);
  form.elements.planStep.addEventListener("change", () => { document.getElementById("run-completed-row").hidden = !form.elements.planStep.value; });
  document.getElementById("run-form-cancel").addEventListener("click", () => {
    if (runEditing && !runEditing.id && runEditing.source === "app" && !confirm("Ne pas enregistrer cette séance ?")) return;
    runEditing = null;
    document.getElementById("run-dialog").close();
  });
  document.getElementById("run-dialog").addEventListener("cancel", (e) => {
    if (runEditing && !runEditing.id && runEditing.source === "app") e.preventDefault();
  });
  setupRunTimer();
}
