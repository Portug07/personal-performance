"use strict";
/* ==========================================================================
   Minuteur de course guidé : écran noir, grosses indications, bips (dans les écouteurs, Bluetooth
   compris) et vibrations à chaque changement course / marche.
   Les bips sont programmés à l'avance sur l'horloge audio : ils tombent juste même si le téléphone
   ralentit l'app. Mode « écran éteint » : un son continu presque inaudible garde l'app active
   écran verrouillé (selon le téléphone, la musique peut alors se mettre en pause).
   ========================================================================== */

const RT_KEY = "pp-run-timer";
const RT_MAX_AGE_MS = 4 * 3600 * 1000;
let rt = null;            // séance en cours
let rtAudio = null;
let rtWakeLock = null;

function rtCtx() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!rtAudio) rtAudio = new AC();
    if (rtAudio.state === "suspended") rtAudio.resume().catch(() => {});
    return rtAudio;
  } catch { return null; }
}
function rtElapsed() {
  if (!rt) return 0;
  return rt.pausedElapsed !== null ? rt.pausedElapsed : (Date.now() - rt.startWall) / 1000;
}
function rtPhaseAt(elapsed) {
  let acc = 0;
  for (let i = 0; i < rt.phases.length; i++) {
    if (elapsed < acc + rt.phases[i].s) return { i, start: acc, end: acc + rt.phases[i].s };
    acc += rt.phases[i].s;
  }
  return { i: rt.phases.length, start: acc, end: acc };
}
function rtPhaseStart(i) { return rt.phases.slice(0, i).reduce((a, p) => a + p.s, 0); }

/* ---------- Sons ---------- */

function rtTone(freq, at, dur, gain = 0.45) {
  const ctx = rtAudio;
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.015);
  g.gain.setValueAtTime(gain, at + Math.max(0.02, dur - 0.03));
  g.gain.linearRampToValueAtTime(0, at + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(at); osc.stop(at + dur + 0.02);
  rt.nodes.push(osc);
}
/* Course : 2 bips aigus. Marche : 1 bip grave et long. Fin : 3 notes qui montent. */
function rtPhaseSound(kind, at) {
  if (kind === "run") { rtTone(988, at, 0.22); rtTone(988, at + 0.32, 0.22); }
  else if (kind === "walk") rtTone(523, at, 0.6);
  else { rtTone(523, at, 0.2); rtTone(659, at + 0.25, 0.2); rtTone(784, at + 0.5, 0.45); }
}
function rtCancelSounds() {
  (rt?.nodes || []).forEach((n) => { try { n.stop(); } catch { /* déjà arrêté */ } });
  if (rt) rt.nodes = [];
}
/* Programme tous les bips à venir (changements de phase, décompte 3-2-1, fin). */
function rtSchedule() {
  rtCancelSounds();
  const ctx = rtAudio;
  if (!ctx || rt.pausedElapsed !== null) return;
  const now = rtElapsed();
  const base = ctx.currentTime - now;
  let acc = 0;
  rt.phases.forEach((p, i) => {
    if (i > 0 && acc > now + 0.05) {
      rtPhaseSound(p.kind, base + acc);
      [3, 2, 1].forEach((k) => { if (acc - k > now + 0.05 && rt.phases[i - 1].s > 6) rtTone(740, base + acc - k, 0.08, 0.3); });
    }
    acc += p.s;
  });
  if (acc > now + 0.05) {
    [3, 2, 1].forEach((k) => { if (acc - k > now + 0.05) rtTone(740, base + acc - k, 0.08, 0.3); });
    rtPhaseSound("end", base + acc);
  }
}
function rtKeepAlive(on) {
  if (on && !rt.keep && rtAudio) {
    const osc = rtAudio.createOscillator();
    const g = rtAudio.createGain();
    osc.frequency.value = 150;
    g.gain.value = 0.002;          // presque inaudible, mais compté comme « son en cours »
    osc.connect(g); g.connect(rtAudio.destination);
    osc.start();
    rt.keep = osc;
  } else if (!on && rt && rt.keep) {
    try { rt.keep.stop(); } catch { /* déjà arrêté */ }
    rt.keep = null;
  }
}
async function rtScreen(on) {
  try {
    if (on && !rtWakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      rtWakeLock = await navigator.wakeLock.request("screen");
      rtWakeLock.addEventListener("release", () => { rtWakeLock = null; });
    } else if (!on && rtWakeLock) {
      await rtWakeLock.release();
      rtWakeLock = null;
    }
  } catch { /* écran : réglage du téléphone */ }
}
function rtVibrate(kind) {
  if (!navigator.vibrate) return;
  navigator.vibrate(kind === "run" ? [350, 150, 350] : kind === "walk" ? [800] : [200, 100, 200, 100, 600]);
}

