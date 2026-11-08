"use strict";
/* ==========================================================================
   Base de données locale (IndexedDB).
   - « records »  : séances, repas, mesures, check-ins (index par type et date)
   - « photos »   : photos des repas, rangées à part et chargées à la demande (audit C1)
   - « settings » : programme, objectifs, date de dernière sauvegarde…
   Une écriture n'est annoncée réussie qu'une fois réellement enregistrée (audit I5).
   ========================================================================== */

const DB_NAME = "personal-performance-db";
const DB_VERSION = 2;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const tx = request.transaction;
      const records = database.objectStoreNames.contains("records")
        ? tx.objectStore("records")
        : database.createObjectStore("records", { keyPath: "id" });
      if (!records.indexNames.contains("type")) records.createIndex("type", "type");
      if (!records.indexNames.contains("type_date")) records.createIndex("type_date", ["type", "date"]);
      if (!database.objectStoreNames.contains("photos")) database.createObjectStore("photos", { keyPath: "id" });
      if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings", { keyPath: "key" });
      if (event.oldVersion >= 1 && event.oldVersion < 2) migrateV1toV2(tx);
    };
    request.onblocked = () => showToast("Ferme les autres onglets de l'application pour terminer la mise à jour.", "error");
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        showUpdateBanner("Une nouvelle version de la base est active dans un autre onglet.", () => location.reload());
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });
}

/* Version 1 → 2 : les photos quittent les repas pour leur propre magasin. Aucune donnée n'est supprimée. */
function migrateV1toV2(tx) {
  const records = tx.objectStore("records");
  const photos = tx.objectStore("photos");
  records.openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;
    const r = cursor.value;
    let changed = false;
    if (!r.updatedAt) { r.updatedAt = r.createdAt || Date.now(); changed = true; }
    if (r.type === "meal" && "photo" in r) {
      if (typeof r.photo === "string" && r.photo.startsWith("data:image/")) {
        try {
          const id = uid();
          photos.put({ id, mealId: r.id, blob: dataURLToBlob(r.photo), createdAt: r.createdAt || Date.now() });
          r.photoId = id;
        } catch (err) { console.warn("Photo illisible ignorée", err); }
      }
      delete r.photo;
      changed = true;
    }
    if (changed) cursor.update(r);
    cursor.continue();
  };
}

/* ---------- Primitives ---------- */

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction annulée"));
  });
}
function reqResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function writeTx(stores) {
  return db.transaction(stores, "readwrite", { durability: "strict" });
}

/* ---------- Suivi des changements pour la synchronisation (sync.js) ----------
   Quand la synchro est active, chaque écriture note l'identifiant modifié dans « syncDirty »,
   dans la même transaction : rien ne peut être oublié, même si l'app se ferme juste après. */
let syncTracking = false;
function withSyncStore(stores) {
  const list = Array.isArray(stores) ? stores : [stores];
  return syncTracking && !list.includes("settings") ? [...list, "settings"] : list;
}
function markDirtyInTx(tx, ids) {
  if (!syncTracking || !ids.length) return;
  const settings = tx.objectStore("settings");
  settings.get("syncDirty").onsuccess = (e) => {
    const dirty = (e.target.result && e.target.result.value) || {};
    const token = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    ids.forEach((id) => { dirty[id] = token; });
    settings.put({ key: "syncDirty", value: dirty });
  };
}
function notifyLocalChange() {
  if (syncTracking && typeof onLocalChange === "function") onLocalChange();
}

/* ---------- Entrées ---------- */

