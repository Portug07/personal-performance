"use strict";
/* ==========================================================================
   Import automatique des courses depuis Strava (facultatif, gratuit).
   Tu crées une fois ta propre « application API » sur strava.com/settings/api ; l'app garde sur
   l'appareil l'ID client, le secret et les clés d'accès (jamais synchronisés, jamais dans le code).
   À l'ouverture (au plus toutes les 30 min), les nouvelles sorties « Course » arrivent dans le journal.
   Si Strava refuse l'appel direct depuis le navigateur, l'import de fichier GPX reste possible.
   ========================================================================== */

const STRAVA_KEY = "strava";                    // réglage local (non synchronisé)
const STRAVA_STATE_KEY = "pp-strava-state";
const STRAVA_GAP_MS = 30 * 60000;
const STRAVA_FIRST_DAYS = 60;
const STRAVA_RUN_TYPES = ["Run", "TrailRun", "VirtualRun"];
let strava = null;                              // { clientId, clientSecret, accessToken, refreshToken, expiresAt, athlete, lastImportAt, lastActivityTime, needsLogin }
let stravaRunning = null;

async function loadStrava() { strava = await getSetting(STRAVA_KEY, null); }
async function saveStrava() { await setSetting(STRAVA_KEY, strava); }
function stravaConnected() { return Boolean(strava && strava.refreshToken); }
function stravaRedirectUri() { return location.origin + location.pathname; }

async function stravaFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new UserError(navigator.onLine
      ? "Strava ne répond pas à l'app (connexion directe refusée par le navigateur ou service indisponible). En attendant, importe tes courses en fichier GPX."
      : "Pas de connexion réseau : l'import Strava reprendra plus tard.");
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.status === 401) {
    if (strava) { strava.needsLogin = true; await saveStrava(); renderStravaPanel(); }
    throw new UserError("Strava demande de te reconnecter (accès expiré ou retiré).");
  }
  if (res.status === 429) throw new UserError("Strava : trop de demandes pour le moment, réessaie dans 15 minutes.");
  if (!res.ok) {
    const msg = body && (body.message || (body.errors && body.errors[0] && `${body.errors[0].field} ${body.errors[0].code}`));
    throw new UserError(`Strava a refusé la demande${msg ? ` (${String(msg).slice(0, 80)})` : ""}. Vérifie l'ID client et le secret.`);
  }
  return body;
}
/* Échange du code ou renouvellement : requête « simple » (formulaire), sans en-tête spécial. */
async function stravaToken(params) {
  const body = new URLSearchParams({ client_id: strava.clientId, client_secret: strava.clientSecret, ...params });
  const t = await stravaFetch("https://www.strava.com/oauth/token", { method: "POST", body });
  if (!t || !t.access_token || !t.refresh_token) throw new UserError("Réponse inattendue de Strava.");
  strava.accessToken = t.access_token;
  strava.refreshToken = t.refresh_token;
  strava.expiresAt = Number(t.expires_at) || Math.floor(Date.now() / 1000) + 3600;
  if (t.athlete) strava.athlete = cleanText(`${t.athlete.firstname || ""} ${t.athlete.lastname || ""}`, 80);
  strava.needsLogin = false;
  await saveStrava();
}
async function stravaAccessToken() {
  if (!stravaConnected()) throw new UserError("Strava n'est pas connecté.");
  if (strava.accessToken && strava.expiresAt * 1000 - 120000 > Date.now()) return strava.accessToken;
  await stravaToken({ grant_type: "refresh_token", refresh_token: strava.refreshToken });
  return strava.accessToken;
}

/* ---------- Connexion (aller-retour par la page Strava) ---------- */

function stravaAuthorizeUrl() {
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localSet(STRAVA_STATE_KEY, st);
  const p = new URLSearchParams({
    client_id: strava.clientId, redirect_uri: stravaRedirectUri(), response_type: "code",
    approval_prompt: "auto", scope: "read,activity:read_all", state: st
  });
  /* Sur téléphone, la page « mobile » ouvre l'app Strava si elle est installée. */
  return `https://www.strava.com/oauth/${/Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile/" : ""}authorize?${p}`;
}
/* Retour de Strava : ?state=…&code=…&scope=… (ou ?error=access_denied). */
async function handleStravaRedirect() {
  const q = new URLSearchParams(location.search);
  const st = q.get("state");
  if (!st || (!q.has("code") && !q.has("error"))) return;
  const expected = localGet(STRAVA_STATE_KEY);
  history.replaceState(null, "", location.pathname + "?view=settings");
  if (!expected || st !== expected || !strava || !strava.clientId) return;
  localRemove(STRAVA_STATE_KEY);
  if (q.get("error")) { showToast("Connexion Strava annulée.", "error"); return; }
  if (!/activity:read/.test(q.get("scope") || "")) {
    showToast("Strava : coche l'accès à tes activités (« Voir les données de vos activités »), sinon l'app ne peut rien importer.", "error");
    return;
  }
  try {
    await stravaToken({ code: q.get("code"), grant_type: "authorization_code" });
    renderStravaPanel();
    showToast(`Strava connecté${strava.athlete ? ` : ${strava.athlete}` : ""}. Import de tes courses…`);
    await stravaImport({ manual: true });
  } catch (err) {
    showToast(humanError(err), "error");
  }
}