/* ---------- Écran ---------- */

function rtSave() {
  if (!rt) return;
  localSet(RT_KEY, { phases: rt.phases, label: rt.label, planStep: rt.planStep, screenOff: rt.screenOff, startWall: rt.startWall,
    pausedElapsed: rt.pausedElapsed, date: rt.date, startTime: rt.startTime, savedAt: Date.now() });
}
function rtRender() {
  const el = rtElapsed();
  const ph = rtPhaseAt(el);
  const p = rt.phases[ph.i];
  if (!p) return;
  const left = Math.max(0, ph.end - el);
  const dlg = document.getElementById("run-timer");
  dlg.classList.toggle("rt-is-run", p.kind === "run");
  dlg.classList.toggle("rt-is-paused", rt.pausedElapsed !== null);
  document.getElementById("rt-step").textContent = rt.label;
  document.getElementById("rt-total").textContent = `reste ${fmtRunDuration(Math.ceil(rt.total - el)) || "0:00"}`;
  document.getElementById("rt-phase").textContent = rt.pausedElapsed !== null ? "PAUSE" : p.kind === "run" ? "COURS" : "MARCHE";
  document.getElementById("rt-label").textContent = p.label;
  document.getElementById("rt-time").textContent = fmtDuration(Math.ceil(left));
  document.getElementById("rt-bar").style.width = `${Math.min(100, ((el - ph.start) / p.s) * 100)}%`;
  const n = rt.phases[ph.i + 1];
  document.getElementById("rt-next").textContent = n ? `Ensuite : ${n.kind === "run" ? "course" : "marche"} ${fmtDuration(n.s)}` : "Dernière phase";
  document.getElementById("rt-pause").textContent = rt.pausedElapsed !== null ? "Reprendre" : "Pause";
}
function rtTick() {
  if (!rt) return;
  const el = rtElapsed();
  if (el >= rt.total) { finishRunTimer(true); return; }
  const ph = rtPhaseAt(el);
  if (ph.i !== rt.lastIndex) {
    if (rt.lastIndex !== -1 && rt.pausedElapsed === null) rtVibrate(rt.phases[ph.i].kind);
    rt.lastIndex = ph.i;
    rtSave();
  }
  rtRender();
}

/* ---------- Commandes ---------- */

