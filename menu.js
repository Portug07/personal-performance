"use strict";
/* ==========================================================================
   Menu de la journée généré : propose les repas qui restent (petit-déjeuner, déjeuner, collation,
   dîner) pour tomber sur tes calories et tes protéines, uniquement avec ce que tu manges vraiment :
   repas déjà notés, repas habituels, recettes, aliments fréquents. Un repas s'ajoute quand tu le manges.
   ========================================================================== */

const MENU_KEY = "pp-day-menu";
const MENU_SHARE = { "Petit-déjeuner": 0.25, "Déjeuner": 0.35, "Collation": 0.1, "Dîner": 0.3 };
const MENU_KINDS = ["Petit-déjeuner", "Déjeuner", "Collation", "Dîner"];
const MENU_LATEST = { "Petit-déjeuner": 11, "Déjeuner": 15, "Collation": 19, "Dîner": 24 };   // heure limite pour le proposer
let dayMenu = null;            // { date, items: { kind: { option, scale } }, remKcal, remProt }

function menuItemTotals(items) {
  return items.reduce((t, i) => {
    ["kcal", "protein", "carbs", "fat", "fiber"].forEach((k) => { t[k] += Number(i[k]) || 0; });
    return t;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}
/* Une portion peut être ajustée (± 25 %) si tous les aliments ont un poids. */
function scaleItems(items, s) {
  if (s === 1) return items;
  return items.map((i) => ({
    ...i, grams: i.grams ? round(i.grams * s, 0) : i.grams,
    kcal: i.kcal * s, protein: i.protein * s, carbs: i.carbs * s, fat: i.fat * s, fiber: i.fiber * s
  }));
}
/* Propositions possibles pour un moment de la journée. */
function menuUsable(i) { return !isAlcoholEntry(i) && i.name !== "Repas sauté" && Number(i.kcal) > 0; }
function menuOptions(kind) {
  const opts = [];
  const seen = new Set();
  const add = (label, items, source) => {
    const clean = items.filter(menuUsable);
    if (!clean.length) return;
    const sig = comboSignature(clean);
    if (seen.has(sig)) return;
    seen.add(sig);
    opts.push({ label, items: clean.map((i) => cleanMealFields({ ...i, kind })), source, scalable: clean.every((i) => i.grams > 0) });
  };
  state.mealTemplates.filter((t) => t.kind === kind).forEach((t) => add(t.name, t.items, "habituel"));
  /* Repas déjà mangés à ce moment de la journée (60 jours). */
  const from = addDays(today(), -60);
  const groups = new Map();
  state.recentMeals.forEach((m) => {
    if (m.kind !== kind || m.date < from || m.date === today() || !menuUsable(m)) return;
    const k = m.date;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  });
  [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([date, items]) => add(items.length === 1 ? items[0].name : `Comme le ${fmtShortDate(date)}`, items, "déjà mangé"));
  if (kind === "Déjeuner" || kind === "Dîner") {
    state.recipes.forEach((r) => {
      const p = recipePer100(r);
      const last = state.recentMeals.find((m) => fold(m.name) === fold(r.name) && m.grams > 0);
      const g = last ? last.grams : 350;
      add(`${r.name} (recette)`, [{ name: r.name, grams: g, per100: p, kcal: p.kcal * g / 100, protein: p.protein * g / 100, carbs: p.carbs * g / 100, fat: p.fat * g / 100, fiber: p.fiber * g / 100 }], "recette");
    });
  }
  /* Collation : tes aliments fréquents, sauf les plats (plus de 350 kcal la portion) jamais pris en collation. */
  if (kind === "Collation") frequentFoods(12).filter((m) => m.kind === "Collation" || m.kcal <= 350).forEach((m) => add(m.name, [m], "fréquent"));
  return opts;
}
function menuHour() { return new Date().getHours(); }
function remainingKinds() {
  const done = new Set(state.dayMeals.map((m) => m.kind));
  const hour = menuHour();
  return MENU_KINDS.filter((k) => !done.has(k) && (state.nutritionDate !== today() || hour < MENU_LATEST[k]));
}
/* Recherche : beaucoup de combinaisons au hasard, on garde celle qui tombe le plus près des calories
   en couvrant les protéines. fixed = choix à garder (« Autre idée » ne change qu'un repas). */
function planMenu(kinds, remKcal, remProt, fixed = {}, avoid = {}) {
  const options = Object.fromEntries(kinds.map((k) => [k, menuOptions(k)]));
  const usable = kinds.filter((k) => options[k].length);
  if (!usable.length) return null;
  const scales = [0.75, 0.9, 1, 1.1, 1.25];
  const score = (pick) => {
    const t = menuItemTotals(usable.flatMap((k) => scaleItems(pick[k].option.items, pick[k].scale)));
    const kc = Math.abs(t.kcal - remKcal) / Math.max(remKcal, 300);
    const lowP = remProt > 0 ? Math.max(0, remProt - t.protein) / remProt : 0;
    const highP = remProt > 0 ? Math.max(0, t.protein - remProt * 1.4) / remProt : 0;
    /* Chaque repas garde à peu près sa part de la journée. */
    const shareSum = usable.reduce((a, k) => a + MENU_SHARE[k], 0);
    const shares = usable.reduce((a, k) => {
      const kcal = menuItemTotals(scaleItems(pick[k].option.items, pick[k].scale)).kcal;
      return a + Math.abs(kcal - remKcal * MENU_SHARE[k] / shareSum) / Math.max(remKcal, 300);
    }, 0);
    return kc * 2 + lowP * 1.5 + highP * 0.5 + shares * 0.3;
  };
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 600; i++) {
    const pick = {};
    for (const k of usable) {
      if (fixed[k]) { pick[k] = fixed[k]; continue; }
      const list = options[k].filter((o) => !(avoid[k] || []).includes(comboSignature(o.items)));
      const pool = list.length ? list : options[k];
      const option = pool[Math.floor(Math.random() * pool.length)];
      pick[k] = { option, scale: option.scalable ? scales[Math.floor(Math.random() * scales.length)] : 1 };
    }
    const sc = score(pick);
    if (sc < bestScore) { bestScore = sc; best = pick; }
  }
  /* Affinage : repas par repas, on essaie chaque idée et chaque portion en gardant les autres (2 passages). */
  for (let pass = 0; pass < 2; pass++) {
    for (const k of usable) {
      if (fixed[k]) continue;
      const list = options[k].filter((o) => !(avoid[k] || []).includes(comboSignature(o.items)));
      for (const option of (list.length ? list : options[k])) {
        for (const scale of option.scalable ? scales : [1]) {
          const trial = { ...best, [k]: { option, scale } };
          const sc = score(trial);
          if (sc < bestScore - 1e-9) { bestScore = sc; best = trial; }
        }
      }
    }
  }
  return { picks: best, missing: kinds.filter((k) => !options[k].length) };
}
function menuTargets() {
  const g = targetsFor(state.nutritionDate);
  const t = mealTotals(state.dayMeals);
  return { remKcal: g.kcal ? g.kcal - t.kcal : null, remProt: g.protein ? Math.max(0, g.protein - t.protein) : 0 };
}
function generateDayMenu(keepKinds = {}, avoid = {}) {
  const { remKcal, remProt } = menuTargets();
  const kinds = remainingKinds();
  if (remKcal === null) return { error: "Règle d'abord ton objectif de calories (Réglages → Objectifs)." };
  if (!kinds.length) return { error: "Tous les repas de la journée sont déjà notés." };
  if (remKcal < 150) return { error: "Il ne te reste presque plus de calories pour aujourd'hui." };
  const res = planMenu(kinds, remKcal, remProt, keepKinds, avoid);
  if (!res) return { error: "Il me faut un peu d'historique : note tes repas quelques jours, ou crée des repas habituels et des recettes." };
  return { date: state.nutritionDate, picks: res.picks, missing: res.missing, remKcal, remProt };
}
function saveDayMenu() {
  if (!dayMenu || dayMenu.error) return;
  localSet(MENU_KEY, { date: dayMenu.date, picks: Object.fromEntries(Object.entries(dayMenu.picks).map(([k, p]) => [k, { label: p.option.label, items: p.option.items, scale: p.scale, source: p.option.source, scalable: p.option.scalable }])), missing: dayMenu.missing });
}
function loadDayMenu() {
  const saved = localGet(MENU_KEY);
  if (!saved || saved.date !== state.nutritionDate) return null;
  const done = new Set(state.dayMeals.map((m) => m.kind));
  const picks = {};
  Object.entries(saved.picks || {}).forEach(([k, p]) => { if (!done.has(k)) picks[k] = { option: { label: p.label, items: p.items, source: p.source, scalable: p.scalable }, scale: p.scale }; });
  if (!Object.keys(picks).length) return null;
  const { remKcal, remProt } = menuTargets();
  return { date: saved.date, picks, missing: saved.missing || [], remKcal, remProt };
}
function renderDayMenu() {
  const out = document.getElementById("menu-result");
  if (!dayMenu) { out.innerHTML = ""; return; }
  if (dayMenu.error) { out.innerHTML = `<p class="hint">${esc(dayMenu.error)}</p>`; return; }
  const kinds = MENU_KINDS.filter((k) => dayMenu.picks[k]);
  const all = kinds.flatMap((k) => scaleItems(dayMenu.picks[k].option.items, dayMenu.picks[k].scale));
  const t = menuItemTotals(all);
  out.innerHTML = `<p class="menu-total"><b>Total proposé :</b> ${fmt(t.kcal, 0)} kcal pour ${fmt(dayMenu.remKcal, 0)} restantes · ${fmt(t.protein, 0)} g de protéines${dayMenu.remProt ? ` pour ${fmt(dayMenu.remProt, 0)} g` : ""}</p>`
    + kinds.map((k) => {
    const p = dayMenu.picks[k];
    const items = scaleItems(p.option.items, p.scale);
    const tt = menuItemTotals(items);
    return `<div class="gen-item menu-meal">
      <div class="gen-head"><b>${esc(k)}</b><span class="muted">${fmt(tt.kcal, 0)} kcal · P ${fmt(tt.protein, 0)} g</span></div>
      <small class="muted">${esc(p.option.label)}${p.scale !== 1 ? ` · portion × ${esc(fmt(p.scale, 2))}` : ""} (${esc(p.option.source)})</small>
      ${items.map((i) => `<small>${esc(i.name)}${i.grams ? ` · ${fmt(i.grams, 0)} g` : (i.quantity ? ` · ${esc(i.quantity)}` : "")} · ${fmt(i.kcal, 0)} kcal</small>`).join("")}
      <div class="button-row menu-actions">
        <button type="button" class="small-button" data-menu-add="${esc(k)}">Je l'ai mangé : ajouter</button>
        <button type="button" class="small-button" data-menu-other="${esc(k)}">Autre idée</button>
      </div>
    </div>`;
  }).join("")
    + (dayMenu.missing.length ? `<p class="hint">Pas encore d'idée pour : ${esc(dayMenu.missing.join(", ").toLowerCase())} (note-en quelques-uns d'abord).</p>` : "");
}
function openDayMenu() {
  dayMenu = loadDayMenu() || generateDayMenu();
  saveDayMenu();
  renderDayMenu();
  document.getElementById("menu-dialog").showModal();
}
function setupDayMenu() {
  const dialog = document.getElementById("menu-dialog");
  document.getElementById("menu-open").addEventListener("click", openDayMenu);
  document.getElementById("menu-close").addEventListener("click", () => dialog.close());
  document.getElementById("menu-regen").addEventListener("click", () => { dayMenu = generateDayMenu(); saveDayMenu(); renderDayMenu(); });
  document.getElementById("menu-result").addEventListener("click", (e) => {
    const add = e.target.closest("[data-menu-add]");
    const other = e.target.closest("[data-menu-other]");
    if (add) {
      withBusy(add, async () => {
        const k = add.dataset.menuAdd;
        const p = dayMenu.picks[k];
        const created = await addItemsToDay(scaleItems(p.option.items, p.scale), k);
        delete dayMenu.picks[k];
        Object.assign(dayMenu, menuTargets());
        saveDayMenu();
        renderDayMenu();
        showToast(`${k} ajouté (${fmt(itemsKcal(created), 0)} kcal).`, "ok", { label: "Annuler", run: () => undoQuickAdd(created) });
      });
    } else if (other) {
      const k = other.dataset.menuOther;
      const keep = { ...dayMenu.picks };
      const avoidSig = comboSignature(keep[k].option.items);
      delete keep[k];
      const avoid = { [k]: [avoidSig] };
      const res = planMenu(Object.keys(dayMenu.picks), dayMenu.remKcal, dayMenu.remProt, keep, avoid);
      if (res) { dayMenu.picks = res.picks; saveDayMenu(); renderDayMenu(); }
    }
  });
}
