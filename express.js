"use strict";
/* ==========================================================================
   Saisie express : « 200 g skyr, 50 g flocons d'avoine, 1 banane » (tapé ou dicté au micro du clavier)
   → l'app reconnaît chaque aliment, propose les grammes, tu vérifies, puis tout est ajouté d'un coup.
   ========================================================================== */

let expressLines = [];          // [{ parsed, candidates, choice, grams }]
let expressTimer = null;

function expressLineValues(line) {
  const c = line.candidates[line.choice];
  if (!c) return null;
  const g = Number(line.grams);
  if (c.per100 && g > 0) {
    const f = g / 100;
    return { kcal: c.per100.kcal * f, protein: (c.per100.protein || 0) * f, carbs: (c.per100.carbs || 0) * f, fat: (c.per100.fat || 0) * f, fiber: (c.per100.fiber || 0) * f };
  }
  if (c.portion) {
    const n = line.parsed.qty || 1;
    return { kcal: c.portion.kcal * n, protein: c.portion.protein * n, carbs: c.portion.carbs * n, fat: c.portion.fat * n, fiber: c.portion.fiber * n };
  }
  return null;
}
function analyseExpress() {
  const text = document.getElementById("express-text").value;
  expressLines = splitExpress(text).map((item) => {
    const parsed = parseExpressItem(item);
    const candidates = expressCandidates(parsed.query);
    const line = { parsed, candidates, choice: 0, grams: null };
    const g = expressGrams(parsed, candidates[0]);
    line.grams = g ? round(g, 0) : null;
    return line;
  });
  renderExpressLines();
}
function renderExpressLines() {
  const el = document.getElementById("express-lines");
  if (!expressLines.length) {
    el.innerHTML = "";
    document.getElementById("express-add").disabled = true;
    document.getElementById("express-add").textContent = "Ajouter";
    return;
  }
  let total = 0, ok = 0;
  el.innerHTML = expressLines.map((line, i) => {
    const v = expressLineValues(line);
    if (v) { total += v.kcal; ok++; }
    const options = line.candidates.map((c, k) => `<option value="${k}" ${k === line.choice ? "selected" : ""}>${esc(c.name)}${c.kind === "recipe" ? " (recette)" : ""}</option>`).join("");
    return `<div class="express-line ${v ? "" : "is-missing"}" data-express="${i}">
      <span class="express-src">« ${esc(line.parsed.text)} »</span>
      ${line.candidates.length
        ? `<select data-express-choice aria-label="Aliment reconnu pour ${esc(line.parsed.text)}">${options}</select>`
        : `<span class="danger-text express-none">Aliment non trouvé : écris-le autrement ou ajoute-le avec le formulaire.</span>`}
      <label class="express-grams"><input data-express-grams inputmode="decimal" autocomplete="off" value="${line.grams === null ? "" : esc(String(line.grams).replace(".", ","))}" placeholder="g" aria-label="Grammes"><span>g</span></label>
      <span class="express-kcal">${v ? `${fmt(v.kcal, 0)} kcal · P ${fmt(v.protein, 0)} g` : (line.candidates.length ? "indique les grammes" : "")}</span>
      <button type="button" class="link-button danger-text" data-express-remove aria-label="Retirer">✕</button>
    </div>`;
  }).join("");
  const btn = document.getElementById("express-add");
  btn.disabled = ok === 0;
  btn.textContent = ok ? `Ajouter ${plural(ok, "aliment")} · ${fmt(total, 0)} kcal` : "Ajouter";
}
async function addExpressLines() {
  const kind = document.getElementById("express-kind").value;
  const date = state.nutritionDate;
  const items = [];
  expressLines.forEach((line) => {
    const c = line.candidates[line.choice];
    const v = expressLineValues(line);
    if (!c || !v) return;
    const { qty, unit } = line.parsed;
    const quantity = unit && !["g", "ml", "kg", "l", "cl"].includes(unit) && unit !== "portion" ? portionLabel(qty || 1, unit)
      : (!unit && qty && qty <= 20 ? `${fmt(qty, 2)} ${qty > 1 ? "pièces" : "pièce"}` : "");
    items.push({
      ...(c.source ? { nutriscore: c.source.nutriscore, nova: c.source.nova, barcode: c.source.barcode } : {}),
      kind, name: c.name, quantity, grams: c.per100 ? Number(line.grams) || null : (c.source && c.source.grams) || null,
      kcal: v.kcal, protein: v.protein, carbs: v.carbs, fat: v.fat, fiber: v.fiber,
      per100: c.per100 ? Object.fromEntries(Object.entries(c.per100).map(([k, x]) => [k, x === null ? null : round(x, 2)])) : null
    });
  });
  if (!items.length) throw new UserError("Aucun aliment complet à ajouter.");
  const skipped = expressLines.length - items.length;
  const created = await addItemsToDay(items, kind, date);
  document.getElementById("express-dialog").close();
  showToast(`${plural(created.length, "entrée ajoutée", "entrées ajoutées")} (${fmt(itemsKcal(created), 0)} kcal)${skipped ? ` · ${plural(skipped, "ligne ignorée", "lignes ignorées")}` : ""}.`, "ok",
    { label: "Annuler", run: () => undoQuickAdd(created) });
}
function openExpressDialog() {
  Promise.resolve(loadCiqual()).then(() => { if (document.getElementById("express-dialog").open && expressLines.length) analyseExpress(); });
  const kind = document.getElementById("express-kind");
  kind.innerHTML = MEAL_KINDS.map((k) => `<option>${esc(k)}</option>`).join("");
  kind.value = mealForm().elements.kind.value || defaultMealKind();
  document.getElementById("express-text").value = "";
  expressLines = [];
  renderExpressLines();
  document.getElementById("express-dialog").showModal();
  document.getElementById("express-text").focus();
}
function setupExpress() {
  const dialog = document.getElementById("express-dialog");
  document.getElementById("express-open").addEventListener("click", openExpressDialog);
  document.getElementById("express-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("express-text").addEventListener("input", () => {
    clearTimeout(expressTimer);
    expressTimer = setTimeout(analyseExpress, 350);
  });
  document.getElementById("express-add").addEventListener("click", (e) => withBusy(e.currentTarget, addExpressLines));
  const lines = document.getElementById("express-lines");
  lines.addEventListener("change", (e) => {
    const row = e.target.closest("[data-express]");
    if (!row || !e.target.matches("[data-express-choice]")) return;
    const line = expressLines[Number(row.dataset.express)];
    line.choice = Number(e.target.value);
    const g = expressGrams(line.parsed, line.candidates[line.choice]);
    line.grams = g ? round(g, 0) : line.grams;
    renderExpressLines();
  });
  lines.addEventListener("input", (e) => {
    const row = e.target.closest("[data-express]");
    if (!row || !e.target.matches("[data-express-grams]")) return;
    const v = parseNumber(e.target.value);
    expressLines[Number(row.dataset.express)].grams = v === null || Number.isNaN(v) ? null : v;
    const line = expressLines[Number(row.dataset.express)];
    const vals = expressLineValues(line);
    $(".express-kcal", row).textContent = vals ? `${fmt(vals.kcal, 0)} kcal · P ${fmt(vals.protein, 0)} g` : "indique les grammes";
    row.classList.toggle("is-missing", !vals);
    let total = 0, ok = 0;
    expressLines.forEach((l) => { const x = expressLineValues(l); if (x) { total += x.kcal; ok++; } });
    const btn = document.getElementById("express-add");
    btn.disabled = ok === 0;
    btn.textContent = ok ? `Ajouter ${plural(ok, "aliment")} · ${fmt(total, 0)} kcal` : "Ajouter";
  });
  lines.addEventListener("click", (e) => {
    const b = e.target.closest("[data-express-remove]");
    if (!b) return;
    expressLines.splice(Number(b.closest("[data-express]").dataset.express), 1);
    renderExpressLines();
  });
}
