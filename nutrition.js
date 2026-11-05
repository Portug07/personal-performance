"use strict";
/* ==========================================================================
   Nutrition : objectifs et « reste du jour », navigation par jour, saisie en grammes,
   aliments déjà mangés, répétition d'un repas, photos compressées.
   ========================================================================== */

let mealPer100 = null;          // valeurs pour 100 g de l'aliment choisi (calcul selon les grammes)
let mealPhotoFile = null;       // photo choisie, compressée à l'enregistrement
let photoURLs = [];             // adresses temporaires des miniatures, libérées à chaque affichage

function mealForm() { return document.getElementById("meal-form"); }

function defaultMealKind() {
  const h = new Date().getHours();
  if (h < 10) return "Petit-déjeuner";
  if (h < 15) return "Déjeuner";
  if (h < 18) return "Collation";
  return "Dîner";
}

async function reloadMeals() {
  const t = today();
  state.recentMeals = await getByTypeRange("meal", addDays(t, -90), t);
  state.dayMeals = await getByTypeRange("meal", state.nutritionDate, state.nutritionDate);
}

/* ---------- Totaux et objectifs ---------- */

function mealTotals(meals) {
  return {
    kcal: sum(meals, "kcal"), protein: sum(meals, "protein"), carbs: sum(meals, "carbs"),
    fat: sum(meals, "fat"), fiber: sum(meals, "fiber")
  };
}
function targetCard(label, value, target, unit, decimals = 0) {
  let foot = `${unit} ${state.nutritionDate === today() ? "aujourd'hui" : "ce jour-là"}`;
  if (target) {
    const left = target - value;
    foot = left >= 0 ? `reste ${fmt(left, decimals)} ${unit}` : `<span class="danger-text">dépassé de ${fmt(-left, decimals)} ${unit}</span>`;
  }
  return `<article class="metric-card">
    <span class="metric-label">${esc(label)}</span>
    <strong>${fmt(value, decimals)}${target ? `<span class="metric-target"> / ${fmt(target, decimals)}</span>` : ""}</strong>
    ${progressBar(value, target)}
    <small>${foot}</small>
  </article>`;
}
/* Alcool d'une liste d'entrées : verres standard (10 g d'alcool pur) et calories. */
function alcoholTotals(meals) {
  const drinks = meals.filter(isAlcoholEntry);
  return {
    count: drinks.length,
    std: drinks.reduce((a, m) => a + standardDrinks(m.volumeMl, m.abv), 0),
    kcal: drinks.reduce((a, m) => a + (Number(m.kcal) || 0), 0)
  };
}
function renderNutritionTotals() {
  const t = mealTotals(state.dayMeals);
  const g = state.targets;
  const el = document.getElementById("nutrition-totals");
  el.innerHTML = targetCard("Calories", t.kcal, g.kcal, "kcal") + targetCard("Protéines", t.protein, g.protein, "g")
    + targetCard("Glucides", t.carbs, g.carbs, "g") + targetCard("Lipides", t.fat, g.fat, "g");
  applyProgressWidths(el);
  document.getElementById("targets-hint").hidden = Boolean(g.kcal || g.protein);
  document.getElementById("nutrition-fiber").textContent = `Fibres : ${fmt(t.fiber, 0)} g${g.fiber ? ` / ${fmt(g.fiber, 0)} g` : ""}`;
  const a = alcoholTotals(state.dayMeals);
  const alcoholEl = document.getElementById("nutrition-alcohol");
  alcoholEl.hidden = !a.count;
  alcoholEl.textContent = a.count ? `Alcool : ${fmt(a.std, 1)} verre(s) standard · ${fmt(a.kcal, 0)} kcal, comprises dans le total du jour.` : "";
}

/* ---------- Navigation par jour (audit I3) ---------- */

function renderDayNav() {
  const d = state.nutritionDate;
  document.getElementById("day-label").textContent = fmtDayLabel(d);
  document.getElementById("day-sub").textContent = fmtDate(d);
  document.getElementById("day-picker").value = d;
  document.getElementById("day-next").disabled = d >= today();
  document.getElementById("day-today").hidden = d === today();
}
async function setNutritionDate(iso) {
  if (!isValidISO(iso)) return;
  state.nutritionDate = iso > today() ? today() : iso;
  if (!state.editing.meal) mealForm().elements.date.value = state.nutritionDate;
  state.dayMeals = await getByTypeRange("meal", state.nutritionDate, state.nutritionDate);
  renderNutrition();
}

