"use strict";
/* ==========================================================================
   Recettes maison : ingrédients pesés crus (Ciqual, tes aliments, code-barres ou saisie à la main),
   poids total une fois cuit (facultatif) → valeurs pour 100 g. Ensuite, la recette se cherche
   comme un aliment : tu pèses ta portion, les calories suivent.
   Les recettes sont des entrées « recipe » : sauvegardées et synchronisées comme le reste.
   ========================================================================== */

const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fiber"];
let recipeDraft = null;          // { id, name, ingredients: [{ name, grams, per100, manual }], cookedGrams, notes }
let recipeFoodCache = {};        // produits déjà scannés (réglage « foodCache »)

/* Totaux des ingrédients (crus) : calories, macros et poids. */
function recipeTotals(ingredients) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, grams: 0 };
  ingredients.forEach((i) => {
    const g = Number(i.grams) || 0;
    t.grams += g;
    NUTRIENTS.forEach((k) => { t[k] += ((i.per100 && Number(i.per100[k])) || 0) * g / 100; });
  });
  return t;
}
/* Valeurs pour 100 g du plat : sur le poids cuit s'il est connu, sinon sur le poids cru. */
function recipePer100(recipe) {
  const t = recipeTotals(recipe.ingredients || []);
  const base = Number(recipe.cookedGrams) || t.grams;
  const out = {};
  NUTRIENTS.forEach((k) => { out[k] = base > 0 ? round(t[k] * 100 / base, k === "kcal" ? 1 : 2) : 0; });
  return out;
}
function per100Text(p) {
  return `${fmt(p.kcal, 0)} kcal · P ${fmt(p.protein, 1)} g · G ${fmt(p.carbs, 1)} g · L ${fmt(p.fat, 1)} g`;
}

/* ---------- Utiliser une recette dans le journal ---------- */

function useRecipe(recipe) {
  switchView("nutrition");
  const form = mealForm();
  chooseFood({ name: recipe.name, per100: recipePer100(recipe) });
  document.getElementById("per100-hint").textContent = `Recette maison : ${fmt(recipePer100(recipe).kcal, 0)} kcal pour 100 g. Pèse ta portion et indique les grammes : les valeurs suivent.`;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.elements.grams.focus();
  form.elements.grams.select();
}

function renderRecipeList() {
  const el = document.getElementById("recipe-list");
  if (!state.recipes.length) {
    el.innerHTML = `<p class="hint">Pour un plat cuisiné maison (bolognaise, curry, gratin…) : note les ingrédients crus et le poids du plat cuit. Ensuite tu pèses ta portion et les calories sont calculées.</p>`;
    return;
  }
  el.innerHTML = state.recipes.map((r) => {
    const p = recipePer100(r);
    return `<article class="record-item">
      <div class="record-main">
        <b>${esc(r.name)}</b>
        <small>Pour 100 g : ${esc(per100Text(p))} · ${plural(r.ingredients.length, "ingrédient")}${r.cookedGrams ? ` · ${fmt(r.cookedGrams, 0)} g cuit` : ""}</small>
      </div>
      <div class="record-actions">
        <button type="button" class="small-button" data-recipe-action="use" data-id="${esc(r.id)}">Utiliser</button>
        <button type="button" class="small-button" data-recipe-action="edit" data-id="${esc(r.id)}">Modifier</button>
      </div>
    </article>`;
  }).join("");
}

/* ---------- Fenêtre de recette ---------- */

