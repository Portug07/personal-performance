"use strict";
/* ==========================================================================
   Synchronisation entre appareils (téléphone, PC) via Firebase, plan gratuit « Spark ».
   - Connexion : e-mail + mot de passe (Firebase Authentication, API REST). Le mot de passe n'est jamais
     enregistré : seul un jeton de renouvellement est gardé sur l'appareil.
   - Données : une fiche Firestore par entrée, dans users/{uid}/records/{id}, contenant l'entrée en JSON,
     sa date de modification (updatedAt) et l'heure du serveur (serverTime).
   - Règle : la modification la plus récente gagne. Les suppressions sont transmises.
   - Les photos restent sur l'appareil où elles ont été prises (trop lourdes).
   Aucune bibliothèque externe : uniquement fetch() vers les API Google.
   ========================================================================== */

const SYNC_PAGE = 300;        // fiches lues par requête
const SYNC_BATCH = 400;       // écritures par envoi (Firestore : 500 au maximum)
const SYNC_DEBOUNCE_MS = 2500;
const SYNC_OVERLAP_MS = 120000;   // marge de relecture à chaque réception

let syncAccount = null;       // { apiKey, projectId, email, uid, refreshToken, lastPull, lastSyncAt, initialized, typesVersion }
let syncIdToken = null;
let syncIdTokenExp = 0;
let syncRunning = null;
let syncAgain = false;
let syncTimer = null;
let syncRelogin = false;      // session expirée : formulaire réaffiché, sans rien oublier de ce qui attend l'envoi
const syncStatus = { state: "off", message: "" };

class SyncError extends UserError {
  constructor(message, { auth = false } = {}) { super(message); this.auth = auth; }
}

/* ---------- Configuration ---------- */

/* Accepte le bloc « const firebaseConfig = { apiKey: "…", projectId: "…", … } » copié depuis la console Firebase. */
function parseFirebaseConfig(text) {
  const t = String(text || "");
  const pick = (key) => {
    const m = t.match(new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`));
    return m ? m[1].trim() : "";
  };
  const apiKey = pick("apiKey"), projectId = pick("projectId");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(apiKey) || !/^[a-z0-9-]{4,40}$/.test(projectId)) return null;
  return { apiKey, projectId };
}

/* Version des types d'entrées connus (3.2 : repas habituels et recettes). Une version plus ancienne
   de l'app a pu ignorer ces fiches en les recevant : on relit alors tout Firebase une fois. */
const SYNC_TYPES_VERSION = 2;
async function loadSyncAccount() {
  syncAccount = await getSetting("syncAccount", null);
  syncTracking = Boolean(syncAccount && syncAccount.refreshToken);
  syncStatus.state = syncTracking ? "idle" : "off";
  if (syncTracking && (syncAccount.typesVersion || 1) < SYNC_TYPES_VERSION) {
    syncAccount.lastPull = null;
    syncAccount.typesVersion = SYNC_TYPES_VERSION;
    await saveSyncAccount();
  }
}
async function saveSyncAccount() { await setSetting("syncAccount", syncAccount); }

/* ---------- Appels réseau ---------- */

async function syncFetch(url, options, context) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new SyncError("Pas de connexion réseau : la synchro reprendra automatiquement.");
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = body && (Array.isArray(body) ? body[0] && body[0].error : body.error);
    const code = (err && (err.message || err.status)) || `HTTP ${res.status}`;
    throw new SyncError(syncErrorText(code, context, res.status), { auth: /TOKEN|USER_DISABLED|USER_NOT_FOUND|UNAUTHENTICATED/.test(code) || res.status === 401 });
  }
  return body;
}
function syncErrorText(code, context, status) {
  if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_EMAIL/.test(code)) return "E-mail ou mot de passe incorrect.";
  if (/TOO_MANY_ATTEMPTS/.test(code)) return "Trop d'essais : réessaie dans quelques minutes.";
  if (/USER_DISABLED/.test(code)) return "Ce compte est désactivé dans Firebase.";
  if (/API key not valid|API_KEY_INVALID/.test(code)) return "Configuration Firebase invalide : vérifie le bloc collé (apiKey).";
  if (/OPERATION_NOT_ALLOWED|CONFIGURATION_NOT_FOUND/.test(code)) return "Active la connexion « Adresse e-mail/Mot de passe » dans Firebase Authentication.";
  if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|UNAUTHENTICATED/.test(code) || status === 401) return "Ta session a expiré : reconnecte-toi pour reprendre la synchro.";
  if (/PERMISSION_DENIED/.test(code) || status === 403) return "Accès refusé par Firestore : vérifie les règles collées dans la console Firebase.";
  if (/NOT_FOUND/.test(code) || status === 404) return "Base Firestore introuvable : vérifie qu'elle est bien créée dans ton projet.";
  if (/RESOURCE_EXHAUSTED/.test(code) || status === 429) return "Quota gratuit du jour atteint : la synchro reprendra demain.";
  return `Erreur de synchronisation (${context} : ${code}).`;
}

/* ---------- Authentification ---------- */

async function firebaseSignIn(config, email, password) {
  return syncFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  }, "connexion");
}
/* Jeton d'accès valable environ 1 heure, renouvelé automatiquement grâce au jeton de renouvellement. */
async function ensureIdToken() {
  if (syncIdToken && Date.now() < syncIdTokenExp - 60000) return syncIdToken;
  const body = await syncFetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(syncAccount.apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(syncAccount.refreshToken)}`
  }, "session");
  syncIdToken = body.id_token;
  syncIdTokenExp = Date.now() + (Number(body.expires_in) || 3600) * 1000;
  if (body.refresh_token && body.refresh_token !== syncAccount.refreshToken) {
    syncAccount.refreshToken = body.refresh_token;
    await saveSyncAccount();
  }
  return syncIdToken;
}

