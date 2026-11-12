"use strict";
/* ==========================================================================
   Ajout rapide : « Il te reste… » (idées pour finir la journée), repas habituels (plusieurs aliments
   en un appui) et copie des repas de la veille.
   Les repas habituels sont des entrées « mealTemplate » : sauvegardées et synchronisées comme le reste.
   ========================================================================== */

let quickManage = false;        // mode « Gérer » : renommer / supprimer les repas habituels
let templateDraft = null;       // repas habituel en cours de création ou de modification

/* Copie propre d'un aliment pour un repas habituel (sans identifiant, date, ni photo). */
function templateItem(m) {
  return cleanMealFields(m);
}
function itemsKcal(items) { return items.reduce((a, i) => a + (Number(i.kcal) || 0), 0); }

/* Ajoute des aliments au jour affiché. Renvoie les entrées créées (pour « Annuler »). */
async function addItemsToDay(items, kind, date = state.nutritionDate) {
  const created = items.map((i) => ({
    ...cleanMealFields(i), id: uid(), type: "meal", date,
    kind: i.kind === "Alcool" ? "Alcool" : (MEAL_KINDS.includes(kind) ? kind : i.kind), photoId: null
  }));
  await saveRecords(created);
  await reloadMeals();
  renderNutrition();
  return created;
}
async function undoQuickAdd(created) {
  for (const r of created) await deleteRecord(r.id);
  await reloadMeals();
  renderNutrition();
  showToast("Ajout annulé.");
}
function quickAddToast(created) {
  const where = state.nutritionDate === today() ? "aujourd'hui" : `au ${fmtDate(state.nutritionDate)}`;
  showToast(`${plural(created.length, "entrée ajoutée", "entrées ajoutées")} ${where} (${fmt(itemsKcal(created), 0)} kcal).`, "ok",
    { label: "Annuler", run: () => undoQuickAdd(created) });
}

function renderQuickAdd() {
  const list = document.getElementById("quick-templates");
  document.getElementById("templates-manage").textContent = quickManage ? "Terminé" : "Gérer";
  document.getElementById("templates-manage").hidden = !state.mealTemplates.length;
  if (!state.mealTemplates.length) {
    quickManage = false;
    list.innerHTML = `<p class="hint">Aucun repas habituel pour l'instant. Note un repas une fois, puis appuie sur « ★ Habituel » à côté de son nom dans « Entrées du jour » : la prochaine fois, un appui suffira.</p>`;
  } else {
    list.innerHTML = state.mealTemplates.map((t) => `<div class="quick-item">
      <button type="button" class="quick-chip" data-quick="${quickManage ? "edit-template" : "add-template"}" data-id="${esc(t.id)}">
        <b>${esc(t.name)}</b>
        <small>${esc(t.kind)} · ${plural(t.items.length, "aliment")} · ${fmt(itemsKcal(t.items), 0)} kcal · P ${fmt(t.items.reduce((a, i) => a + (i.protein || 0), 0), 0)} g</small>
      </button>
      ${quickManage ? `<button type="button" class="small-button" data-quick="edit-template" data-id="${esc(t.id)}">Modifier</button>` : ""}
    </div>`).join("");
  }
  /* Comme hier : les repas de la veille du jour affiché, par moment de la journée. */
  const prev = state.prevDayMeals;
  const prevDate = addDays(state.nutritionDate, -1);
  document.getElementById("quick-yesterday-title").textContent = state.nutritionDate === today() ? "COMME HIER" : `COMME LA VEILLE (${fmtShortDate(prevDate).toUpperCase()})`;
  const box = document.getElementById("quick-yesterday");
  if (!prev.length) {
    box.innerHTML = `<p class="hint">Rien de noté la veille.</p>`;
    return;
  }
  const kinds = MEAL_KINDS.filter((k) => prev.some((m) => m.kind === k));
  box.innerHTML = kinds.map((k) => {
    const group = prev.filter((m) => m.kind === k);
    return `<button type="button" class="food-chip" data-quick="copy-kind" data-kind="${esc(k)}">${esc(k)} · ${fmt(itemsKcal(group), 0)} kcal</button>`;
  }).join("") + (kinds.length > 1 ? `<button type="button" class="food-chip" data-quick="copy-day">Toute la journée · ${fmt(itemsKcal(prev), 0)} kcal</button>` : "");
}

/* ---------- Fenêtre « repas habituel » (création, renommage, suppression) ---------- */

