"use strict";
/* ==========================================================================
   Sauvegardes : export, partage (Android), dossier automatique (PC),
   import vérifié avec fusion ou remplacement, exports CSV, stockage protégé.
   ========================================================================== */

/* Le fichier est assemblé par morceaux : plus de limite de taille liée aux photos (audit C1). */
async function buildBackupBlob({ includePhotos = false } = {}) {
  const records = await getAllRecords();
  const settings = { program: state.program, targets: state.targets };
  const parts = [
    `{"app":"Personal Performance","format":${EXPORT_FORMAT},"appVersion":${JSON.stringify(APP_VERSION)},"exportedAt":${JSON.stringify(new Date().toISOString())},`,
    `"settings":${JSON.stringify(settings)},"records":${JSON.stringify(records)},"photos":[`
  ];
  if (includePhotos) {
    const photos = await getAllPhotos();
    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      if (!ph.blob) continue;
      const dataURL = await blobToDataURL(ph.blob);
      parts.push((i ? "," : "") + JSON.stringify({ id: ph.id, mealId: ph.mealId, createdAt: ph.createdAt, dataURL }));
    }
  }
  parts.push("]}");
  return { blob: new Blob(parts, { type: "application/json" }), count: records.length };
}
function backupFilename(suffix = "") {
  return `personal-performance-sauvegarde-${today()}${suffix}.json`;
}
async function markBackupDone() {
  await setSetting("lastBackupAt", Date.now());
  renderBackupStatus().catch(console.error);
  renderStorageInfo().catch(console.error);
}

async function exportBackup(includePhotos) {
  const { blob, count } = await buildBackupBlob({ includePhotos });
  downloadBlob(backupFilename(includePhotos ? "-avec-photos" : ""), blob);
  await markBackupDone();
  showToast(`Sauvegarde exportée (${plural(count, "entrée")}).`);
}

/* Android : envoie la sauvegarde vers Google Drive, un mail, etc. en deux touches. */
async function shareBackup() {
  const { blob } = await buildBackupBlob({ includePhotos: false });
  const file = new File([blob], backupFilename(), { type: "application/json" });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    downloadBlob(file.name, blob);
    await markBackupDone();
    showToast("Partage indisponible ici : la sauvegarde a été téléchargée.");
    return;
  }
  try {
    await navigator.share({ files: [file], title: "Sauvegarde Personal Performance" });
    await markBackupDone();
    showToast("Sauvegarde partagée.");
  } catch (err) {
    if (err && err.name === "AbortError") return;
    throw err;
  }
}

/* PC (Chrome, Edge) : copie dans un dossier choisi, par ex. OneDrive ou Google Drive pour ordinateur. */
const folderSupported = "showDirectoryPicker" in window;
async function writeBackupToFolder(handle) {
  const { blob } = await buildBackupBlob({ includePhotos: false });
  for (const name of ["personal-performance-derniere.json", `personal-performance-${today().slice(0, 7)}.json`]) {
    const fileHandle = await handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
  await setSetting("lastFolderBackupAt", Date.now());
  await markBackupDone();
}
async function chooseBackupFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "pp-sauvegardes", mode: "readwrite" });
  } catch (err) {
    if (err && err.name === "AbortError") return;
    throw err;
  }
  await setSetting("backupDirHandle", handle);
  await writeBackupToFolder(handle);
  showToast(`Sauvegarde écrite dans le dossier « ${handle.name} ». Elle sera mise à jour automatiquement.`);
}
async function backupToFolderNow() {
  const handle = await getSetting("backupDirHandle", null);
  if (!handle) return chooseBackupFolder();
  if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new UserError("Accès au dossier refusé.");
  await writeBackupToFolder(handle);
  showToast(`Sauvegarde écrite dans « ${handle.name} ».`);
}
/* À l'ouverture : si l'accès au dossier est déjà accordé et la dernière copie a plus de 20 h, on la refait sans rien demander. */
async function autoFolderBackup() {
  if (!folderSupported) return;
  try {
    const handle = await getSetting("backupDirHandle", null);
    if (!handle) return;
    const last = await getSetting("lastFolderBackupAt", 0);
    if (Date.now() - last < 20 * 3600000) return;
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return;
    await writeBackupToFolder(handle);
  } catch (err) { console.warn("Sauvegarde automatique impossible", err); }
}

/* ---------- Import ---------- */