/* ---------- Import ---------- */

function stravaActivityToRun(a) {
  const local = String(a.start_date_local || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return null;
  return {
    id: `strava-${a.id}`, source: "strava", stravaId: String(a.id), date: local.slice(0, 10), startTime: local.slice(11, 16),
    name: cleanText(a.name, 120) || "Course", durationS: Math.round(Number(a.moving_time) || Number(a.elapsed_time) || 0) || null,
    distanceKm: a.distance ? round(Number(a.distance) / 1000, 2) : null, elevationM: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
    avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null
  };
}
async function stravaImport({ manual = false } = {}) {
  if (stravaRunning) return stravaRunning;
  stravaRunning = (async () => {
    try {
      const token = await stravaAccessToken();
      const nowS = Math.floor(Date.now() / 1000);
      /* 2 jours de recouvrement : une sortie envoyée en retard sur Strava est quand même prise. */
      const after = strava.lastActivityTime ? strava.lastActivityTime - 2 * 86400 : nowS - STRAVA_FIRST_DAYS * 86400;
      const acts = [];
      for (let page = 1; page <= 5; page++) {
        const list = await stravaFetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!Array.isArray(list) || !list.length) break;
        acts.push(...list);
        if (list.length < 100) break;
      }
      const runs = acts.filter((a) => STRAVA_RUN_TYPES.includes(a.sport_type) || STRAVA_RUN_TYPES.includes(a.type)).map(stravaActivityToRun).filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      await reloadRuns();
      const count = { new: 0, merged: 0, known: 0, invalid: 0 };
      for (const r of runs) count[await mergeImportedRun(r)]++;
      const times = acts.map((a) => Date.parse(a.start_date)).filter(Number.isFinite);
      if (times.length) strava.lastActivityTime = Math.max(strava.lastActivityTime || 0, Math.floor(Math.max(...times) / 1000));
      strava.lastImportAt = Date.now();
      await saveStrava();
      await reloadRuns();
      if (state.view === "training") renderRunPanel();
      renderStravaPanel();
      const added = count.new + count.merged;
      if (added || manual) showToast(added ? `Strava : ${plural(added, "course importée", "courses importées")}.` : "Strava : rien de nouveau.");
      return count;
    } finally {
      stravaRunning = null;
    }
  })();
  return stravaRunning;
}
/* À l'ouverture et au retour sur l'app : au plus toutes les 30 min, sans message si rien de neuf. */
function maybeStravaImport() {
  if (!stravaConnected() || strava.needsLogin || !navigator.onLine) return;
  if (strava.lastImportAt && Date.now() - strava.lastImportAt < STRAVA_GAP_MS) return;
  stravaImport().catch((err) => console.warn("Import Strava", err));
}

/* ---------- Réglages ---------- */

function renderStravaPanel() {
  const connected = stravaConnected();
  document.getElementById("strava-setup").hidden = connected && !strava.needsLogin;
  document.getElementById("strava-connected").hidden = !connected;
  document.getElementById("strava-domain").textContent = location.hostname || "ton-site.github.io";
  const form = document.getElementById("strava-form");
  if (strava && strava.clientId && !form.elements.clientId.value) form.elements.clientId.value = strava.clientId;
  if (!connected) return;
  const last = strava.lastImportAt ? new Date(strava.lastImportAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais";
  document.getElementById("strava-status").textContent = strava.needsLogin
    ? "Accès Strava expiré : reconnecte-toi avec le bouton ci-dessus."
    : `Connecté${strava.athlete ? ` (${strava.athlete})` : ""}. Dernier import : ${last}.`;
}
function setupStrava() {
  document.getElementById("strava-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      const clientId = form.elements.clientId.value.trim();
      const secret = form.elements.clientSecret.value.trim() || (strava && strava.clientSecret) || "";
      if (!/^\d{1,12}$/.test(clientId)) throw new UserError("ID client : un nombre (page strava.com/settings/api).");
      if (!/^[0-9a-f]{20,80}$/i.test(secret)) throw new UserError("Secret client : la longue suite de chiffres et de lettres de la même page (« Afficher »).");
      strava = { ...(strava || {}), clientId, clientSecret: secret };
      saveStrava().then(() => { location.href = stravaAuthorizeUrl(); }).catch((err) => showToast(humanError(err), "error"));
    } catch (err) {
      showToast(humanError(err), "error");
    }
  });
  document.getElementById("strava-import").addEventListener("click", (e) => withBusy(e.currentTarget, () => stravaImport({ manual: true })));
  document.getElementById("strava-disconnect").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!confirm("Déconnecter Strava sur cet appareil ? Les courses déjà importées restent dans ton journal.")) return;
    if (strava && strava.accessToken) {
      /* On retire aussi l'autorisation chez Strava (sans bloquer si le réseau manque). */
      fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", body: new URLSearchParams({ access_token: strava.accessToken }) }).catch(() => {});
    }
    strava = strava ? { clientId: strava.clientId } : null;
    await saveStrava();
    renderStravaPanel();
    showToast("Strava déconnecté.");
  }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") maybeStravaImport(); });
  window.addEventListener("online", maybeStravaImport);
}
