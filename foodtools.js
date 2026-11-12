"use strict";
/* ==========================================================================
   Outils aliments : portions sans balance, conversion cru / cuit, lecture d'une saisie express
   (« 200 g skyr, 50 g flocons d'avoine, 1 banane ») et recherche du meilleur aliment.
   Les poids sont des moyennes courantes : la balance reste plus précise.
   ========================================================================== */

const PORTION_UNITS = [
  { id: "cc", label: "c. à café", plural: "c. à café", grams: 5 },
  { id: "cs", label: "c. à soupe", plural: "c. à soupe", grams: 15 },
  { id: "poignee", label: "poignée", plural: "poignées", grams: 30 },
  { id: "verre", label: "verre", plural: "verres", grams: 200 },
  { id: "bol", label: "bol", plural: "bols", grams: 250 },
  { id: "assiette", label: "assiette", plural: "assiettes", grams: 300 },
  { id: "tranche", label: "tranche", plural: "tranches", grams: null },
  { id: "piece", label: "pièce", plural: "pièces", grams: null },
  { id: "pot", label: "pot", plural: "pots", grams: null }
];
/* Poids d'une portion selon l'aliment (mots du nom, sans accents). Le plus précis d'abord. */
const PORTION_FOODS = [
  [["pomme de terre"], { piece: 150 }], [["pain de mie"], { tranche: 25 }], [["pain au chocolat"], { piece: 60 }],
  [["pate a tartiner", "nutella"], { cc: 7, cs: 20 }], [["fromage blanc"], { cs: 20, pot: 100, bol: 200 }],
  [["huile"], { cc: 4, cs: 10 }], [["beurre"], { cc: 5, cs: 15, tranche: 10 }], [["sucre"], { cc: 5, cs: 12 }],
  [["miel", "confiture"], { cc: 7, cs: 20 }], [["farine"], { cc: 3, cs: 8 }],
  [["flocon", "avoine", "muesli", "cereale"], { cs: 8, bol: 50, poignee: 30 }],
  [["riz", "pate", "semoule", "quinoa", "boulgour", "couscous"], { cs: 20, bol: 200, assiette: 250 }],
  [["creme"], { cc: 5, cs: 15 }], [["skyr", "yaourt", "yogourt"], { cs: 20, pot: 125, bol: 200 }],
  [["lait"], { verre: 200, bol: 250 }], [["baguette"], { tranche: 30, piece: 250 }], [["pain"], { tranche: 35 }],
  [["jambon"], { tranche: 40 }], [["emmental", "comte", "cheddar", "fromage"], { tranche: 20, cs: 7 }],
  [["chocolat"], { piece: 5 }], [["oeuf"], { piece: 55 }], [["banane"], { piece: 120 }], [["pomme"], { piece: 150 }],
  [["orange"], { piece: 150 }], [["clementine", "mandarine"], { piece: 70 }], [["kiwi"], { piece: 75 }], [["poire"], { piece: 150 }],
  [["peche", "nectarine"], { piece: 140 }], [["abricot"], { piece: 45 }], [["fraise"], { piece: 15, bol: 150 }],
  [["tomate"], { piece: 120 }], [["avocat"], { piece: 140 }], [["carotte"], { piece: 80 }], [["biscuit", "galette"], { piece: 10 }],
  [["amande", "noix", "cacahuete", "noisette"], { poignee: 25, piece: 1.2 }], [["steak hache"], { piece: 100 }],
  [["escalope", "filet de poulet", "blanc de poulet"], { piece: 130 }], [["saucisse"], { piece: 60 }],
  [["tortilla", "wrap"], { piece: 60 }], [["croissant"], { piece: 45 }],
  [["biere", "vin", "soda", "jus", "coca"], { verre: 200 }], [["whey", "proteine en poudre"], { cs: 10, piece: 30 }]
];
/* Poids cuit / poids cru (moyennes) : le riz gonfle, la viande perd de l'eau. */
const COOK_FACTORS = [
  [["riz"], 2.6], [["pate", "spaghetti", "tagliatelle", "macaroni", "coquillette", "penne", "fusilli"], 2.3],
  [["semoule", "couscous"], 2.5], [["quinoa"], 2.7], [["boulgour"], 2.6], [["lentille"], 2.5],
  [["pois chiche", "haricot sec", "flageolet"], 2.3],
  [["saumon", "cabillaud", "poisson", "colin", "merlu", "lieu"], 0.8],
  [["boeuf", "steak", "hache", "veau", "porc", "agneau", "poulet", "dinde", "canard", "viande", "saucisse"], 0.75]
];