async function parseBackupFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new UserError("Fichier illisible : ce n'est pas une sauvegarde JSON valide."); }
  if (!data || typeof data !== "object" || !Array.isArray(data.records)) throw new UserError("Ce fichier n'est pas une sauvegarde Personal Performance.");
  if (data.format && data.format > EXPORT_FORMAT) throw new UserError("Cette sauvegarde vient d'une version plus récente de l'application. Mets l'application à jour d'abord.");
  const records = [], photos = [];
  let rejected = 0;
  const ids = new Set();
  for (const raw of data.records) {
    const out = normalizeRecord(raw);
    if (!out || ids.has(out.record.id)) { rejected++; continue; }
    ids.add(out.record.id);
    records.push(out.record);
    if (out.photo) photos.push(out.photo);
  }
  if (Array.isArray(data.photos)) {
    for (const ph of data.photos) {
      const id = cleanId(ph && ph.id);
      if (!id || typeof ph.dataURL !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(ph.dataURL)) continue;
      try { photos.push({ id, mealId: cleanId(ph.mealId), blob: dataURLToBlob(ph.dataURL), createdAt: cleanTime(ph.createdAt) || Date.now() }); } catch { /* photo abîmée ignorée */ }
    }
  }
  /* Une entrée qui pointe vers une photo absente du fichier perd simplement son lien. */
  const photoIds = new Set(photos.map((p) => p.id));
  records.forEach((r) => { if (r.photoId && !photoIds.has(r.photoId)) r.photoId = null; });
  const settings = data.settings || {};
  const program = normalizeProgram(settings.program);
  return { records, photos, rejected, program: program ? upgradeProgram(program).program : null, targets: settings.targets ? normalizeTargets(settings.targets) : null, total: data.records.length };
}

async function importBackup(file, mode) {
  const parsed = await parseBackupFile(file);
  if (!parsed.records.length) throw new UserError(`Aucune entrée valide dans ce fichier (${plural(parsed.rejected, "entrée ignorée", "entrées ignorées")}). Rien n'a été modifié.`);
  const current = await countRecords();
  const lines = [
    `${plural(parsed.records.length, "entrée valide", "entrées valides")}${parsed.rejected ? `, ${plural(parsed.rejected, "entrée ignorée", "entrées ignorées")} (illisibles)` : ""}.`,
    mode === "replace"
      ? `REMPLACER : les ${fmt(current, 0)} entrées actuelles seront remplacées. Une copie de sécurité va d'abord être téléchargée.`
      : `FUSIONNER : les entrées du fichier s'ajoutent aux ${fmt(current, 0)} actuelles ; en cas de doublon, la version la plus récente est gardée.`
  ];
  if (!confirm(`Importer cette sauvegarde ?\n\n${lines.join("\n")}`)) return;

  if (mode === "replace") {
    if (current > 0) {
      const { blob } = await buildBackupBlob({ includePhotos: true });
      downloadBlob(backupFilename("-avant-import"), blob);
    }
    await replaceAllData(parsed.records, parsed.photos);
    if (parsed.program) { state.program = parsed.program; await setSetting("program", parsed.program); }
    if (parsed.targets) { state.targets = parsed.targets; await setSetting("targets", parsed.targets); }
    await reloadAll();
    showToast(`Import terminé : ${plural(parsed.records.length, "entrée")}.`);
  } else {
    const stats = await mergeData(parsed.records, parsed.photos);
    await reloadAll();
    showToast(`Fusion terminée : ${stats.added} ajoutée(s), ${stats.updated} mise(s) à jour, ${stats.unchanged} inchangée(s).`);
  }
}

/* ---------- CSV (Excel en français : point-virgule, virgule décimale) ---------- */