async function saveRecord(record, photo = null) {
  const now = Date.now();
  record.createdAt = record.createdAt || now;
  record.updatedAt = now;
  const tx = writeTx(withSyncStore(["records", "photos"]));
  if (photo) tx.objectStore("photos").put(photo);
  tx.objectStore("records").put(record);
  markDirtyInTx(tx, [record.id]);
  await txDone(tx);
  notifyLocalChange();
  return record;
}
/* Plusieurs entrées en une seule opération (ex. séance + pesée) : tout est enregistré, ou rien. */
async function saveRecords(records) {
  const now = Date.now();
  const tx = writeTx(withSyncStore(["records"]));
  const store = tx.objectStore("records");
  records.forEach((record) => {
    record.createdAt = record.createdAt || now;
    record.updatedAt = now;
    store.put(record);
  });
  markDirtyInTx(tx, records.map((r) => r.id));
  await txDone(tx);
  notifyLocalChange();
  return records;
}
async function deleteRecord(id) {
  const tx = writeTx(withSyncStore(["records", "photos"]));
  const store = tx.objectStore("records");
  store.get(id).onsuccess = (e) => {
    const r = e.target.result;
    if (r && r.photoId) tx.objectStore("photos").delete(r.photoId);
    store.delete(id);
  };
  markDirtyInTx(tx, [id]);
  await txDone(tx);
  notifyLocalChange();
}
async function getRecord(id) {
  return reqResult(db.transaction("records").objectStore("records").get(id));
}
async function getByType(type) {
  return reqResult(db.transaction("records").objectStore("records").index("type").getAll(type));
}
async function getByTypeRange(type, fromIso, toIso) {
  const range = IDBKeyRange.bound([type, fromIso], [type, toIso]);
  return reqResult(db.transaction("records").objectStore("records").index("type_date").getAll(range));
}
async function countByTypeDate(type, iso) {
  return reqResult(db.transaction("records").objectStore("records").index("type_date").count([type, iso]));
}
async function getAllRecords() {
  return reqResult(db.transaction("records").objectStore("records").getAll());
}
async function countRecords() {
  return reqResult(db.transaction("records").objectStore("records").count());
}

/* ---------- Photos ---------- */

async function getPhoto(id) {
  if (!id) return null;
  return reqResult(db.transaction("photos").objectStore("photos").get(id));
}
async function getAllPhotos() {
  return reqResult(db.transaction("photos").objectStore("photos").getAll());
}
async function countPhotos() {
  return reqResult(db.transaction("photos").objectStore("photos").count());
}

/* ---------- Réglages ---------- */

async function getSetting(key, fallback = null) {
  const row = await reqResult(db.transaction("settings").objectStore("settings").get(key));
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  const tx = writeTx("settings");
  tx.objectStore("settings").put({ key, value });
  /* Programme et objectifs : synchronisés entre appareils (la modification la plus récente gagne). */
  const synced = SYNCED_SETTINGS.includes(key);
  if (synced) {
    tx.objectStore("settings").put({ key: `${key}UpdatedAt`, value: Date.now() });
    markDirtyInTx(tx, [`setting:${key}`]);
  }
  await txDone(tx);
  if (synced) notifyLocalChange();
}

/* ---------- Import ---------- */