function openTemplateDialog(draft) {
  templateDraft = draft;
  const dialog = document.getElementById("template-dialog");
  const form = document.getElementById("template-form");
  form.elements.name.value = draft.name;
  form.elements.kind.innerHTML = MEAL_KINDS.filter((k) => k !== "Alcool").map((k) => `<option>${esc(k)}</option>`).join("");
  form.elements.kind.value = MEAL_KINDS.includes(draft.kind) && draft.kind !== "Alcool" ? draft.kind : "Autre";
  document.getElementById("template-dialog-title").textContent = draft.id ? "Modifier le repas habituel" : "Nouveau repas habituel";
  document.getElementById("template-delete").hidden = !draft.id;
  renderTemplateItems();
  dialog.showModal();
}
function renderTemplateItems() {
  const items = templateDraft.items;
  document.getElementById("template-items").innerHTML = items.map((i, k) => `<div class="template-item">
      <span><b>${esc(i.name)}</b><small>${[i.grams ? `${fmt(i.grams, 0)} g` : "", i.quantity, `${fmt(i.kcal, 0)} kcal`].filter(Boolean).map(esc).join(" · ")}</small></span>
      <button type="button" class="link-button danger-text" data-remove-item="${k}" ${items.length < 2 ? "disabled" : ""}>Retirer</button>
    </div>`).join("")
    + `<p class="muted">Total : ${fmt(itemsKcal(items), 0)} kcal</p>`;
}
async function saveTemplateFromDialog() {
  const form = document.getElementById("template-form");
  const name = cleanText(form.elements.name.value, 60);
  if (!name) throw new UserError("Donne un nom à ce repas habituel (ex. « Petit-déj habituel »).");
  const existing = templateDraft.id ? await getRecord(templateDraft.id) : null;
  const record = {
    id: existing ? existing.id : uid(), type: "mealTemplate", date: existing ? existing.date : today(),
    name, kind: form.elements.kind.value, items: templateDraft.items.map(templateItem),
    createdAt: existing ? existing.createdAt : undefined
  };
  await saveRecord(record);
  await reloadMeals();
  renderNutrition();
  document.getElementById("template-dialog").close();
  showToast(existing ? "Repas habituel modifié." : `« ${name} » enregistré : retrouve-le dans « Ajout rapide ».`);
}

async function onQuickClick(e) {
  const btn = e.target.closest("[data-quick]");
  if (!btn) return;
  const action = btn.dataset.quick;
  if (action === "add-template") {
    const t = state.mealTemplates.find((x) => x.id === btn.dataset.id);
    if (!t) return;
    await withBusy(btn, async () => quickAddToast(await addItemsToDay(t.items, t.kind)));
  } else if (action === "edit-template") {
    const t = state.mealTemplates.find((x) => x.id === btn.dataset.id);
    if (t) openTemplateDialog({ id: t.id, name: t.name, kind: t.kind, items: t.items.map((i) => ({ ...i })) });
  } else if (action === "save-template") {
    const kind = btn.dataset.kind;
    const items = state.dayMeals.filter((m) => m.kind === kind);
    if (!items.length) return;
    openTemplateDialog({ id: null, name: `${kind} habituel`, kind, items: items.map((m) => ({ ...m })) });
  } else if (action === "copy-kind") {
    const kind = btn.dataset.kind;
    const items = state.prevDayMeals.filter((m) => m.kind === kind);
    await withBusy(btn, async () => quickAddToast(await addItemsToDay(items, kind)));
  } else if (action === "combo-dismiss") {
    const list = localGet(COMBO_DISMISS_KEY, []) || [];
    list.push(btn.dataset.sig);
    localSet(COMBO_DISMISS_KEY, list.slice(-100));
    renderMealList();
  } else if (action === "copy-day") {
    await withBusy(btn, async () => quickAddToast(await addItemsToDay(state.prevDayMeals, null)));
  }
}

