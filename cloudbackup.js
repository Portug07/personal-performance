"use strict";
/* ==========================================================================
   Copies de sécurité automatiques dans ton Firebase (si la synchro est active).
   Une copie complète par semaine (sans les photos), compressée ; les 8 dernières sont gardées.
   Elles protègent contre une erreur qui se propagerait par la synchro (suppression, mauvais import).
   Rangement : users/{uid}/backupIndex/{id} (fiche résumé) + users/{uid}/backups/{id}-{n} (morceaux).
   ========================================================================== */

const CLOUD_BACKUP_KEEP = 8;
const CLOUD_BACKUP_EVERY_DAYS = 7;
const CLOUD_BACKUP_CHUNK = 700000;     // caractères par morceau (une fiche Firestore fait 1 Mo au plus)
const CLOUD_BACKUP_CHECK_KEY = "pp-cloud-backup-check";
let cloudBackupRunning = null;

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function compressText(text) {
  if (typeof CompressionStream === "undefined") return { encoding: "json", data: text };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { encoding: "gzip-base64", data: bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer())) };
}
async function decompressText(encoding, data) {
  if (encoding === "json") return data;
  if (typeof DecompressionStream === "undefined") throw new UserError("Ce navigateur ne sait pas lire les copies compressées : essaie depuis un autre appareil.");
  const stream = new Blob([base64ToBytes(data)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
async function fsGetDoc(path, context) {
  const token = await ensureIdToken();
  return syncFetch(`https://firestore.googleapis.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } }, context);
}
function fsInt(v) { return { integerValue: String(Math.round(Number(v) || 0)) }; }
function fsStr(v) { return { stringValue: String(v ?? "") }; }
function fieldVal(f) { return f ? (f.stringValue ?? (f.integerValue !== undefined ? Number(f.integerValue) : null)) : null; }

/* Liste des copies (plus récente d'abord). */
async function listCloudBackups() {
  const rows = (await fsPost(`${fsUserPath()}:runQuery`, { structuredQuery: {
    from: [{ collectionId: "backupIndex" }], orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit: 50
  } }, "copies de sécurité")) || [];
  return rows.filter((r) => r.document).map((r) => {
    const f = r.document.fields || {};
    return {
      name: r.document.name, id: fieldVal(f.backupId), createdAt: fieldVal(f.createdAt), parts: fieldVal(f.parts),
      records: fieldVal(f.records), appVersion: fieldVal(f.appVersion), encoding: fieldVal(f.encoding), device: fieldVal(f.device)
    };
  }).filter((b) => b.id && b.parts > 0);
}
function deviceLabel() { return /Android|iPhone|iPad/i.test(navigator.userAgent) ? "téléphone" : "ordinateur"; }

async function createCloudBackup() {
  const { blob, count } = await buildBackupBlob({ includePhotos: false });
  const packed = await compressText(await blob.text());
  const id = `${today()}-${Math.random().toString(36).slice(2, 8)}`;
  const parts = [];
  for (let i = 0; i < packed.data.length; i += CLOUD_BACKUP_CHUNK) parts.push(packed.data.slice(i, i + CLOUD_BACKUP_CHUNK));
  if (!parts.length) parts.push("");
  /* Morceaux d'abord, fiche résumé ensuite : une copie interrompue n'apparaît jamais dans la liste. */
  for (let i = 0; i < parts.length; i += 8) {
    const writes = parts.slice(i, i + 8).map((data, k) => ({ update: { name: `${fsUserPath()}/backups/${id}-${i + k}`, fields: { backupId: fsStr(id), part: fsInt(i + k), data: fsStr(data) } } }));
    await fsPost(`${fsRoot()}:commit`, { writes }, "copie de sécurité");
  }
  await fsPost(`${fsRoot()}:commit`, { writes: [{ update: { name: `${fsUserPath()}/backupIndex/${id}`, fields: {
    backupId: fsStr(id), createdAt: fsInt(Date.now()), parts: fsInt(parts.length), records: fsInt(count),
    appVersion: fsStr(APP_VERSION), encoding: fsStr(packed.encoding), device: fsStr(deviceLabel())
  } } }] }, "copie de sécurité");
  await pruneCloudBackups();
  return { id, records: count, parts: parts.length };
}
async function deleteCloudBackup(b) {
  const writes = [{ delete: `${fsUserPath()}/backupIndex/${b.id}` }];
  for (let i = 0; i < b.parts; i++) writes.push({ delete: `${fsUserPath()}/backups/${b.id}-${i}` });
  await fsPost(`${fsRoot()}:commit`, { writes }, "copies de sécurité");
}
async function pruneCloudBackups() {
  const list = await listCloudBackups();
  for (const b of list.slice(CLOUD_BACKUP_KEEP)) await deleteCloudBackup(b);
}
/* Après une synchro réussie : une fois par jour au plus, on vérifie qu'une copie de moins de 7 jours existe. */
async function maybeCloudBackup() {
  if (!syncTracking || !syncAccount || !navigator.onLine || cloudBackupRunning) return null;
  if (localGet(CLOUD_BACKUP_CHECK_KEY) === today()) return null;
  cloudBackupRunning = (async () => {
    try {
      const list = await listCloudBackups();
      const latest = list[0];
      localSet(CLOUD_BACKUP_CHECK_KEY, today());
      if (latest && Date.now() - latest.createdAt < CLOUD_BACKUP_EVERY_DAYS * 86400000) return null;
      return await createCloudBackup();
    } catch (err) {
      console.warn("Copie de sécurité non faite", err);
      return null;
    } finally {
      cloudBackupRunning = null;
    }
  })();
  return cloudBackupRunning;
}
async function fetchCloudBackupText(b) {
  const parts = [];
  for (let i = 0; i < b.parts; i++) {
    const doc = await fsGetDoc(`${fsUserPath()}/backups/${b.id}-${i}`, "copie de sécurité");
    parts.push(fieldVal((doc.fields || {}).data) || "");
  }
  return decompressText(b.encoding || "gzip-base64", parts.join(""));
}

/* ---------- Affichage (Réglages → Synchronisation) ---------- */

let cloudBackupList = [];
async function renderCloudBackups() {
  const el = document.getElementById("cloud-backup-list");
  el.innerHTML = `<p class="hint">Chargement…</p>`;
  try {
    cloudBackupList = await listCloudBackups();
  } catch (err) {
    el.innerHTML = `<p class="danger-text">${esc(err.message || "Liste indisponible.")}</p>`;
    return;
  }
  el.innerHTML = cloudBackupList.length
    ? cloudBackupList.map((b, i) => `<div class="backup-item">
        <span><b>${esc(new Date(b.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }))}</b>
        <small>${plural(b.records || 0, "entrée")} · depuis ton ${esc(b.device || "appareil")} · version ${esc(b.appVersion || "?")}</small></span>
        <span class="gap-actions">
          <button type="button" class="small-button" data-cloud-restore="${i}" data-mode="merge">Fusionner</button>
          <button type="button" class="small-button danger-text" data-cloud-restore="${i}" data-mode="replace">Remplacer</button>
        </span>
      </div>`).join("")
    : `<p class="hint">Pas encore de copie : la première est faite automatiquement à la prochaine synchro (ou bouton ci-dessous).</p>`;
}
function setupCloudBackups() {
  document.getElementById("cloud-backup-show").addEventListener("click", renderCloudBackups);
  document.getElementById("cloud-backup-now").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!syncTracking) throw new UserError("Connecte d'abord la synchronisation.");
    const res = await createCloudBackup();
    localSet(CLOUD_BACKUP_CHECK_KEY, today());
    showToast(`Copie de sécurité faite : ${plural(res.records, "entrée")}.`);
    await renderCloudBackups();
  }));
  document.getElementById("cloud-backup-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cloud-restore]");
    if (!b) return;
    withBusy(b, async () => {
      const backup = cloudBackupList[Number(b.dataset.cloudRestore)];
      const text = await fetchCloudBackupText(backup);
      /* Même chemin qu'un fichier de sauvegarde : vérification, confirmation, copie avant remplacement. */
      await importBackup(new Blob([text], { type: "application/json" }), b.dataset.mode);
    });
  });
}