/* ---------- Liste des repas du jour ---------- */

function renderMealList() {
  photoURLs.forEach((u) => URL.revokeObjectURL(u));
  photoURLs = [];
  const el = document.getElementById("meal-history");
  const meals = state.dayMeals.slice().sort((a, b) => MEAL_KINDS.indexOf(a.kind) - MEAL_KINDS.indexOf(b.kind) || (a.createdAt || 0) - (b.createdAt || 0));
  if (!meals.length) {
    el.innerHTML = `<p class="empty">Aucun repas enregistré ${state.nutritionDate === today() ? "aujourd'hui" : "ce jour-là"}.</p>`;
    return;
  }
  let html = "";
  for (const kind of MEAL_KINDS) {
    const group = meals.filter((m) => m.kind === kind);
    if (!group.length) continue;
    html += `<div class="meal-group"><div class="meal-group-head"><span>${esc(kind)}</span><span>${fmt(sum(group, "kcal"), 0)} kcal</span></div>`;
    html += group.map((m) => {
      const portion = isAlcoholEntry(m) && m.volumeMl
        ? [`${fmt(m.volumeMl, 0)} ml`, m.abv ? `${fmt(m.abv, 1)} %` : "", m.abv ? `${fmt(standardDrinks(m.volumeMl, m.abv), 1)} verre(s) std` : ""].filter(Boolean).join(" · ")
        : [m.grams ? `${fmt(m.grams, 0)} g` : "", m.quantity].filter(Boolean).join(" · ");
      return `<article class="record-item meal-item">
        ${m.photoId ? `<button type="button" class="thumb" data-action="view-photo" data-photo="${esc(m.photoId)}" aria-label="Voir la photo"><img alt="" data-photo-img="${esc(m.photoId)}"></button>` : ""}
        <div class="record-main">
          <b>${esc(m.name)}</b>
          <small>${portion ? `${esc(portion)} · ` : ""}<b>${fmt(m.kcal, 0)} kcal</b> · P ${fmt(m.protein, 1)} g · G ${fmt(m.carbs, 1)} g · L ${fmt(m.fat, 1)} g · Fibres ${fmt(m.fiber, 1)} g</small>
        </div>
        <div class="record-actions">
          <button type="button" class="small-button" data-action="edit-meal" data-id="${esc(m.id)}">Modifier</button>
          <button type="button" class="small-button" data-action="repeat-meal" data-id="${esc(m.id)}" title="Ajouter ce repas aujourd'hui">Répéter</button>
          <button type="button" class="small-button delete" data-action="delete-record" data-id="${esc(m.id)}">Supprimer</button>
        </div>
      </article>`;
    }).join("");
    html += "</div>";
  }
  el.innerHTML = html;
  $$("[data-photo-img]", el).forEach(async (img) => {
    try {
      const photo = await getPhoto(img.dataset.photoImg);
      if (!photo || !photo.blob) return;
      const url = URL.createObjectURL(photo.blob);
      photoURLs.push(url);
      img.src = url;
    } catch (err) { console.warn(err); }
  });
}

async function viewPhoto(photoId) {
  const photo = await getPhoto(photoId);
  if (!photo || !photo.blob) { showToast("Photo introuvable.", "error"); return; }
  const dialog = document.getElementById("photo-dialog");
  const img = document.getElementById("photo-dialog-img");
  const url = URL.createObjectURL(photo.blob);
  img.src = url;
  dialog.addEventListener("close", () => URL.revokeObjectURL(url), { once: true });
  dialog.showModal();
}

/* ---------- Suggestions : aliments déjà mangés + mini-base ---------- */