/* Mot-clé présent en début de mot (« riz » trouve « riz basmati », pas « chorizo »). */
function nameHasWord(name, keyword) {
  const n = ` ${foodWords(name).join(" ")} `;
  return n.includes(` ${foodWords(keyword).join(" ")}`);
}
function findRule(table, name) {
  return table.find(([words]) => words.some((w) => nameHasWord(name, w))) || null;
}

/* ---------- Portions sans balance ---------- */

/* Poids d'une portion : d'abord ce que tu as déjà noté pour cet aliment (« 1 pièce » = 130 g), sinon la table. */
function learnedPortion(name, unitId) {
  const unit = PORTION_UNITS.find((u) => u.id === unitId);
  if (!unit) return null;
  const key = fold(name);
  const re = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${fold(unit.label).replace(/[.]/g, "\\.")}|${fold(unit.plural).replace(/[.]/g, "\\.")})$`);
  for (const m of state.recentMeals) {
    if (fold(m.name) !== key || !m.grams || !m.quantity) continue;
    const q = re.exec(fold(m.quantity));
    if (q) { const n = parseNumber(q[1]); if (n > 0) return m.grams / n; }
  }
  return null;
}
function portionGrams(name, unitId) {
  const learned = learnedPortion(name, unitId);
  if (learned) return learned;
  const rule = findRule(PORTION_FOODS, name);
  if (rule && rule[1][unitId]) return rule[1][unitId];
  const unit = PORTION_UNITS.find((u) => u.id === unitId);
  return unit ? unit.grams : null;
}
function portionLabel(count, unitId) {
  const unit = PORTION_UNITS.find((u) => u.id === unitId);
  if (!unit) return "";
  return `${fmt(count, 2)} ${count > 1 ? unit.plural : unit.label}`;
}

/* ---------- Cru / cuit ---------- */

function cookInfo(name) {
  const rule = findRule(COOK_FACTORS, name);
  if (!rule) return null;
  const n = ` ${foodWords(name).join(" ")} `;
  const raw = /\s(crue?s?|secs?|seches?|seche)\s/.test(n);
  const cooked = /\s(cuite?s?|bouillie?s?|poelee?s?|grillee?s?|rotie?s?|vapeur)\s/.test(n);
  if (raw === cooked) return null;            // ni l'un ni l'autre (ou les deux) : on ne devine pas
  return { factor: rule[1], base: raw ? "raw" : "cooked" };
}
/* Valeurs pour 100 g de ce que tu as réellement pesé (cru ou cuit). */
function per100ForWeighed(per100, info, weighed) {
  if (!per100 || !info || info.base === weighed) return per100;
  const k = info.base === "raw" ? 1 / info.factor : info.factor;
  return Object.fromEntries(Object.entries(per100).map(([key, v]) => [key, v === null ? null : round(v * k, 2)]));
}

/* ---------- Saisie express ---------- */

const EXPRESS_NUMBERS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, demi: 0.5, "½": 0.5 };
const EXPRESS_UNITS = [
  [/^(kg|kilos?)$/, "kg"], [/^(g|gr|grs|grammes?)$/, "g"], [/^(ml|millilitres?)$/, "ml"], [/^cl$/, "cl"], [/^(l|litres?)$/, "l"],
  [/^(cs|cas|cuilleres? a soupe|c a soupe|c\.? a s\.?)$/, "cs"], [/^(cc|cac|cuilleres? a cafe|c a cafe|c\.? a c\.?)$/, "cc"],
  [/^tranches?$/, "tranche"], [/^(pieces?|unites?)$/, "piece"], [/^pots?$/, "pot"], [/^bols?$/, "bol"], [/^verres?$/, "verre"],
  [/^poignees?$/, "poignee"], [/^assiettes?$/, "assiette"], [/^(portions?|parts?)$/, "portion"]
];
const EXPRESS_STOP = new Set(["de", "du", "des", "d", "la", "le", "les", "l", "au", "aux", "a", "avec", "en", "un", "une"]);
/* Découpe le texte en aliments : virgules, retours à la ligne, « et », « + », « puis ». */
function splitExpress(text) {
  /* Virgule = séparateur, sauf dans un nombre (« 1,5 kg »). */
  return String(text || "").split(/\n|;|\+|(?<!\d),|,(?!\d)|\s+et\s+|\s+puis\s+/i).map((s) => s.trim()).filter(Boolean).slice(0, 30);
}
function parseQuantity(token) {
  const t = fold(token).replace(",", ".");
  if (EXPRESS_NUMBERS[t] !== undefined) return EXPRESS_NUMBERS[t];
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}
/* « 200 g de riz », « riz 200g », « 2 tranches de pain », « 1 c. à soupe d'huile », « une banane ». */
function parseExpressItem(item) {
  let words = fold(item).replace(/[’']/g, " ").replace(/(\d)([a-z])/g, "$1 $2").replace(/\.(?!\d)/g, " ")
    .replace(/[^a-z0-9.,/½ ]+/g, " ").split(/\s+/).filter(Boolean);
  let qty = null, unit = null;
  const takeUnit = (from) => {
    for (let len = 4; len >= 1; len--) {
      const parts = words.slice(from, from + len);
      if (parts.length !== len) continue;
      const cand = parts.join(" ");
      const hit = EXPRESS_UNITS.find(([re]) => re.test(cand));
      if (hit) return { unit: hit[1], len };
    }
    return null;
  };
  if (words.length && parseQuantity(words[0]) !== null) {
    qty = parseQuantity(words[0]);
    words = words.slice(1);
    if (words[0] === "demi" || words[0] === "1/2") { qty += 0.5; words = words.slice(1); }
    const u = takeUnit(0);
    if (u) { unit = u.unit; words = words.slice(u.len); }
  } else if (words.length > 1) {
    /* Quantité à la fin : « riz 200 g », « pain 2 tranches ». */
    for (let i = words.length - 1; i >= 1; i--) {
      if (parseQuantity(words[i]) === null) continue;
      const u = takeUnit(i + 1);
      if (i + 1 + (u ? u.len : 0) === words.length) {
        qty = parseQuantity(words[i]); unit = u ? u.unit : null;
        words = words.slice(0, i);
        break;
      }
    }
  }
  while (words.length && EXPRESS_STOP.has(words[0])) words = words.slice(1);
  return { text: item, qty, unit, query: words.filter((w) => !EXPRESS_STOP.has(w)) };
}

/* Candidats pour un aliment tapé : tes aliments d'abord, puis tes recettes, la mini-base et Ciqual. */
function singularWords(words) { return words.map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w)); }
function expressCandidates(query, max = 5) {
  if (!query.length) return [];
  const q = singularWords(query);
  const fromHistory = historyFoods().map((m) => ({
    name: m.name, per100: m.per100 || (m.grams > 0 ? { kcal: m.kcal * 100 / m.grams, protein: m.protein * 100 / m.grams, carbs: m.carbs * 100 / m.grams, fat: m.fat * 100 / m.grams, fiber: m.fiber * 100 / m.grams } : null),
    usualGrams: m.grams || null, portion: m.grams ? null : { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber }, source: m, kind: "history"
  }));
  const fromRecipes = state.recipes.map((r) => ({ name: r.name, per100: recipePer100(r), kind: "recipe" }));
  const fromBase = FOODS.map((f) => ({ name: f.name, per100: f.per100, kind: "base" }));
  const fromCiqual = (ciqualFoods || []).map((f) => ({ name: f.name, per100: f.per100, words: f.words, kind: "ciqual" }));
  const seen = new Set();
  const out = [];
  const push = (list) => list.forEach((f) => { const k = fold(f.name); if (!seen.has(k) && out.length < max) { seen.add(k); out.push(f); } });
  for (const words of [q, q.slice(0, 2), q.slice(0, 1)]) {
    if (!words.length) continue;
    push(searchFoodList(fromHistory, words, 2));
    push(searchFoodList(fromRecipes, words, 2));
    push(searchFoodList(fromBase, words, 2));
    push(searchFoodList(fromCiqual, words, 4));
    if (out.length) break;
  }
  return out;
}
/* Grammes d'une ligne selon la quantité, l'unité et l'aliment retenu. */
function expressGrams(parsed, cand) {
  const { qty, unit } = parsed;
  if (!cand) return null;
  if (unit === "g" || unit === "ml") return qty;
  if (unit === "kg" || unit === "l") return qty * 1000;
  if (unit === "cl") return qty * 10;
  if (unit === "portion") return (cand.usualGrams || 100) * qty;
  if (unit) { const g = portionGrams(cand.name, unit); return g ? g * qty : null; }
  if (qty !== null) {
    /* « 1 banane », « 2 skyrs » : une pièce, sinon ta portion habituelle. */
    const piece = portionGrams(cand.name, "piece") || portionGrams(cand.name, "pot");
    if (piece) return piece * qty;
    if (cand.usualGrams) return cand.usualGrams * qty;
    return qty <= 20 ? null : qty;          // « riz 150 » sans unité : des grammes
  }
  return cand.usualGrams || 100;
}