function csvCell(value) {
  let s = typeof value === "number" ? String(value).replace(".", ",") : String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== "number") s = "'" + s; // empêche l'interprétation comme formule
  return `"${s.replace(/"/g, '""')}"`;
}
function downloadCSV(name, rows) {
  downloadBlob(name, new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
}
async function exportMealsCSV() {
  const meals = (await getByType("meal")).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  downloadCSV(`nutrition-${today()}.csv`, [["date", "repas", "aliment", "portion", "grammes", "kcal", "proteines_g", "glucides_g", "lipides_g", "fibres_g"],
    ...meals.map((m) => [m.date, m.kind, m.name, m.quantity, m.grams ?? "", m.kcal, m.protein, m.carbs, m.fat, m.fiber])]);
  showToast(`${plural(meals.length, "repas exporté", "repas exportés")}.`);
}
async function exportWorkoutsCSV() {
  const rows = [["date", "seance", "exercice", "serie", "charge_kg", "repetitions_avant_echec", "complement_rest_pause", "pause_s", "duree_min"]];
  state.workouts.slice().reverse().forEach((w) => (w.exercises || []).forEach((e) => (e.sets || []).forEach((s, i) => {
    rows.push([w.date, w.sessionType, e.name, i + 1, s.load ?? "", s.reps ?? "", s.rpReps ?? "", s.rpReps ? (s.rpPause ?? "") : "", w.duration ?? ""]);
  })));
  downloadCSV(`seances-${today()}.csv`, rows);
  showToast(`${plural(rows.length - 1, "série exportée", "séries exportées")}.`);
}

/* ---------- Stockage protégé (audit C4) ---------- */

async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}
async function renderStorageInfo() {
  const el = document.getElementById("storage-info");
  const [count, photos, last] = await Promise.all([countRecords(), countPhotos(), getSetting("lastBackupAt", null)]);
  let persisted = null, usage = null;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch { /* inconnu */ }
  try { usage = navigator.storage && navigator.storage.estimate ? (await navigator.storage.estimate()).usage : null; } catch { /* inconnu */ }
  const folder = folderSupported ? await getSetting("backupDirHandle", null) : null;
  el.innerHTML = `<ul class="plain-list">
    <li>${plural(count, "entrée")} et ${plural(photos, "photo")} dans ce navigateur${usage !== null ? ` (${fmt(usage / 1048576, 1)} Mo utilisés)` : ""}.</li>
    <li>Stockage protégé : <b class="${persisted ? "ok-text" : "danger-text"}">${persisted === null ? "inconnu" : persisted ? "oui" : "non"}</b>${persisted ? "" : " — le navigateur pourrait vider les données s'il manque d'espace. Installe l'application puis touche « Protéger mes données »."}</li>
    <li>Dernière sauvegarde : <b>${esc(timeAgo(last))}</b>.</li>
    ${folder ? `<li>Dossier de sauvegarde automatique : <b>${esc(folder.name)}</b>.</li>` : ""}
    <li>Adresse de l'application : <b>${esc(location.origin === "null" ? "fichier local" : location.origin)}</b>. Les données sont liées à cette adresse : une autre adresse = un autre coffre.</li>
  </ul>`;
  document.getElementById("persist-button").hidden = Boolean(persisted);
}

function setupBackup() {
  document.getElementById("export-json").addEventListener("click", (e) => withBusy(e.currentTarget, () => exportBackup(false)));
  document.getElementById("export-json-photos").addEventListener("click", (e) => withBusy(e.currentTarget, () => exportBackup(true)));
  const share = document.getElementById("share-backup");
  share.hidden = !navigator.share;
  share.addEventListener("click", (e) => withBusy(e.currentTarget, shareBackup));
  const folderBtn = document.getElementById("folder-backup");
  folderBtn.hidden = !folderSupported;
  folderBtn.addEventListener("click", (e) => withBusy(e.currentTarget, backupToFolderNow));
  document.getElementById("alert-backup").addEventListener("click", (e) => withBusy(e.currentTarget, () => (navigator.share && /Android/i.test(navigator.userAgent) ? shareBackup() : exportBackup(false))));
  document.getElementById("import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const mode = document.querySelector('input[name="import-mode"]:checked')?.value === "replace" ? "replace" : "merge";
    await withBusy(null, () => importBackup(file, mode));
    e.target.value = "";
  });
  document.getElementById("export-csv").addEventListener("click", (e) => withBusy(e.currentTarget, exportMealsCSV));
  document.getElementById("export-workouts-csv").addEventListener("click", (e) => withBusy(e.currentTarget, exportWorkoutsCSV));
  document.getElementById("persist-button").addEventListener("click", async () => {
    const ok = await requestPersistence();
    showToast(ok ? "Données protégées." : "Le navigateur a refusé pour l'instant. Installe l'application, puis réessaie dans quelques jours.", ok ? "ok" : "error");
    renderStorageInfo().catch(console.error);
  });
  document.getElementById("clear-data").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!confirm("ATTENTION : supprimer toutes les séances, repas, mesures, check-ins et photos de cet appareil ?\nTon programme et tes objectifs sont conservés.")) return;
    if (!confirm("Dernière confirmation : une copie de sécurité va être téléchargée, puis tout sera supprimé. Continuer ?")) return;
    const { blob, count } = await buildBackupBlob({ includePhotos: true });
    if (count) downloadBlob(backupFilename("-avant-suppression"), blob);
    await clearAllEntries();
    await reloadAll();
    showToast("Toutes les entrées ont été supprimées.");
  }));
}