/* Remplace toutes les entrées et photos en une seule opération : tout ou rien. */
async function replaceAllData(records, photos) {
  const tx = writeTx(withSyncStore(["records", "photos"]));
  const r = tx.objectStore("records");
  const p = tx.objectStore("photos");
  /* Synchro active : les entrées retirées par le remplacement sont aussi supprimées sur tes autres appareils. */
  r.getAllKeys().onsuccess = (e) => {
    const before = e.target.result || [];
    r.clear();
    p.clear();
    records.forEach((x) => r.put(x));
    photos.forEach((x) => p.put(x));
    markDirtyInTx(tx, [...new Set([...before, ...records.map((x) => x.id)])]);
  };
  await txDone(tx);
  notifyLocalChange();
}
/* Fusion : ajoute les nouvelles entrées ; en cas de doublon, la version modifiée le plus récemment gagne. */
async function mergeData(records, photos) {
  const tx = writeTx(["records", "photos"]);
  const store = tx.objectStore("records");
  const photoStore = tx.objectStore("photos");
  const stats = { added: 0, updated: 0, unchanged: 0 };
  const changedIds = [];
  const photoById = new Map(photos.map((ph) => [ph.id, ph]));
  records.forEach((incoming) => {
    store.get(incoming.id).onsuccess = (e) => {
      const existing = e.target.result;
      if (!existing || (incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
        store.put(incoming);
        if (incoming.photoId && photoById.has(incoming.photoId)) photoStore.put(photoById.get(incoming.photoId));
        stats[existing ? "updated" : "added"]++;
        changedIds.push(incoming.id);
      } else {
        stats.unchanged++;
      }
    };
  });
  await txDone(tx);
  /* Les entrées ajoutées ou mises à jour par la fusion partent aussi vers tes autres appareils. */
  if (syncTracking && changedIds.length) await markDirty(changedIds);
  return stats;
}

/* ---------- Synchronisation : opérations sans marquage ---------- */

async function markDirty(ids) {
  if (!syncTracking || !ids.length) return;
  const tx = writeTx(["settings"]);
  markDirtyInTx(tx, ids);
  await txDone(tx);
  notifyLocalChange();
}
/* Retire de « syncDirty » ce qui vient d'être envoyé, sauf si l'entrée a été modifiée entre-temps. */
async function clearDirty(sent) {
  const tx = writeTx(["settings"]);
  const settings = tx.objectStore("settings");
  settings.get("syncDirty").onsuccess = (e) => {
    const dirty = (e.target.result && e.target.result.value) || {};
    Object.entries(sent).forEach(([id, token]) => { if (dirty[id] === token) delete dirty[id]; });
    settings.put({ key: "syncDirty", value: dirty });
  };
  await txDone(tx);
}
/* Applique les changements reçus d'un autre appareil : la version modifiée le plus récemment gagne.
   Rien n'est marqué à renvoyer, et la date de modification d'origine est conservée. */
async function applyRemoteRecords(puts, deletes) {
  /* Dernière modification gagnante. Une entrée absente ici mais marquée « à envoyer » a été supprimée
     sur cet appareil : la date de ce marquage fait office de date de suppression. */
  const tx = writeTx(["records", "photos", "settings"]);
  const store = tx.objectStore("records");
  const settings = tx.objectStore("settings");
  let changed = 0;
  settings.get("syncDirty").onsuccess = (ev) => {
    const dirty = (ev.target.result && ev.target.result.value) || {};
    const localDeletedAt = (id) => (dirty[id] ? parseInt(dirty[id], 10) || 0 : 0);
    let dirtyChanged = false;
    const remoteWins = (id) => { if (dirty[id]) { delete dirty[id]; dirtyChanged = true; } };
    let pending = puts.length + deletes.length;
    const done = () => { if (--pending === 0 && dirtyChanged) settings.put({ key: "syncDirty", value: dirty }); };
    puts.forEach((incoming) => {
      store.get(incoming.id).onsuccess = (e) => {
        const existing = e.target.result;
        const localTime = existing ? existing.updatedAt || 0 : localDeletedAt(incoming.id);
        if ((incoming.updatedAt || 0) > localTime) { store.put(incoming); changed++; remoteWins(incoming.id); }
        done();
      };
    });
    deletes.forEach(({ id, updatedAt }) => {
      store.get(id).onsuccess = (e) => {
        const existing = e.target.result;
        if (existing && (existing.updatedAt || 0) <= updatedAt) {
          if (existing.photoId) tx.objectStore("photos").delete(existing.photoId);
          store.delete(id);
          changed++;
          remoteWins(id);
        } else if (!existing) {
          remoteWins(id);
        }
        done();
      };
    });
  };
  await txDone(tx);
  return changed;
}
async function setSettingFromSync(key, value, updatedAt) {
  const tx = writeTx("settings");
  tx.objectStore("settings").put({ key, value });
  tx.objectStore("settings").put({ key: `${key}UpdatedAt`, value: updatedAt });
  await txDone(tx);
}
async function getAllRecordIds() {
  return reqResult(db.transaction("records").objectStore("records").getAllKeys());
}
async function clearAllEntries() {
  const tx = writeTx(["records", "photos"]);
  tx.objectStore("records").clear();
  tx.objectStore("photos").clear();
  await txDone(tx);
}