function startRunTimer({ phases, label, planStep = null, screenOff = false, startWall = null, pausedElapsed = null, date = null, startTime = null }) {
  if (rt) finishRunTimer(false, { silent: true });
  const now = new Date();
  rt = {
    phases, label, planStep, screenOff, total: phasesTotal(phases), nodes: [], keep: null, lastIndex: -1,
    startWall: startWall || Date.now(), pausedElapsed, date: date || today(),
    startTime: startTime || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  };
  rtCtx();
  if (!startWall && rtAudio) rtPhaseSound(phases[0].kind, rtAudio.currentTime + 0.05);
  rtSchedule();
  if (screenOff) rtKeepAlive(true);
  rtScreen(true);
  rt.lastIndex = rtPhaseAt(rtElapsed()).i;
  if (!startWall) rtVibrate(phases[0].kind);
  rtSave();
  document.getElementById("run-timer").showModal();
  document.getElementById("rt-hint").textContent = screenOff
    ? "Mode écran éteint : tu peux verrouiller le téléphone, les bips continuent."
    : "Écran noir allumé : ta musique continue, les bips passent par-dessus. Verrouiller l'écran peut couper les bips.";
  rtRender();
  rt.interval = setInterval(rtTick, 250);
  renderRunResume();
}
function rtPause() {
  if (!rt) return;
  if (rt.pausedElapsed === null) {
    rt.pausedElapsed = rtElapsed();
    rtCancelSounds();
  } else {
    rtCtx();
    rt.startWall = Date.now() - rt.pausedElapsed * 1000;
    rt.pausedElapsed = null;
    rtSchedule();
  }
  rtSave();
  rtRender();
}
function rtSkip() {
  if (!rt) return;
  const ph = rtPhaseAt(rtElapsed());
  const target = rtPhaseStart(ph.i + 1);
  if (target >= rt.total) { finishRunTimer(true); return; }
  if (rt.pausedElapsed !== null) rt.pausedElapsed = target;
  else {
    rt.startWall = Date.now() - target * 1000;
    rtSchedule();
    if (rtAudio) rtPhaseSound(rt.phases[ph.i + 1].kind, rtAudio.currentTime + 0.05);
    rtVibrate(rt.phases[ph.i + 1].kind);
  }
  rt.lastIndex = ph.i + 1;
  rtSave();
  rtRender();
}
/* Fin : ouvre le bilan (durée, temps couru, douleur) ; « completed » = séance faite en entier. */
function finishRunTimer(completed, { pain = false, silent = false } = {}) {
  if (!rt) return;
  const el = Math.min(rtElapsed(), rt.total);
  clearInterval(rt.interval);
  if (!completed) rtCancelSounds();
  rtKeepAlive(false);
  rtScreen(false);
  if (completed) rtVibrate("end");
  const done = rt;
  rt = null;
  localRemove(RT_KEY);
  const dlg = document.getElementById("run-timer");
  if (dlg.open) dlg.close();
  renderRunResume();
  if (silent) return;
  let runS = 0, acc = 0;
  done.phases.forEach((p) => { if (p.kind === "run") runS += Math.max(0, Math.min(p.s, el - acc)); acc += p.s; });
  openRunForm({
    date: done.date, startTime: done.startTime, durationS: Math.round(el), runS: Math.round(runS), planStep: done.planStep,
    completed: completed && el >= done.total - 1, source: "app", name: done.planStep ? null : done.label
  }, { title: pain ? "Bilan : arrêt pour douleur" : completed ? "Bravo ! Bilan de la séance" : "Bilan de la séance" });
  if (pain) document.querySelector("#run-form [name=painDuring]").focus();
}
/* Séance chronométrée interrompue (app fermée) : on peut la reprendre pendant 4 h. */
function savedRunTimer() {
  const s = localGet(RT_KEY);
  return s && Array.isArray(s.phases) && s.phases.length && Date.now() - (s.savedAt || 0) < RT_MAX_AGE_MS ? s : null;
}
function renderRunResume() {
  const box = document.getElementById("run-resume");
  if (!box) return;
  const s = !rt && savedRunTimer();
  box.hidden = !s;
  if (s) box.innerHTML = `<p><b>Course en cours</b> : ${esc(s.label)}</p>
    <div class="button-row"><button type="button" class="primary-button" id="run-resume-go">Reprendre</button>
    <button type="button" class="secondary-button" id="run-resume-end">Terminer et noter</button></div>`;
}

function setupRunTimer() {
  const dlg = document.getElementById("run-timer");
  dlg.addEventListener("cancel", (e) => e.preventDefault());       // pas de sortie par erreur (bouton retour)
  document.getElementById("rt-pause").addEventListener("click", rtPause);
  document.getElementById("rt-skip").addEventListener("click", rtSkip);
  document.getElementById("rt-pain").addEventListener("click", () => finishRunTimer(false, { pain: true }));
  document.getElementById("rt-stop").addEventListener("click", () => {
    if (rtElapsed() < rt.total - 1 && !confirm("Terminer la séance maintenant ?")) return;
    finishRunTimer(rtElapsed() >= rt.total - 1);
  });
  document.getElementById("run-resume").addEventListener("click", (e) => {
    const s = savedRunTimer();
    if (!s) { renderRunResume(); return; }
    if (e.target.id === "run-resume-go") startRunTimer(s);
    else if (e.target.id === "run-resume-end") { startRunTimer(s); finishRunTimer(false); }
  });
  document.addEventListener("visibilitychange", () => {
    if (!rt || document.visibilityState !== "visible") return;
    rtCtx();
    rtScreen(true);
    rtSchedule();       // recale les bips sur l'horloge réelle
    rtTick();
  });
}
