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

/* ---------- Entrées ---------- */

async function saveRecord(record, photo = null) {
  const now = Date.now();
  record.createdAt = record.createdAt || now;
  record.updatedAt = now;
  const tx = writeTx(["records", "photos"]);
  if (photo) tx.objectStore("photos").put(photo);
  tx.objectStore("records").put(record);
  await txDone(tx);
  return record;
}
/* Plusieurs entrées en une seule opération (ex. séance + pesée) : tout est enregistré, ou rien. */
async function saveRecords(records) {
  const now = Date.now();
  const tx = writeTx(["records"]);
  const store = tx.objectStore("records");
  records.forEach((record) => {
    record.createdAt = record.createdAt || now;
    record.updatedAt = now;
    store.put(record);
  });
  await txDone(tx);
  return records;
}
async function deleteRecord(id) {
  const tx = writeTx(["records", "photos"]);
  const store = tx.objectStore("records");
  store.get(id).onsuccess = (e) => {
    const r = e.target.result;
    if (r && r.photoId) tx.objectStore("photos").delete(r.photoId);
    store.delete(id);
  };
  await txDone(tx);
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
  await txDone(tx);
}

/* ---------- Import ---------- */

/* Remplace toutes les entrées et photos en une seule opération : tout ou rien. */
async function replaceAllData(records, photos) {
  const tx = writeTx(["records", "photos"]);
  const r = tx.objectStore("records");
  const p = tx.objectStore("photos");
  r.clear();
  p.clear();
  records.forEach((x) => r.put(x));
  photos.forEach((x) => p.put(x));
  await txDone(tx);
}
/* Fusion : ajoute les nouvelles entrées ; en cas de doublon, la version modifiée le plus récemment gagne. */
async function mergeData(records, photos) {
  const tx = writeTx(["records", "photos"]);
  const store = tx.objectStore("records");
  const photoStore = tx.objectStore("photos");
  const stats = { added: 0, updated: 0, unchanged: 0 };
  const photoById = new Map(photos.map((ph) => [ph.id, ph]));
  records.forEach((incoming) => {
    store.get(incoming.id).onsuccess = (e) => {
      const existing = e.target.result;
      if (!existing || (incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
        store.put(incoming);
        if (incoming.photoId && photoById.has(incoming.photoId)) photoStore.put(photoById.get(incoming.photoId));
        stats[existing ? "updated" : "added"]++;
      } else {
        stats.unchanged++;
      }
    };
  });
  await txDone(tx);
  return stats;
}
async function clearAllEntries() {
  const tx = writeTx(["records", "photos"]);
  tx.objectStore("records").clear();
  tx.objectStore("photos").clear();
  await txDone(tx);
}