/* ---------- Firestore (API REST) ---------- */

function fsRoot() { return `projects/${syncAccount.projectId}/databases/(default)/documents`; }
function fsUserPath() { return `${fsRoot()}/users/${syncAccount.uid}`; }
async function fsPost(path, payload, context) {
  const token = await ensureIdToken();
  return syncFetch(`https://firestore.googleapis.com/v1/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  }, context);
}
/* Identifiant local ↔ fiche Firestore : « setting:program » devient « setting-program ». */
const docIdFor = (id) => (id.startsWith("setting:") ? `setting-${id.slice(8)}` : id);
const SETTING_DOC_PREFIX = "setting-";

/* ---------- Envoi ---------- */

async function pushChanges() {
  const dirty = await getSetting("syncDirty", {});
  const ids = Object.keys(dirty);
  let sent = 0;
  for (let i = 0; i < ids.length; i += SYNC_BATCH) {
    const chunk = ids.slice(i, i + SYNC_BATCH);
    const writes = [];
    for (const id of chunk) {
      let data = "", updatedAt = Date.now(), deleted = false, kind = "";
      if (id.startsWith("setting:")) {
        const key = id.slice(8);
        data = JSON.stringify({ key, value: await getSetting(key, null) });
        updatedAt = await getSetting(`${key}UpdatedAt`, Date.now());
        kind = "setting";
      } else {
        const record = await getRecord(id);
        if (record) { data = JSON.stringify(record); updatedAt = record.updatedAt || Date.now(); kind = record.type; }
        else { deleted = true; updatedAt = parseInt(dirty[id], 10) || Date.now(); }   // supprimée sur cet appareil : on transmet la suppression
      }
      writes.push({
        update: {
          name: `${fsUserPath()}/records/${docIdFor(id)}`,
          fields: { data: { stringValue: data }, updatedAt: { integerValue: String(updatedAt) }, deleted: { booleanValue: deleted }, kind: { stringValue: kind } }
        },
        updateTransforms: [{ fieldPath: "serverTime", setToServerValue: "REQUEST_TIME" }]
      });
    }
    await fsPost(`${fsRoot()}:commit`, { writes }, "envoi");
    await clearDirty(Object.fromEntries(chunk.map((id) => [id, dirty[id]])));
    sent += chunk.length;
  }
  return sent;
}

/* ---------- Réception ---------- */

function decodeDoc(doc) {
  const f = doc.fields || {};
  return {
    name: doc.name,
    id: doc.name.split("/").pop(),
    data: f.data ? f.data.stringValue : "",
    updatedAt: Number(f.updatedAt && f.updatedAt.integerValue) || 0,
    deleted: Boolean(f.deleted && f.deleted.booleanValue),
    serverTime: f.serverTime ? f.serverTime.timestampValue : null
  };
}
async function applyRemoteDocs(docs) {
  const puts = [], deletes = [];
  let settingsChanged = 0;
  for (const d of docs) {
    if (d.id.startsWith(SETTING_DOC_PREFIX)) {
      const key = d.id.slice(SETTING_DOC_PREFIX.length);
      if (!SYNCED_SETTINGS.includes(key) || d.deleted) continue;
      if (d.updatedAt <= (await getSetting(`${key}UpdatedAt`, 0))) continue;
      let parsed = null;
      try { parsed = JSON.parse(d.data); } catch { continue; }
      const value = key === "program" ? normalizeProgram(parsed.value) : normalizeTargets(parsed.value || {});
      if (!value) continue;
      await setSettingFromSync(key, value, d.updatedAt);
      if (key === "program") state.program = value; else state.targets = value;
      settingsChanged++;
      continue;
    }
    if (d.deleted) { deletes.push({ id: d.id, updatedAt: d.updatedAt }); continue; }
    let raw = null;
    try { raw = JSON.parse(d.data); } catch { continue; }
    /* Tout ce qui arrive est contrôlé comme un import (normalizeRecord). */
    const normalized = normalizeRecord(raw);
    if (!normalized || normalized.record.id !== d.id) continue;
    normalized.record.updatedAt = d.updatedAt || normalized.record.updatedAt;
    if (raw.photoId) normalized.record.photoId = cleanId(raw.photoId);
    puts.push(normalized.record);
  }
  const changed = await applyRemoteRecords(puts, deletes);
  return { changed, settingsChanged };
}
/* Horodatage Firestore (« 2026-11-05T18:00:00.123456Z ») → millisecondes, quel que soit le navigateur. */
function isoMs(iso) {
  const m = /^(.{19})(\.\d+)?Z$/.exec(String(iso || ""));
  if (!m) return NaN;
  return Date.parse(`${m[1]}Z`) + (m[2] ? Math.floor(Number(m[2]) * 1000) : 0);
}
/* Clé de tri exacte (fraction de seconde complétée à 9 chiffres) : deux fiches écrites dans la même
   milliseconde restent dans le bon ordre. */
function isoKey(iso) {
  const m = /^(.{19})(?:\.(\d+))?Z$/.exec(String(iso || ""));
  return m ? `${m[1]}.${(m[2] || "").padEnd(9, "0")}` : "";
}
/* Reçoit, page par page, les fiches écrites dans Firebase depuis la dernière fois. Le curseur
   (heure serveur + nom de la fiche) reprend juste après la dernière fiche lue, même si un envoi
   groupé a donné la même heure à des centaines de fiches. Par prudence, la 1re page relit aussi
   les 2 minutes qui précèdent la dernière lecture : une écriture d'un autre appareil en cours à ce
   moment-là est ainsi rattrapée. Relire une fiche déjà reçue ne change rien. */
async function pullChanges() {
  let cursor = syncAccount.lastPull && syncAccount.lastPull.time ? { ...syncAccount.lastPull } : null;
  const total = { changed: 0, settingsChanged: 0 };
  for (let page = 0; page < 500; page++) {
    const structuredQuery = {
      from: [{ collectionId: "records" }],
      orderBy: [
        { field: { fieldPath: "serverTime" }, direction: "ASCENDING" },
        { field: { fieldPath: "__name__" }, direction: "ASCENDING" }
      ],
      limit: SYNC_PAGE
    };
    const overlapFrom = cursor && cursor.readTime ? isoMs(cursor.readTime) - SYNC_OVERLAP_MS : NaN;
    if (page === 0 && cursor && overlapFrom < isoMs(cursor.time)) {
      structuredQuery.startAt = { values: [{ timestampValue: new Date(overlapFrom).toISOString() }], before: true };
    } else if (cursor) {
      structuredQuery.startAt = { values: [{ timestampValue: cursor.time }, { referenceValue: cursor.name }], before: false };
    }
    const rows = (await fsPost(`${fsUserPath()}:runQuery`, { structuredQuery }, "réception")) || [];
    const readTime = (rows.find((r) => r.readTime) || {}).readTime || null;
    const docs = rows.filter((r) => r.document).map((r) => decodeDoc(r.document));
    if (docs.length) {
      const res = await applyRemoteDocs(docs);
      total.changed += res.changed;
      total.settingsChanged += res.settingsChanged;
      /* Le curseur n'avance que vers l'avant (la relecture peut renvoyer des fiches plus anciennes). */
      const last = docs[docs.length - 1];
      const lastKey = isoKey(last.serverTime), curKey = cursor ? isoKey(cursor.time) : "";
      if (lastKey && (!cursor || lastKey > curKey || (lastKey === curKey && last.name > cursor.name))) {
        cursor = { time: last.serverTime, name: last.name, readTime: cursor && cursor.readTime };
      }
    }
    /* L'heure de la 1re lecture sert de repère pour la marge de la prochaine fois. */
    if (page === 0 && cursor && readTime) cursor.readTime = readTime;
    if (cursor) { syncAccount.lastPull = cursor; await saveSyncAccount(); }
    if (docs.length < SYNC_PAGE) break;
  }
  return total;
}

/* ---------- Synchroniser ---------- */

function setSyncStatus(st, message = "") {
  syncStatus.state = st;
  syncStatus.message = message;
  if (document.getElementById("sync-panel")) renderSyncPanel();
}
function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!syncTracking) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow().catch(console.error); }, delay);
}
/* Appelée par db.js après chaque écriture locale. */
function onLocalChange() { scheduleSync(); }

async function syncNow({ manual = false } = {}) {
  if (!syncTracking || !syncAccount) return;
  if (!navigator.onLine) { setSyncStatus("idle", "Hors connexion : la synchro reprendra dès que le réseau revient."); return; }
  if (syncRunning) { syncAgain = true; return syncRunning; }
  syncRunning = (async () => {
    setSyncStatus("syncing");
    try {
      await ensureIdToken();
      if (!syncAccount.initialized) {
        /* Première synchro de cet appareil : tout ce qu'il contient part vers Firebase (fusion, rien n'est écrasé). */
        await markDirty([...(await getAllRecordIds()), ...SYNCED_SETTINGS.map((k) => `setting:${k}`)]);
        syncAccount.initialized = true;
        await saveSyncAccount();
      }
      const pulled = await pullChanges();
      await pushChanges();
      syncAccount.lastSyncAt = Date.now();
      await saveSyncAccount();
      setSyncStatus("ok");
      if (pulled.changed || pulled.settingsChanged) {
        await Promise.all([reloadWorkouts(), reloadMeals(), reloadMeasurements(), reloadWellbeing(), reloadBattery()]);
        /* Pas de rafraîchissement des Réglages en cours d'édition (programme, objectifs). */
        if (state.view !== "settings") renderView(state.view);
        if (manual || pulled.changed) showToast(`Synchro : ${plural(pulled.changed + pulled.settingsChanged, "changement reçu", "changements reçus")}.`);
      } else if (manual) {
        showToast("Synchro terminée : tout est à jour.");
      }
    } catch (err) {
      console.warn(err);
      setSyncStatus(err.auth ? "auth" : "error", err.message || String(err));
      if (manual) showToast(err.message || "Synchro impossible.", "error");
    } finally {
      syncRunning = null;
      if (syncAgain) { syncAgain = false; scheduleSync(500); }
    }
  })();
  return syncRunning;
}

async function connectSync(configText, email, password) {
  const config = parseFirebaseConfig(configText) || (syncAccount && syncAccount.apiKey ? { apiKey: syncAccount.apiKey, projectId: syncAccount.projectId } : null);
  if (!config) throw new UserError("Colle le bloc « firebaseConfig » copié depuis la console Firebase (il contient apiKey et projectId).");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new UserError("Indique l'e-mail du compte créé dans Firebase.");
  if (!password) throw new UserError("Indique le mot de passe du compte Firebase.");
  const body = await firebaseSignIn(config, email, password);
  const sameAccount = syncAccount && syncAccount.uid === body.localId && syncAccount.projectId === config.projectId;
  syncAccount = {
    apiKey: config.apiKey, projectId: config.projectId, email, uid: body.localId, refreshToken: body.refreshToken,
    lastPull: sameAccount ? syncAccount.lastPull : null, lastSyncAt: sameAccount ? syncAccount.lastSyncAt : null,
    initialized: sameAccount ? Boolean(syncAccount.initialized) : false, typesVersion: SYNC_TYPES_VERSION
  };
  syncIdToken = body.idToken;
  syncIdTokenExp = Date.now() + (Number(body.expiresIn) || 3600) * 1000;
  syncTracking = true;
  syncRelogin = false;
  await saveSyncAccount();
  setSyncStatus("idle");
  await syncNow({ manual: true });
}

/* Déconnexion : rien n'est effacé, ni sur cet appareil ni dans Firebase. La configuration et l'e-mail
   sont gardés pour te reconnecter avec le seul mot de passe. */
async function disconnectSync() {
  clearTimeout(syncTimer);
  syncTracking = false;
  syncRelogin = false;
  syncIdToken = null;
  if (syncAccount) {
    syncAccount = { apiKey: syncAccount.apiKey, projectId: syncAccount.projectId, email: syncAccount.email };
    await setSetting("syncAccount", syncAccount);
  }
  await setSetting("syncDirty", {});
  setSyncStatus("off");
}

/* ---------- Affichage (Réglages) ---------- */

function fmtAgo(ms) {
  if (!ms) return "jamais";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${fmtDate(isoDate(new Date(ms)))}`;
}
function renderSyncPanel() {
  const el = document.getElementById("sync-panel");
  if (!el) return;
  const connected = Boolean(syncTracking && syncAccount && !syncRelogin);
  document.getElementById("sync-connect-form").hidden = connected;
  document.getElementById("sync-connected").hidden = !connected;
  if (!connected) {
    const form = document.getElementById("sync-connect-form");
    const hasConfig = Boolean(syncAccount && syncAccount.apiKey);
    form.elements.config.placeholder = hasConfig ? `Configuration déjà enregistrée (projet ${syncAccount.projectId}) : laisse vide` : 'const firebaseConfig = { apiKey: "…", projectId: "…", … };';
    if (hasConfig && !form.elements.email.value) form.elements.email.value = syncAccount.email || "";
    return;
  }
  const labels = {
    syncing: "Synchronisation en cours…",
    ok: `À jour · dernière synchro ${fmtAgo(syncAccount.lastSyncAt)}`,
    idle: syncAccount.lastSyncAt ? `Dernière synchro ${fmtAgo(syncAccount.lastSyncAt)}` : "Première synchro en attente",
    error: "Synchro en pause",
    auth: "Reconnexion nécessaire"
  };
  document.getElementById("sync-account").textContent = `Connecté : ${syncAccount.email} (projet ${syncAccount.projectId})`;
  const status = document.getElementById("sync-status");
  status.textContent = labels[syncStatus.state] || labels.idle;
  status.className = `sync-status sync-${syncStatus.state}`;
  const msg = document.getElementById("sync-message");
  msg.textContent = syncStatus.message || "";
  msg.hidden = !syncStatus.message;
  document.getElementById("sync-relogin").hidden = syncStatus.state !== "auth";
}

function setupSync() {
  const form = document.getElementById("sync-connect-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      await connectSync(form.elements.config.value, form.elements.email.value.trim(), form.elements.password.value);
      form.elements.password.value = "";
      form.elements.config.value = "";
      renderSyncPanel();
    });
  });
  document.getElementById("sync-now").addEventListener("click", (e) => withBusy(e.currentTarget, () => syncNow({ manual: true })));
  document.getElementById("sync-disconnect").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!confirm("Déconnecter la synchronisation sur cet appareil ?\nRien n'est effacé : ni ici, ni dans Firebase.")) return;
    await disconnectSync();
    renderSyncPanel();
    showToast("Synchronisation déconnectée sur cet appareil.");
  }));
  /* Reconnexion : la synchro reste active (les changements en attente sont gardés), seul le mot de passe est redemandé. */
  document.getElementById("sync-relogin").addEventListener("click", () => {
    syncRelogin = true;
    renderSyncPanel();
    document.getElementById("sync-connect-form").elements.password.focus();
  });
  /* Déclencheurs automatiques : retour du réseau, retour sur l'app. */
  window.addEventListener("online", () => scheduleSync(1000));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && syncTracking && (!syncAccount.lastSyncAt || Date.now() - syncAccount.lastSyncAt > 60000)) scheduleSync(500);
  });
  renderSyncPanel();
}
function startSync() {
  if (syncTracking) syncNow().catch(console.error);
}