async function openRecipeDialog(recipe = null) {
  recipeFoodCache = await getSetting("foodCache", {}).catch(() => ({}));
  /* Table Ciqual chargée en arrière-plan : la recherche se met à jour dès qu'elle est prête. */
  Promise.resolve(loadCiqual()).then(() => { if (document.getElementById("recipe-dialog").open) renderRecipeSuggestions(); });
  recipeDraft = recipe
    ? { id: recipe.id, name: recipe.name, cookedGrams: recipe.cookedGrams ?? null, notes: recipe.notes || "", ingredients: recipe.ingredients.map((i) => ({ name: i.name, grams: i.grams, per100: { ...i.per100 }, manual: false })) }
    : { id: null, name: "", cookedGrams: null, notes: "", ingredients: [] };
  const form = document.getElementById("recipe-form");
  form.elements.name.value = recipeDraft.name;
  form.elements.cookedGrams.value = recipeDraft.cookedGrams ? String(recipeDraft.cookedGrams).replace(".", ",") : "";
  form.elements.notes.value = recipeDraft.notes;
  document.getElementById("recipe-search").value = "";
  document.getElementById("recipe-suggestions").innerHTML = "";
  document.getElementById("recipe-dialog-title").textContent = recipe ? "Modifier la recette" : "Nouvelle recette";
  document.getElementById("recipe-delete").hidden = !recipe;
  renderRecipeIngredients();
  document.getElementById("recipe-dialog").showModal();
}
function numText(v) { return v === null || v === undefined ? "" : String(v).replace(".", ","); }
function renderRecipeIngredients() {
  const el = document.getElementById("recipe-ingredients");
  if (!recipeDraft.ingredients.length) {
    el.innerHTML = `<p class="empty">Ajoute les ingrédients avec la recherche ci-dessous, en indiquant leur poids cru.</p>`;
  } else {
    el.innerHTML = recipeDraft.ingredients.map((i, k) => `<div class="ing-row" data-ing-row="${k}">
      <div class="ing-main">
        ${i.manual
          ? `<input class="ing-name" data-ing="name" value="${esc(i.name)}" maxlength="120" placeholder="Nom de l'ingrédient" aria-label="Ingrédient ${k + 1} : nom">`
          : `<span class="ing-name ing-name-text">${esc(i.name)}</span>`}
        <label class="ing-grams"><input data-ing="grams" inputmode="decimal" autocomplete="off" value="${esc(numText(i.grams))}" placeholder="0" aria-label="Ingrédient ${k + 1} : poids cru en grammes"><span>g</span></label>
        <span class="ing-kcal" data-ing-kcal></span>
        <button type="button" class="link-button danger-text" data-ing-remove aria-label="Retirer cet ingrédient">✕</button>
      </div>
      <details class="ing-per100" ${i.manual ? "open" : ""}>
        <summary data-ing-summary></summary>
        <div class="ing-per100-grid">
          ${NUTRIENTS.map((n) => `<label>${{ kcal: "kcal", protein: "Prot.", carbs: "Gluc.", fat: "Lip.", fiber: "Fibres" }[n]}<input data-p100="${n}" inputmode="decimal" autocomplete="off" value="${esc(numText(i.per100[n]))}" placeholder="0"></label>`).join("")}
        </div>
      </details>
    </div>`).join("");
  }
  refreshRecipeNumbers();
}
/* Met à jour les calories par ligne et le résumé sans redessiner les champs (le clavier reste ouvert). */
function refreshRecipeNumbers() {
  $$("[data-ing-row]", document.getElementById("recipe-ingredients")).forEach((row) => {
    const i = recipeDraft.ingredients[Number(row.dataset.ingRow)];
    const kcal = ((i.per100 && Number(i.per100.kcal)) || 0) * (Number(i.grams) || 0) / 100;
    $("[data-ing-kcal]", row).textContent = `${fmt(kcal, 0)} kcal`;
    $("[data-ing-summary]", row).textContent = i.per100 && i.per100.kcal !== null && i.per100.kcal !== undefined
      ? `Pour 100 g : ${per100Text({ protein: 0, carbs: 0, fat: 0, ...i.per100 })}` : "Pour 100 g : à compléter (kcal au minimum)";
  });
  const t = recipeTotals(recipeDraft.ingredients);
  const cooked = parseNumber(document.getElementById("recipe-form").elements.cookedGrams.value);
  const base = cooked && !Number.isNaN(cooked) && cooked > 0 ? cooked : t.grams;
  const p = recipePer100({ ingredients: recipeDraft.ingredients, cookedGrams: base });
  document.getElementById("recipe-summary").innerHTML = recipeDraft.ingredients.length
    ? `<div><b>Total :</b> ${fmt(t.kcal, 0)} kcal · P ${fmt(t.protein, 0)} g · G ${fmt(t.carbs, 0)} g · L ${fmt(t.fat, 0)} g · ${fmt(t.grams, 0)} g cru${base !== t.grams ? ` → ${fmt(base, 0)} g cuit` : ""}</div>
       <div class="recipe-per100"><b>Pour 100 g :</b> ${esc(per100Text(p))}</div>
       <div class="muted">Exemple : une portion de 300 g = ${fmt(p.kcal * 3, 0)} kcal, ${fmt(p.protein * 3, 0)} g de protéines.</div>`
    : "";
}