function historyFoods() {
  const seen = new Map();
  state.recentMeals.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach((m) => {
    const k = fold(m.name);
    if (!seen.has(k)) seen.set(k, m);
  });
  return [...seen.values()];
}
function renderFoodSuggestions() {
  const q = fold(mealForm().elements.name.value);
  const out = document.getElementById("food-suggestions");
  if (q.length < 2) { out.innerHTML = ""; return; }
  const fromHistory = historyFoods().filter((m) => fold(m.name).includes(q)).slice(0, 5);
  const fromBase = FOODS.filter((f) => fold(f.name).includes(q)).slice(0, 6);
  out.innerHTML = fromHistory.map((m) => `<button type="button" class="food-chip history" data-history="${esc(m.id)}">${esc(m.name)} · ${fmt(m.kcal, 0)} kcal${m.grams ? ` (${fmt(m.grams, 0)} g)` : ""}</button>`).join("")
    + fromBase.map((f) => `<button type="button" class="food-chip" data-food="${esc(f.name)}">${esc(f.name)} · ${fmt(f.per100.kcal, 0)} kcal/100 g</button>`).join("");
}
function fillMacros(values) {
  const form = mealForm();
  setField(form, "kcal", values.kcal === null ? null : round(values.kcal, 0));
  ["protein", "carbs", "fat", "fiber"].forEach((k) => setField(form, k, values[k] === null ? null : round(values[k], 1)));
}
function applyPer100() {
  const form = mealForm();
  const grams = parseNumber(form.elements.grams.value);
  if (!mealPer100 || grams === null || Number.isNaN(grams)) return;
  const f = grams / 100;
  fillMacros({ kcal: mealPer100.kcal * f, protein: mealPer100.protein * f, carbs: mealPer100.carbs * f, fat: mealPer100.fat * f, fiber: mealPer100.fiber * f });
}
function updatePer100Hint() {
  document.getElementById("per100-hint").textContent = mealPer100
    ? `Calcul automatique : ${fmt(mealPer100.kcal, 0)} kcal pour 100 g. Modifie les grammes, les valeurs suivent.`
    : "Saisis les valeurs de l'étiquette, ou choisis un aliment pour un calcul automatique selon les grammes.";
}
function chooseFood(food) {
  const form = mealForm();
  form.elements.name.value = food.name;
  mealPer100 = { ...food.per100 };
  if (!parseNumber(form.elements.grams.value)) form.elements.grams.value = "100";
  applyPer100();
  updatePer100Hint();
  document.getElementById("food-suggestions").innerHTML = "";
}
function chooseHistoryMeal(m) {
  const form = mealForm();
  form.elements.name.value = m.name;
  form.elements.quantity.value = m.quantity || "";
  setField(form, "grams", m.grams);
  mealPer100 = m.per100 ? { ...m.per100 } : null;
  fillMacros(m);
  updatePer100Hint();
  document.getElementById("food-suggestions").innerHTML = "";
}

/* ---------- Alcool : volume, degré, verres standard ---------- */

function toggleAlcoholFields() {
  const on = mealForm().elements.kind.value === "Alcool";
  document.getElementById("alcohol-fields").hidden = !on;
  if (on) updateAlcoholHint();
}
function updateAlcoholHint() {
  const form = mealForm();
  const vol = parseNumber(form.elements.volumeMl.value), abv = parseNumber(form.elements.abv.value);
  const hint = document.getElementById("alcohol-hint");
  if (!vol || !abv || Number.isNaN(vol) || Number.isNaN(abv)) { hint.textContent = "Choisis une boisson ou indique le volume et le degré : les verres standard sont calculés."; return; }
  hint.textContent = `${fmt(standardDrinks(vol, abv), 1)} verre(s) standard (${fmt(alcoholGrams(vol, abv), 0)} g d'alcool pur). Calories estimées si tu ne les connais pas : ${fmt(estimateAlcoholKcal(vol, abv), 0)} kcal.`;
}
/* Volume ou degré modifié : les calories suivent l'estimation (tu peux ensuite les corriger). */
function onAlcoholInput() {
  const form = mealForm();
  const vol = parseNumber(form.elements.volumeMl.value), abv = parseNumber(form.elements.abv.value);
  if (vol && abv && !Number.isNaN(vol) && !Number.isNaN(abv)) setField(form, "kcal", estimateAlcoholKcal(vol, abv));
  updateAlcoholHint();
}
function chooseAlcoholPreset(p) {
  const form = mealForm();
  form.elements.kind.value = "Alcool";
  form.elements.name.value = p.name;
  setField(form, "volumeMl", p.volumeMl);
  setField(form, "abv", p.abv);
  form.elements.grams.value = "";
  form.elements.quantity.value = p.volumeMl >= 500 ? "1 pinte" : "1 verre";
  mealPer100 = null;
  fillMacros({ kcal: p.kcal, protein: 0, carbs: null, fat: 0, fiber: 0 });
  updatePer100Hint();
  toggleAlcoholFields();
}