function setupRemaining() {
  document.getElementById("remaining-ideas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remaining]");
    if (b && remainingIdeas[Number(b.dataset.remaining)]) useRemainingIdea(remainingIdeas[Number(b.dataset.remaining)]);
  });
}
function setupQuickMeals() {
  setupRemaining();
  document.getElementById("gaps-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-gap]");
    if (b) withBusy(b, () => onGapClick(b));
  });
  document.getElementById("view-nutrition").addEventListener("click", (e) => { onQuickClick(e).catch((err) => showToast(humanError(err), "error")); });
  document.getElementById("templates-manage").addEventListener("click", () => { quickManage = !quickManage; renderQuickAdd(); });
  const dialog = document.getElementById("template-dialog");
  document.getElementById("template-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(e.submitter, saveTemplateFromDialog);
  });
  document.getElementById("template-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("template-items").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-item]");
    if (!b || templateDraft.items.length < 2) return;
    templateDraft.items.splice(Number(b.dataset.removeItem), 1);
    renderTemplateItems();
  });
  document.getElementById("template-delete").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!templateDraft.id || !confirm("Supprimer ce repas habituel ? Les repas déjà notés restent dans ton journal.")) return;
    await deleteRecord(templateDraft.id);
    await reloadMeals();
    renderNutrition();
    dialog.close();
    showToast("Repas habituel supprimé.");
  }));
}

/* ---------- « Il te reste… » : idées pour finir la journée dans tes objectifs ---------- */

/* Si tu n'as encore rien noté de protéiné : quelques classiques de la mini-base (portions courantes). */
const REMAINING_FALLBACK = [["Skyr nature", 150], ["Fromage blanc 0 %", 150], ["Blanc de poulet cuit", 125], ["Escalope de dinde cuite", 125],
  ["Thon au naturel égoutté", 100], ["Jambon blanc", 80], ["Cabillaud cuit", 150], ["Whey en poudre (moyenne, vérifie l'étiquette)", 30]];
let remainingIdeas = [];