/* Recherche d'ingrédients : tes aliments, la mini-base, les produits scannés et la table Ciqual. */
function ingredientSources() {
  const fromHistory = historyFoods().map((m) => {
    if (m.per100) return { name: m.name, per100: m.per100, src: "history" };
    if (m.grams > 0) return { name: m.name, per100: { kcal: m.kcal * 100 / m.grams, protein: m.protein * 100 / m.grams, carbs: m.carbs * 100 / m.grams, fat: m.fat * 100 / m.grams, fiber: m.fiber * 100 / m.grams }, src: "history" };
    return null;
  }).filter(Boolean);
  const scanned = Object.values(recipeFoodCache || {}).filter((p) => p && p.name && p.per100).map((p) => ({ name: p.name, per100: p.per100, src: "scan" }));
  return { fromHistory, scanned };
}
let recipeSuggestions = [];
function renderRecipeSuggestions() {
  const raw = document.getElementById("recipe-search").value;
  const query = foodWords(raw);
  const out = document.getElementById("recipe-suggestions");
  if (fold(raw).length < 2 || !query.length) { out.innerHTML = ""; recipeSuggestions = []; return; }
  const { fromHistory, scanned } = ingredientSources();
  const seen = new Set();
  const keep = (list) => list.filter((f) => { const k = fold(f.name); if (seen.has(k)) return false; seen.add(k); return true; });
  recipeSuggestions = [
    ...keep(searchFoodList(fromHistory, query, 3)), ...keep(searchFoodList(scanned, query, 3)),
    ...keep(searchFoodList(FOODS, query, 3)), ...keep(ciqualFoods ? searchFoodList(ciqualFoods, query, 8) : [])
  ];
  out.innerHTML = recipeSuggestions.map((f, k) => `<button type="button" class="food-chip ${f.words ? "ciqual" : ""}" data-ing-pick="${k}">${esc(f.name)} · ${fmt(f.per100.kcal, 0)} kcal/100 g</button>`).join("")
    || (ciqualFoods ? `<p class="hint">Rien trouvé : essaie un mot plus court, scanne l'emballage, ou ajoute l'ingrédient à la main.</p>` : "");
}
function addIngredient(ing) {
  recipeDraft.ingredients.push({
    name: cleanText(ing.name, 120), grams: ing.grams ?? null, manual: Boolean(ing.manual),
    per100: ing.per100 ? Object.fromEntries(NUTRIENTS.map((n) => [n, ing.per100[n] === null || ing.per100[n] === undefined ? null : round(Number(ing.per100[n]), 2)])) : { kcal: null, protein: null, carbs: null, fat: null, fiber: null }
  });
  renderRecipeIngredients();
  document.getElementById("recipe-search").value = "";
  document.getElementById("recipe-suggestions").innerHTML = "";
  const rows = $$("[data-ing-row]", document.getElementById("recipe-ingredients"));
  const last = rows[rows.length - 1];
  if (last) $(ing.manual ? '[data-ing="name"]' : '[data-ing="grams"]', last).focus();
}