/* ---------- Photos : réduites à 1 280 px, sans données GPS (audit C1) ---------- */

async function compressPhoto(file) {
  if (!file.type.startsWith("image/")) throw new UserError("Le fichier choisi n'est pas une image.");
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new UserError("Format de photo non pris en charge.")); };
      img.src = url;
    });
  }
  const scale = Math.min(1, 1280 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new UserError("Photo impossible à traiter."))), "image/jpeg", 0.75));
}

/* ---------- Formulaire ---------- */

function resetMealForm() {
  const form = mealForm();
  state.editing.meal = null;
  form.reset();
  form.elements.date.value = state.nutritionDate;
  form.elements.kind.value = defaultMealKind();
  mealPer100 = null;
  mealPhotoFile = null;
  document.getElementById("meal-photo-preview").hidden = true;
  document.getElementById("meal-photo-keep").hidden = true;
  document.getElementById("food-suggestions").innerHTML = "";
  updatePer100Hint();
  toggleAlcoholFields();
  updateMealFormMode();
}
function updateMealFormMode() {
  const editing = Boolean(state.editing.meal);
  document.getElementById("meal-form-title").textContent = editing ? "Modifier l'entrée" : "Ajouter un aliment ou un repas";
  document.getElementById("meal-submit").textContent = editing ? "Enregistrer les modifications" : "Ajouter au journal";
  document.getElementById("meal-cancel").hidden = !editing;
}
function startEditMeal(id) {
  const m = state.dayMeals.find((x) => x.id === id) || state.recentMeals.find((x) => x.id === id);
  if (!m) return;
  const form = mealForm();
  state.editing.meal = id;
  form.elements.date.value = m.date;
  form.elements.kind.value = m.kind;
  form.elements.name.value = m.name;
  form.elements.quantity.value = m.quantity || "";
  setField(form, "grams", m.grams);
  fillMacros(m);
  setField(form, "volumeMl", m.volumeMl);
  setField(form, "abv", m.abv);
  toggleAlcoholFields();
  mealPer100 = m.per100 ? { ...m.per100 } : null;
  mealPhotoFile = null;
  document.getElementById("meal-photo-keep").hidden = !m.photoId;
  form.elements.removePhoto.checked = false;
  updatePer100Hint();
  updateMealFormMode();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function onMealSubmit(event) {
  event.preventDefault();
  await withBusy(event.submitter || document.getElementById("meal-submit"), async () => {
    const form = mealForm();
    const date = form.elements.date.value;
    if (!isValidISO(date)) throw new UserError("Choisis une date valide.");
    const name = readText(form, "name", 120);
    if (!name) throw new UserError("Indique l'aliment ou le repas.");
    const existing = state.editing.meal ? await getRecord(state.editing.meal) : null;
    const record = {
      id: existing ? existing.id : uid(), type: "meal", date, kind: MEAL_KINDS.includes(form.elements.kind.value) ? form.elements.kind.value : "Autre",
      name, quantity: readText(form, "quantity", 60),
      grams: readNumber(form, "grams", { min: 0, max: 5000, decimals: 1, label: "Poids (g)" }),
      kcal: readNumber(form, "kcal", { min: 0, max: 20000, decimals: 0, label: "Calories" }) || 0,
      protein: readNumber(form, "protein", { min: 0, max: 2000, decimals: 1, label: "Protéines" }) || 0,
      carbs: readNumber(form, "carbs", { min: 0, max: 2000, decimals: 1, label: "Glucides" }) || 0,
      fat: readNumber(form, "fat", { min: 0, max: 2000, decimals: 1, label: "Lipides" }) || 0,
      fiber: readNumber(form, "fiber", { min: 0, max: 2000, decimals: 1, label: "Fibres" }) || 0,
      per100: mealPer100, photoId: existing ? existing.photoId || null : null,
      createdAt: existing ? existing.createdAt : undefined
    };
    if (record.kind === "Alcool") {
      assignDefined(record, {
        volumeMl: readNumber(form, "volumeMl", { min: 0, max: 5000, decimals: 0, label: "Volume (ml)" }),
        abv: readNumber(form, "abv", { min: 0, max: 96, decimals: 1, label: "Degré (%)" })
      });
    }
    let photo = null;
    if (mealPhotoFile) {
      photo = { id: uid(), mealId: record.id, blob: await compressPhoto(mealPhotoFile), createdAt: Date.now() };
      record.photoId = photo.id;
    } else if (existing && form.elements.removePhoto.checked) {
      record.photoId = null;
    }
    await saveRecord(record, photo);
    /* Ancienne photo remplacée ou retirée : on la supprime. */
    if (existing && existing.photoId && existing.photoId !== record.photoId) {
      const tx = writeTx("photos"); tx.objectStore("photos").delete(existing.photoId); await txDone(tx);
    }
    const wasEditing = Boolean(existing);
    await reloadMeals();
    resetMealForm();
    renderNutrition();
    showToast(wasEditing ? "Entrée modifiée." : (date === state.nutritionDate ? "Entrée ajoutée." : `Entrée ajoutée au ${fmtDate(date)}.`));
  });
}

async function repeatMeal(id) {
  const m = state.dayMeals.find((x) => x.id === id) || state.recentMeals.find((x) => x.id === id);
  if (!m) return;
  const copy = { ...m, id: uid(), date: today(), photoId: null, createdAt: undefined };
  await saveRecord(copy);
  await reloadMeals();
  renderNutrition();
  showToast("Repas ajouté à aujourd'hui.");
}

function renderNutrition() {
  safeRender("navigation par jour", renderDayNav);
  safeRender("totaux nutrition", renderNutritionTotals);
  safeRender("liste des repas", renderMealList);
}

function setupNutrition() {
  const form = mealForm();
  form.elements.kind.innerHTML = MEAL_KINDS.map((k) => `<option>${esc(k)}</option>`).join("");
  form.addEventListener("submit", onMealSubmit);
  form.elements.kind.addEventListener("change", toggleAlcoholFields);
  form.elements.volumeMl.addEventListener("input", onAlcoholInput);
  form.elements.abv.addEventListener("input", onAlcoholInput);
  const presets = document.getElementById("alcohol-presets");
  presets.innerHTML = ALCOHOL_PRESETS.map((p, i) => `<button type="button" class="food-chip" data-alcohol="${i}">${esc(p.name)} · ${esc(fmt(p.volumeMl, 0))} ml · ${esc(fmt(p.abv, 1))} % · ${esc(fmt(p.kcal, 0))} kcal</button>`).join("");
  presets.addEventListener("click", (e) => {
    const b = e.target.closest("[data-alcohol]");
    if (b) chooseAlcoholPreset(ALCOHOL_PRESETS[Number(b.dataset.alcohol)]);
  });
  form.elements.name.addEventListener("input", renderFoodSuggestions);
  form.elements.grams.addEventListener("input", applyPer100);
  ["kcal", "protein", "carbs", "fat", "fiber"].forEach((k) => form.elements[k].addEventListener("input", () => {
    if (mealPer100) { mealPer100 = null; updatePer100Hint(); }
  }));
  document.getElementById("food-suggestions").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.food) { const f = FOODS.find((x) => x.name === b.dataset.food); if (f) chooseFood(f); }
    if (b.dataset.history) { const m = state.recentMeals.find((x) => x.id === b.dataset.history); if (m) chooseHistoryMeal(m); }
  });
  form.elements.photo.addEventListener("change", (e) => {
    mealPhotoFile = e.target.files[0] || null;
    const preview = document.getElementById("meal-photo-preview");
    if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
    if (mealPhotoFile) {
      const url = URL.createObjectURL(mealPhotoFile);
      preview.dataset.url = url;
      $("img", preview).src = url;
      preview.hidden = false;
    } else preview.hidden = true;
  });
  document.getElementById("meal-cancel").addEventListener("click", resetMealForm);
  document.getElementById("day-prev").addEventListener("click", () => setNutritionDate(addDays(state.nutritionDate, -1)));
  document.getElementById("day-next").addEventListener("click", () => setNutritionDate(addDays(state.nutritionDate, 1)));
  document.getElementById("day-today").addEventListener("click", () => setNutritionDate(today()));
  document.getElementById("day-picker").addEventListener("change", (e) => setNutritionDate(e.target.value));
  document.getElementById("photo-dialog-close").addEventListener("click", () => document.getElementById("photo-dialog").close());
  updatePer100Hint();
}