/* Aliments que tu manges souvent, avec ta portion habituelle (la dernière notée). */
function habitualFoods() {
  const count = new Map();
  const last = new Map();
  state.recentMeals.slice().sort(newestFirst).forEach((m) => {
    if (isAlcoholEntry(m) || !(m.kcal > 0)) return;
    const k = fold(m.name);
    count.set(k, (count.get(k) || 0) + 1);
    if (!last.has(k)) last.set(k, m);
  });
  return [...last.entries()].map(([k, m]) => ({
    name: m.name, grams: m.grams || null, per100: m.per100 || null, count: count.get(k),
    kcal: m.kcal, protein: m.protein || 0, carbs: m.carbs || 0, fat: m.fat || 0, fiber: m.fiber || 0, source: m
  }));
}
/* Portion qui rentre dans les calories restantes : la portion habituelle, réduite si besoin (pas en dessous de la moitié). */
function fitPortion(food, remKcal) {
  if (food.kcal <= remKcal) return food;
  if (!food.per100 || !food.grams || !(food.per100.kcal > 0)) return null;
  const grams = Math.floor((remKcal / food.per100.kcal) * 100 / 10) * 10;
  if (grams < food.grams / 2 || grams < 10) return null;
  const f = grams / 100;
  return { ...food, grams, kcal: food.per100.kcal * f, protein: food.per100.protein * f, carbs: food.per100.carbs * f, fat: food.per100.fat * f, fiber: food.per100.fiber * f };
}
function remainingSuggestions(remKcal, remProt) {
  let foods = habitualFoods();
  if (remProt > 0 && foods.filter((f) => f.protein * 4 / f.kcal >= 0.3).length < 3) {
    const known = new Set(foods.map((f) => fold(f.name)));
    REMAINING_FALLBACK.forEach(([name, grams]) => {
      const base = FOODS.find((x) => x.name === name);
      if (!base || known.has(fold(name))) return;
      const k = grams / 100;
      foods.push({ name, grams, per100: base.per100, count: 0, kcal: base.per100.kcal * k, protein: base.per100.protein * k, carbs: base.per100.carbs * k, fat: base.per100.fat * k, fiber: base.per100.fiber * k, fallback: true });
    });
  }
  foods = foods.map((f) => fitPortion(f, remKcal)).filter(Boolean);
  if (remProt > 0) {
    /* Protéines qui manquent, pour le moins de calories possible. D'abord tes aliments vraiment protéinés
       (au moins 30 % des calories en protéines), puis les classiques de la mini-base, puis le reste. */
    const score = (f) => Math.min(f.protein, remProt) / f.kcal + (f.count || 0) * 0.002;
    const rich = (f) => f.protein * 4 / f.kcal >= 0.3;
    const rank = (list) => list.slice().sort((a, b) => score(b) - score(a));
    const usable = foods.filter((f) => f.protein >= 5);
    return [
      ...rank(usable.filter((f) => !f.fallback && rich(f))),
      ...rank(usable.filter((f) => f.fallback)),
      ...rank(usable.filter((f) => !f.fallback && !rich(f)))
    ].slice(0, 4);
  }
  return foods.filter((f) => !f.fallback).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 4);
}
function renderRemaining() {
  const panel = document.getElementById("remaining-panel");
  const g = targetsFor(today());
  if (state.nutritionDate !== today() || !(g.kcal || g.protein)) { panel.hidden = true; remainingIdeas = []; return; }
  panel.hidden = false;
  const t = mealTotals(state.dayMeals);
  const remKcal = g.kcal ? g.kcal - t.kcal : Infinity;
  const remProt = g.protein ? g.protein - t.protein : 0;
  const text = document.getElementById("remaining-text");
  const box = document.getElementById("remaining-ideas");
  /* Menu de la suite de la journée : seulement s'il reste de quoi faire au moins un repas. */
  document.getElementById("menu-open").hidden = !(g.kcal && remKcal >= 150 && remainingKinds().length);
  const parts = [];
  if (g.kcal) parts.push(remKcal > 0 ? `<b>${fmt(remKcal, 0)} kcal</b>` : `<b class="danger-text">${fmt(-remKcal, 0)} kcal de trop</b>`);
  if (g.protein) parts.push(remProt > 0 ? `<b>${fmt(remProt, 0)} g de protéines</b>` : "tes protéines atteintes ✓");
  if (remKcal <= 0 && remProt <= 0) {
    text.innerHTML = `Objectifs du jour atteints : ${parts.join(" · ")}.`;
    box.innerHTML = "";
    remainingIdeas = [];
    return;
  }
  if (remKcal <= 0) {
    text.innerHTML = `Calories atteintes (${parts[0]}). S'il te manque des protéines, un aliment très protéiné et peu calorique limite le dépassement.`;
  } else {
    text.innerHTML = `Il te reste ${parts.join(" et ")}.`;
  }
  remainingIdeas = remainingSuggestions(remKcal > 0 ? remKcal : (remProt > 0 ? 200 : 0), remProt);
  box.innerHTML = remainingIdeas.length
    ? `<p class="hint remaining-hint">${remProt > 0 ? "Idées pour tes protéines sans dépasser tes calories :" : "Idées parmi tes aliments habituels :"}</p>`
      + remainingIdeas.map((f, i) => `<button type="button" class="food-chip remaining-chip" data-remaining="${i}">${esc(f.name)}${f.grams ? ` ${fmt(f.grams, 0)} g` : ""} · ${fmt(f.kcal, 0)} kcal · ${fmt(f.protein, 0)} g P</button>`).join("")
    : "";
}
/* Un appui pré-remplit le formulaire : tu vérifies la portion, puis « Ajouter au journal ». */
function useRemainingIdea(f) {
  const form = mealForm();
  resetMealForm();
  form.elements.name.value = f.name;
  if (f.source) setMealProduct(f.source);
  if (f.per100 && f.grams) {
    mealPer100 = { ...f.per100 };
    setField(form, "grams", f.grams);
    applyPer100();
  } else {
    setField(form, "grams", f.grams);
    fillMacros(f);
  }
  if (f.source && f.source.quantity && (!f.per100 || f.grams === f.source.grams)) form.elements.quantity.value = f.source.quantity;
  updatePer100Hint();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Formulaire pré-rempli : ajuste la portion si besoin, puis « Ajouter au journal ».");
}

/* ---------- Repas habituel repéré tout seul ----------
   Même combinaison d'aliments (au moins 2) au même moment de la journée, 3 fois en 30 jours. */
const COMBO_DISMISS_KEY = "pp-combo-dismissed";
function comboSignature(items) { return items.map((m) => fold(m.name)).sort().join("|"); }
function comboSuggestion(kind, group) {
  if (group.length < 2 || kind === "Alcool") return null;
  const sig = comboSignature(group);
  if ((localGet(COMBO_DISMISS_KEY, []) || []).includes(`${kind}#${sig}`)) return null;
  if (state.mealTemplates.some((t) => comboSignature(t.items) === sig)) return null;
  const from = addDays(state.nutritionDate, -30);
  const byDay = new Map();
  state.recentMeals.forEach((m) => {
    if (m.kind !== kind || m.date === state.nutritionDate || m.date < from) return;
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m);
  });
  const others = [...byDay.values()].filter((list) => comboSignature(list) === sig).length;
  return others >= 2 ? { sig: `${kind}#${sig}`, times: others + 1 } : null;
}

