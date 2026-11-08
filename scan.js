/* Scan des codes-barres (EAN-13, EAN-8, UPC-A) et recherche du produit dans Open Food Facts.
   - La caméra est lue sur l'appareil : aucune image n'est envoyée nulle part.
   - Seul le numéro du code part vers Open Food Facts (base collaborative gratuite) : il faut du réseau.
   - Les produits déjà trouvés sont gardés sur l'appareil (« foodCache ») : un nouveau scan marche hors connexion.
   - Le décodeur intégré ci-dessous sert quand le navigateur n'a pas de lecteur natif (iPhone, ordinateur). */

const FOOD_CACHE_MAX = 300;
const OFF_TIMEOUT_MS = 10000;
let scanStream = null;          // flux de la caméra, arrêté dès la fermeture de la fenêtre
let scanTimer = null;
let scanDetector = null;        // lecteur natif du navigateur (Android) s'il existe
let scanCandidate = null;       // code lu une fois, à confirmer par une deuxième lecture
let scanCanvas = null;

/* ---------- Décodeur EAN intégré ---------- */

/* Largeurs (en modules) des 4 barres/espaces de chaque chiffre : codes L ; les codes G sont inversés. */
const EAN_L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
const EAN_G = EAN_L.map((p) => p.slice().reverse());
/* Le 1er chiffre d'un EAN-13 se lit dans l'alternance L/G des 6 chiffres de gauche. */
const EAN_FIRST = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function eanChecksumOk(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split("").map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((v, k) => { sum += v * (k % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}
function eanMatchDigit(widths, withG) {
  const unit = (widths[0] + widths[1] + widths[2] + widths[3]) / 7;
  let best = null, second = Infinity;
  const tables = withG ? [[EAN_L, "L"], [EAN_G, "G"]] : [[EAN_L, "L"]];
  tables.forEach(([table, parity]) => table.forEach((p, digit) => {
    let err = 0;
    for (let i = 0; i < 4; i++) err += Math.abs(widths[i] / unit - p[i]);
    if (!best || err < best.err) { if (best) second = best.err; best = { digit, parity, err }; }
    else if (err < second) second = err;
  }));
  /* Erreur trop grande ou hésitation entre deux chiffres : lecture refusée (la somme de contrôle fera le reste). */
  return best && best.err < 1.6 && second - best.err > 0.2 ? best : null;
}
function eanGuardOk(runs, start, count, unit) {
  for (let k = 0; k < count; k++) {
    const w = runs[start + k] / unit;
    if (w < 0.35 || w > 2.2) return false;
  }
  return true;
}
/* Essaie de lire un EAN-13 (59 traits) ou un EAN-8 (43 traits) à partir du trait sombre n° i. */
function eanDecodeAt(runs, i, kind) {
  const n = kind === 13 ? 59 : 43, modules = kind === 13 ? 95 : 67, half = kind === 13 ? 6 : 4;
  if (i + n > runs.length) return null;
  let total = 0;
  for (let k = 0; k < n; k++) total += runs[i + k];
  const unit = total / modules;
  if (unit < 1) return null;
  const mid = 3 + 4 * half, right = mid + 5;
  if (!eanGuardOk(runs, i, 3, unit) || !eanGuardOk(runs, i + mid, 5, unit) || !eanGuardOk(runs, i + n - 3, 3, unit)) return null;
  /* Zones blanches de part et d'autre du code (quand elles sont dans l'image). */
  if (i > 1 && runs[i - 1] < unit * 3) return null;
  if (i + n < runs.length - 1 && runs[i + n] < unit * 3) return null;
  let digits = "", parity = "";
  for (let d = 0; d < half; d++) {
    const m = eanMatchDigit(runs.slice(i + 3 + 4 * d, i + 7 + 4 * d), kind === 13);
    if (!m) return null;
    digits += m.digit; parity += m.parity;
  }
  for (let d = 0; d < half; d++) {
    const m = eanMatchDigit(runs.slice(i + right + 4 * d, i + right + 4 + 4 * d), false);
    if (!m) return null;
    digits += m.digit;
  }
  let code = digits;
  if (kind === 13) {
    const first = EAN_FIRST.indexOf(parity);
    if (first < 0) return null;
    code = first + digits;
  }
  return eanChecksumOk(code) ? code : null;
}
/* Ligne de luminosités → largeurs des traits alternés (le 1er élément est sombre si dark0). */
function scanLineRuns(lum) {
  const len = lum.length;
  const block = Math.max(8, Math.round(len / 14));
  const nb = Math.ceil(len / block);
  const bmin = new Array(nb).fill(255), bmax = new Array(nb).fill(0);
  for (let x = 0; x < len; x++) {
    const b = (x / block) | 0;
    if (lum[x] < bmin[b]) bmin[b] = lum[x];
    if (lum[x] > bmax[b]) bmax[b] = lum[x];
  }
  const runs = [];
  let dark0 = null, current = null, count = 0;
  for (let x = 0; x < len; x++) {
    const b = (x / block) | 0;
    const lo = Math.min(bmin[Math.max(0, b - 1)], bmin[b], bmin[Math.min(nb - 1, b + 1)]);
    const hi = Math.max(bmax[Math.max(0, b - 1)], bmax[b], bmax[Math.min(nb - 1, b + 1)]);
    const dark = hi - lo >= 28 && lum[x] < (lo + hi) / 2;
    if (current === null) { current = dark; dark0 = dark; count = 1; }
    else if (dark === current) count++;
    else { runs.push(count); current = dark; count = 1; }
  }
  if (count) runs.push(count);
  return { runs, dark0 };
}
/* Ligne agrandie ×2 (interpolation) : les barres fines d'un code lointain gardent une largeur mesurable. */
function upsampleLine(lum) {
  const out = new Float32Array(lum.length * 2 - 1);
  for (let x = 0; x < lum.length - 1; x++) { out[2 * x] = lum[x]; out[2 * x + 1] = (lum[x] + lum[x + 1]) / 2; }
  out[out.length - 1] = lum[lum.length - 1];
  return out;
}
function eanDecodeLine(lum) {
  const { runs, dark0 } = scanLineRuns(upsampleLine(lum));
  const tryRuns = (list, firstDark) => {
    for (let i = firstDark ? 0 : 1; i < list.length; i += 2) {
      const code = eanDecodeAt(list, i, 13) || eanDecodeAt(list, i, 8);
      if (code) return code;
    }
    return null;
  };
  /* Dans les deux sens : un code à l'envers se lit aussi. */
  const reversed = runs.slice().reverse();
  const lastDark = runs.length % 2 === 1 ? dark0 : !dark0;
  return tryRuns(runs, dark0) || tryRuns(reversed, lastDark);
}
/* Lit plusieurs lignes horizontales (puis verticales) au centre de l'image.
   Renvoie le code le plus souvent lu et le nombre de lignes qui l'ont lu. */
function scanImageData(img) {
  const { width, height, data } = img;
  const lumAt = (x, y) => { const p = (y * width + x) * 4; return data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114; };
  const votes = new Map();
  const vote = (code) => { if (code) votes.set(code, (votes.get(code) || 0) + 1); };
  const lines = 15;
  for (let k = 0; k < lines; k++) {
    const y = Math.round(height * (0.2 + 0.6 * k / (lines - 1)));
    const lum = new Float32Array(width);
    /* Moyenne de 3 lignes voisines : les barres sont verticales, cela réduit le bruit sans flou. */
    for (let x = 0; x < width; x++) lum[x] = (lumAt(x, Math.max(0, y - 1)) + lumAt(x, y) + lumAt(x, Math.min(height - 1, y + 1))) / 3;
    vote(eanDecodeLine(lum));
  }
  if (!votes.size) {
    for (let k = 0; k < lines; k++) {
      const x = Math.round(width * (0.2 + 0.6 * k / (lines - 1)));
      const lum = new Float32Array(height);
      for (let y = 0; y < height; y++) lum[y] = (lumAt(Math.max(0, x - 1), y) + lumAt(x, y) + lumAt(Math.min(width - 1, x + 1), y)) / 3;
      vote(eanDecodeLine(lum));
    }
  }
  let best = null;
  votes.forEach((hits, code) => { if (!best || hits > best.hits) best = { code, hits }; });
  return best;
}
function scanVideoFrame(video) {
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
  if (!scanCanvas) scanCanvas = document.createElement("canvas");
  if (scanCanvas.width !== w || scanCanvas.height !== h) { scanCanvas.width = w; scanCanvas.height = h; }
  const ctx = scanCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return scanImageData(ctx.getImageData(0, 0, w, h));
}

/* ---------- Open Food Facts ---------- */

/* Garde les chiffres ; un UPC-A (12 chiffres, produits américains) devient un EAN-13 en ajoutant un 0. */
function normalizeBarcode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12) return `0${digits}`;
  return /^\d{8}$|^\d{13,14}$/.test(digits) ? digits : null;
}
function offNumber(v) {
  const n = typeof v === "number" ? v : parseNumber(v);
  return n !== null && Number.isFinite(n) && n >= 0 ? n : null;
}
/* Fiche Open Food Facts → aliment de l'app (valeurs pour 100 g, ou 100 ml pour une boisson). */
function productFromOff(code, p) {
  const n = (p && p.nutriments) || {};
  let kcal = offNumber(n["energy-kcal_100g"]);
  if (kcal === null && offNumber(n.energy_100g) !== null) kcal = offNumber(n.energy_100g) / 4.184;   // kJ → kcal
  const baseName = cleanText(p.product_name_fr || p.product_name || p.generic_name_fr || p.generic_name || `Produit ${code}`, 100);
  const brand = cleanText(String(p.brands || "").split(",")[0], 40);
  const name = (brand && !fold(baseName).includes(fold(brand)) ? `${baseName} (${brand})` : baseName).slice(0, 120);
  const per100 = kcal === null ? null : cleanPer100({
    kcal: round(kcal, 1),
    protein: offNumber(n.proteins_100g) ?? 0, carbs: offNumber(n.carbohydrates_100g) ?? 0,
    fat: offNumber(n.fat_100g) ?? 0, fiber: offNumber(n.fiber_100g) ?? 0
  });
  const serving = offNumber(p.serving_quantity);
  const grade = String(p.nutriscore_grade || "").toLowerCase();
  const nova = Number(p.nova_group);
  return {
    code, name, per100,
    servingG: serving !== null && serving >= 1 && serving <= 2000 ? round(serving, 0) : null,
    nutriscore: /^[a-e]$/.test(grade) ? grade : null,
    nova: Number.isInteger(nova) && nova >= 1 && nova <= 4 ? nova : null,
    savedAt: Date.now()
  };
}
async function rememberFood(product) {
  const cache = await getSetting("foodCache", {});
  cache[product.code] = product;
  const codes = Object.keys(cache);
  if (codes.length > FOOD_CACHE_MAX) {
    codes.sort((a, b) => (cache[a].savedAt || 0) - (cache[b].savedAt || 0))
      .slice(0, codes.length - FOOD_CACHE_MAX).forEach((c) => { delete cache[c]; });
  }
  await setSetting("foodCache", cache);
}
/* Renvoie le produit, null s'il est inconnu d'Open Food Facts ; erreur claire si la recherche est impossible. */
async function fetchFoodByBarcode(code) {
  const cache = await getSetting("foodCache", {});
  const cached = cache[code] || null;
  if (!navigator.onLine) {
    if (cached) return cached;
    throw new UserError("Pas de réseau : la recherche du produit a besoin d'internet. Saisis l'étiquette, ou rescanne plus tard.");
  }
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,product_name_fr,generic_name,generic_name_fr,brands,serving_quantity,nutriments,nutriscore_grade,nova_group`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch {
    if (cached) return cached;
    throw new UserError("Open Food Facts ne répond pas : réessaie, ou saisis l'étiquette.");
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.status === 404 || (body && body.status === 0)) return null;
  if (!res.ok || !body || !body.product) {
    if (cached) return cached;
    throw new UserError(`Open Food Facts est indisponible pour le moment (erreur ${res.status}). Réessaie plus tard.`);
  }
  const product = productFromOff(code, body.product);
  await rememberFood(product);
  return product;
}

/* ---------- Fenêtre de scan ---------- */

function setScanStatus(text, kind = "") {
  const el = document.getElementById("scan-status");
  el.textContent = text;
  el.className = `hint ${kind === "error" ? "trend-bad" : ""}`;
}
function stopScanCamera() {
  clearTimeout(scanTimer);
  scanTimer = null;
  scanCandidate = null;
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
  const video = document.getElementById("scan-video");
  if (video) video.srcObject = null;
}
async function createNativeDetector() {
  try {
    if (!("BarcodeDetector" in window)) return null;
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes("ean_13")) return null;
    return new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"].filter((f) => formats.includes(f)) });
  } catch {
    return null;
  }
}
async function startScanCamera() {
  const view = document.getElementById("scan-view");
  const video = document.getElementById("scan-video");
  view.hidden = false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    view.hidden = true;
    setScanStatus("Caméra non disponible dans ce navigateur : tape le code ci-dessous.");
    return;
  }
  setScanStatus("Ouverture de la caméra…");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (err) {
    view.hidden = true;
    setScanStatus(err && err.name === "NotAllowedError"
      ? "Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, ou tape le code ci-dessous."
      : "Pas de caméra disponible : tape le code ci-dessous.");
    return;
  }
  if (!document.getElementById("scan-dialog").open) { stream.getTracks().forEach((t) => t.stop()); return; }
  scanStream = stream;
  video.srcObject = stream;
  try { await video.play(); } catch { /* lecture lancée par l'attribut autoplay */ }
  scanDetector = await createNativeDetector();
  setScanStatus("Place le code-barres dans le cadre, bien éclairé, à 10–20 cm.");
  scanTimer = setTimeout(scanFrame, 200);
}
async function scanFrame() {
  if (!scanStream) return;
  const video = document.getElementById("scan-video");
  let code = null;
  if (video.readyState >= 2 && video.videoWidth) {
    try {
      if (scanDetector) {
        const found = await scanDetector.detect(video);
        const hit = found.find((b) => normalizeBarcode(b.rawValue));
        code = hit ? normalizeBarcode(hit.rawValue) : null;
      } else {
        const read = scanVideoFrame(video);
        /* Décodeur intégré : on attend deux lectures concordantes (même image ou images successives). */
        if (read && (read.hits >= 2 || read.code === scanCandidate)) code = read.code;
        else scanCandidate = read ? read.code : scanCandidate;
      }
    } catch (err) {
      console.warn(err);
      scanDetector = null;
    }
  }
  if (code) {
    stopScanCamera();
    if (navigator.vibrate) navigator.vibrate(60);
    await lookupBarcode(code);
    return;
  }
  if (scanStream) scanTimer = setTimeout(scanFrame, 120);
}
/* onProduct : où envoyer le produit trouvé (formulaire de repas par défaut, ou une recette). */
let scanOnProduct = null;
async function openScanDialog(onProduct = null) {
  scanOnProduct = typeof onProduct === "function" ? onProduct : null;
  const dialog = document.getElementById("scan-dialog");
  document.getElementById("scan-manual").elements.code.value = "";
  dialog.showModal();
  await startScanCamera();
}
/* Produit trouvé : nom, valeurs pour 100 g et portion vont dans le formulaire ; les grammes restent modifiables. */
function applyScannedProduct(product) {
  if (scanOnProduct) { scanOnProduct(product); return; }
  const form = mealForm();
  form.elements.name.value = product.name;
  setMealProduct(product);
  document.getElementById("food-suggestions").innerHTML = "";
  if (!product.per100) {
    mealPer100 = null;
    updatePer100Hint();
    return;
  }
  mealPer100 = { ...product.per100 };
  if (product.servingG) {
    setField(form, "grams", product.servingG);
    if (!form.elements.quantity.value) form.elements.quantity.value = "1 portion";
  } else if (!parseNumber(form.elements.grams.value)) {
    form.elements.grams.value = "100";
  }
  applyPer100();
  updatePer100Hint();
}
async function lookupBarcode(raw) {
  const code = normalizeBarcode(raw);
  if (!code) { setScanStatus("Code incomplet : un code-barres compte 8 ou 13 chiffres.", "error"); return; }
  if (!eanChecksumOk(code)) { setScanStatus(`Le code ${code} semble mal recopié (dernier chiffre incohérent). Vérifie-le.`, "error"); return; }
  setScanStatus(`Code ${code} : recherche dans Open Food Facts…`);
  try {
    const product = await fetchFoodByBarcode(code);
    if (!product) {
      setScanStatus(`Produit ${code} absent d'Open Food Facts : ferme cette fenêtre et saisis les valeurs de l'étiquette.`, "error");
      return;
    }
    applyScannedProduct(product);
    document.getElementById("scan-dialog").close();
    const scores = productScoresText(product);
    showToast(product.per100
      ? `${product.name} : ${fmt(product.per100.kcal, 0)} kcal pour 100 g${scores ? ` · ${scores}` : ""}. Vérifie les grammes.`
      : `${product.name} trouvé, mais sans valeurs nutritionnelles : saisis l'étiquette.`, product.per100 ? "ok" : "error");
  } catch (err) {
    if (!err.userMessage) console.error(err);
    setScanStatus(humanError(err).replace(" Rien n'a été enregistré.", ""), "error");
  }
}
function setupScan() {
  const dialog = document.getElementById("scan-dialog");
  document.getElementById("scan-open").addEventListener("click", () => { openScanDialog().catch(console.error); });
  document.getElementById("scan-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { stopScanCamera(); scanOnProduct = null; });
  document.getElementById("scan-manual").addEventListener("submit", (e) => {
    e.preventDefault();
    stopScanCamera();
    document.getElementById("scan-view").hidden = true;
    withBusy(e.submitter, () => lookupBarcode(e.target.elements.code.value));
  });
}