function readRecipeDraft() {
  const form = document.getElementById("recipe-form");
  const name = cleanText(form.elements.name.value, 120);
  if (!name) { form.elements.name.focus(); throw new UserError("Donne un nom à ta recette."); }
  if (!recipeDraft.ingredients.length) throw new UserError("Ajoute au moins un ingrédient.");
  const ingredients = recipeDraft.ingredients.map((i, k) => {
    const label = i.name || `ingrédient ${k + 1}`;
    if (!cleanText(i.name, 120)) throw new UserError(`Ingrédient ${k + 1} : indique son nom.`);
    if (!(Number(i.grams) > 0) || Number(i.grams) > 5000) throw new UserError(`${label} : indique son poids cru en grammes (1 à 5 000).`);
    const per100 = cleanPer100(i.per100);
    if (!per100) throw new UserError(`${label} : indique au moins les kcal pour 100 g (sur l'étiquette).`);
    NUTRIENTS.forEach((n) => { if (per100[n] === null) per100[n] = 0; });
    return { name: cleanText(i.name, 120), grams: round(Number(i.grams), 1), per100 };
  });
  const cookedGrams = readNumber(form, "cookedGrams", { min: 1, max: 50000, decimals: 0, label: "Poids total cuit (g)" });
  return { name, ingredients, cookedGrams, notes: cleanText(form.elements.notes.value, 500) };
}
async function saveRecipeFromDialog() {
  const data = readRecipeDraft();
  const existing = recipeDraft.id ? await getRecord(recipeDraft.id) : null;
  const record = { id: existing ? existing.id : uid(), type: "recipe", date: existing ? existing.date : today(), name: data.name, ingredients: data.ingredients, createdAt: existing ? existing.createdAt : undefined };
  assignDefined(record, { cookedGrams: data.cookedGrams, notes: data.notes });
  await saveRecord(record);
  await reloadMeals();
  renderNutrition();
  document.getElementById("recipe-dialog").close();
  showToast(`Recette « ${data.name} » enregistrée : ${fmt(recipePer100(record).kcal, 0)} kcal pour 100 g.`);
}

function setupRecipes() {
  const dialog = document.getElementById("recipe-dialog");
  const form = document.getElementById("recipe-form");
  document.getElementById("recipe-new").addEventListener("click", () => { openRecipeDialog().catch(console.error); });
  document.getElementById("recipe-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-recipe-action]");
    if (!b) return;
    const r = state.recipes.find((x) => x.id === b.dataset.id);
    if (!r) return;
    if (b.dataset.recipeAction === "use") useRecipe(r);
    else openRecipeDialog(r).catch(console.error);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); withBusy(e.submitter, saveRecipeFromDialog); });
  document.getElementById("recipe-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("recipe-delete").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!recipeDraft.id || !confirm("Supprimer cette recette ? Les repas déjà notés avec elle restent dans ton journal.")) return;
    await deleteRecord(recipeDraft.id);
    await reloadMeals();
    renderNutrition();
    dialog.close();
    showToast("Recette supprimée.");
  }));
  document.getElementById("recipe-search").addEventListener("input", renderRecipeSuggestions);
  document.getElementById("recipe-suggestions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ing-pick]");
    if (!b) return;
    const f = recipeSuggestions[Number(b.dataset.ingPick)];
    if (f) addIngredient({ name: f.name, per100: f.per100, grams: null });
  });
  document.getElementById("recipe-manual").addEventListener("click", () => addIngredient({ name: document.getElementById("recipe-search").value, manual: true }));
  document.getElementById("recipe-scan").addEventListener("click", () => {
    openScanDialog((product) => addIngredient({ name: product.name, per100: product.per100, grams: null, manual: !product.per100 })).catch(console.error);
  });
  const list = document.getElementById("recipe-ingredients");
  list.addEventListener("input", (e) => {
    const row = e.target.closest("[data-ing-row]");
    if (!row) return;
    const ing = recipeDraft.ingredients[Number(row.dataset.ingRow)];
    if (e.target.dataset.ing === "name") ing.name = e.target.value;
    else if (e.target.dataset.ing === "grams") { const v = parseNumber(e.target.value); ing.grams = v === null || Number.isNaN(v) ? null : v; }
    else if (e.target.dataset.p100) { const v = parseNumber(e.target.value); ing.per100[e.target.dataset.p100] = v === null || Number.isNaN(v) ? null : v; }
    refreshRecipeNumbers();
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ing-remove]");
    if (!b) return;
    recipeDraft.ingredients.splice(Number(b.closest("[data-ing-row]").dataset.ingRow), 1);
    renderRecipeIngredients();
  });
  form.elements.cookedGrams.addEventListener("input", refreshRecipeNumbers);
}