/* ---------- Trous dans le journal ----------
   Hier et avant-hier : un repas principal que tu notes d'habitude manque ? On le signale, avec de quoi
   le compléter en un appui. Rien n'est signalé avant ton premier jour de saisie. */
const GAP_DISMISS_KEY = "pp-gaps-dismissed";
const GAP_KINDS = ["Petit-déjeuner", "Déjeuner", "Dîner"];
let gapItems = [];
function findGaps() {
  const meals = state.recentMeals;
  if (!meals.length) return [];
  const first = meals.reduce((a, m) => (m.date < a ? m.date : a), meals[0].date);
  const days = new Map();
  meals.forEach((m) => { if (!days.has(m.date)) days.set(m.date, new Set()); days.get(m.date).add(m.kind); });
  /* Habitude : ce repas est noté au moins un jour sur deux, sur les 14 derniers jours renseignés. */
  const recent = [...days.keys()].filter((d) => d < today() && d >= addDays(today(), -15));
  const usual = GAP_KINDS.filter((k) => recent.length >= 3 && recent.filter((d) => days.get(d).has(k)).length / recent.length >= 0.5);
  const dismissed = localGet(GAP_DISMISS_KEY, []) || [];
  const gaps = [];
  [1, 2].forEach((n) => {
    const d = addDays(today(), -n);
    if (d <= first) return;
    const kinds = days.get(d) || new Set();
    usual.forEach((k) => { if (!kinds.has(k) && !dismissed.includes(`${d}|${k}`)) gaps.push({ date: d, kind: k }); });
  });
  return gaps;
}
function renderGaps() {
  const panel = document.getElementById("gaps-panel");
  gapItems = findGaps();
  panel.hidden = !gapItems.length;
  if (!gapItems.length) return;
  document.getElementById("gaps-list").innerHTML = gapItems.map((g, i) => {
    const tpl = state.mealTemplates.find((t) => t.kind === g.kind);
    const dayLabel = g.date === addDays(today(), -1) ? "Hier" : "Avant-hier";
    return `<div class="gap-item">
      <span><b>${dayLabel}</b> · pas de ${esc(g.kind.toLowerCase())} noté</span>
      <span class="gap-actions">
        ${tpl ? `<button type="button" class="small-button" data-gap="template" data-i="${i}">${esc(tpl.name)}</button>` : ""}
        <button type="button" class="small-button" data-gap="enter" data-i="${i}">Saisir</button>
        <button type="button" class="small-button" data-gap="skipped" data-i="${i}">Pas mangé</button>
        <button type="button" class="link-button" data-gap="dismiss" data-i="${i}" aria-label="Ne plus le signaler">Ignorer</button>
      </span>
    </div>`;
  }).join("");
}
async function onGapClick(btn) {
  const g = gapItems[Number(btn.dataset.i)];
  if (!g) return;
  const action = btn.dataset.gap;
  if (action === "template") {
    const tpl = state.mealTemplates.find((t) => t.kind === g.kind);
    const created = await addItemsToDay(tpl.items, g.kind, g.date);
    showToast(`${tpl.name} ajouté au ${fmtDate(g.date)}.`, "ok", { label: "Annuler", run: () => undoQuickAdd(created) });
  } else if (action === "skipped") {
    /* Repas sauté : une entrée à 0 kcal, pour que ton coach sache que ce n'est pas un oubli. */
    const created = await addItemsToDay([{ kind: g.kind, name: "Repas sauté", quantity: "pas mangé", kcal: 0 }], g.kind, g.date);
    showToast(`Noté : pas de ${g.kind.toLowerCase()} le ${fmtDate(g.date)}.`, "ok", { label: "Annuler", run: () => undoQuickAdd(created) });
  } else if (action === "enter") {
    await setNutritionDate(g.date);
    const form = mealForm();
    form.elements.kind.value = g.kind;
    form.elements.date.value = g.date;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.name.focus();
  } else if (action === "dismiss") {
    const list = localGet(GAP_DISMISS_KEY, []) || [];
    list.push(`${g.date}|${g.kind}`);
    localSet(GAP_DISMISS_KEY, list.slice(-60));
    renderGaps();
  }
}
