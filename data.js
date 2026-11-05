"use strict";
/* ==========================================================================
   Données de départ (programme, aliments) et contrôle des données importées.
   ========================================================================== */

const APP_VERSION = "3.0.0";
const EXPORT_FORMAT = 3;
const PROGRAM_SCHEMA = 3;
const MEAL_KINDS = ["Petit-déjeuner", "Déjeuner", "Collation", "Dîner", "Boisson", "Alcool", "Autre"];
const WEIGH_IN_MOMENTS = ["Soir, avant séance", "Matin à jeun", "Autre"];

/* Rest-pause : la série vise un total (15), l'échec arrive avant (vers 8), puis une courte pause (20 s)
   et un complément (ex. 8 + 7). La progression se lit sur les reps de la 1re série avant l'échec :
   quand elles atteignent le seuil (12 par défaut), l'application propose d'ajouter le palier. */
const RP_DEFAULTS = { mode: "restpause", target: 15, upAt: 12, rpPause: 20 };

/* Programme par défaut (charges de départ issues de la fiche du coach). Modifiable dans « Réglages ». */
const DEFAULT_PROGRAM = {
  schema: PROGRAM_SCHEMA,
  sessions: [
    {
      id: "push", name: "Push", exercises: [
        { id: "chest-press", name: "Chest press", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [65, 65, 70, 70] },
        { id: "butterfly", name: "Butterfly", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [65, 65, 70, 70] },
        { id: "elevations-laterales", name: "Élévations latérales", sets: 4, ...RP_DEFAULTS, repMin: 10, repMax: 15, increment: 2, loads: [14, 14, 14, 14] },
        { id: "extension-triceps", name: "Extension triceps", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [70, 70, 70, 70] },
        { id: "machine-dips", name: "Machine à dips", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 5, loads: [90, 95, 100, 105] }
      ]
    },
    {
      id: "pull", name: "Pull", exercises: [
        { id: "rowing-machine", name: "Rowing machine", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [65, 65, 70, 70] },
        { id: "tirage-vertical", name: "Tirage vertical", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [70, 70, 70, 70] },
        { id: "tirage-horizontal", name: "Tirage horizontal", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [70, 70, 70, 80] },
        { id: "curl-biceps-machine", name: "Curl biceps machine", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [40, 40, 45, 45] },
        { id: "reverse-butterfly-machine", name: "Reverse butterfly machine", sets: 4, ...RP_DEFAULTS, repMin: 8, repMax: 12, increment: 2.5, loads: [65, 65, 70, 70] }
      ]
    }
  ]
};
const FREE_SESSION_ID = "libre";

/* Alcool : boissons courantes (calories approximatives, alcool + sucres). Modifiables à la saisie. */
const ALCOHOL_PRESETS = [
  { name: "Bière triple", volumeMl: 500, abv: 8.5, kcal: 330 },
  { name: "Bière blonde", volumeMl: 500, abv: 5, kcal: 210 },
  { name: "Vin", volumeMl: 150, abv: 12, kcal: 120 },
  { name: "Spiritueux", volumeMl: 40, abv: 40, kcal: 95 }
];
/* Grammes d'alcool pur : volume × degré × densité de l'éthanol (0,789). Un verre standard = 10 g. */
function alcoholGrams(volumeMl, abv) {
  const v = Number(volumeMl), d = Number(abv);
  return v > 0 && d > 0 ? v * (d / 100) * 0.789 : 0;
}
function standardDrinks(volumeMl, abv) { return alcoholGrams(volumeMl, abv) / 10; }
/* Estimation quand on ne connaît pas l'étiquette : 7 kcal par gramme d'alcool, plus environ 2,5 g de sucres
   pour 100 ml dans les boissons peu alcoolisées (bière, cidre). Indicatif. */
function estimateAlcoholKcal(volumeMl, abv) {
  const grams = alcoholGrams(volumeMl, abv);
  if (!grams) return null;
  const sugars = Number(abv) < 15 ? Number(volumeMl) * 0.025 * 4 : 0;
  return Math.round(grams * 7 + sugars);
}
function isAlcoholEntry(m) { return Boolean(m && (m.kind === "Alcool" || (m.volumeMl && m.abv))); }

/* Batterie de tests figée par le coach : même ordre, mêmes conditions, toutes les 4 semaines.
   [clé, libellé, type d'affichage, sens du progrès (+1 : plus c'est haut mieux c'est ; -1 : plus c'est bas)] */
const BATTERY_FIELDS = [
  ["bikeS", "Vélo 5 km (effort max)", "time", -1],
  ["chestPress8rm", "Chest press 8 RM", "kg", 1],
  ["row8rm", "Tirage horizontal 8 RM", "kg", 1],
  ["pushups", "Pompes (max)", "reps", 1],
  ["plankS", "Planche", "time", 1],
  ["backScratchR", "Mobilité épaule droite", "cm", 1],
  ["backScratchL", "Mobilité épaule gauche", "cm", 1]
];
const BATTERY_KEYS = BATTERY_FIELDS.map(([k]) => k);

/* Durées : « 8:15 », « 8'15 », « 8 min 15 ». Un nombre seul est lu dans l'unité indiquée (« min » ou « s »). */
function parseDuration(value, plainUnit = "min") {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase().replace(",", ".");
  if (!text) return null;
  let m = text.match(/^(\d{1,3})\s*(?::|'|min|mn|m)\s*(\d{1,2})\s*(?:s|")?$/);
  if (m) {
    const sec = Number(m[2]);
    return sec < 60 ? Number(m[1]) * 60 + sec : NaN;
  }
  m = text.match(/^(\d+(?:\.\d+)?)\s*(min|mn|m|s|sec)?$/);
  if (!m) return NaN;
  const unit = m[2] ? (m[2].startsWith("s") ? "s" : "min") : plainUnit;
  return Math.round(Number(m[1]) * (unit === "s" ? 1 : 60));
}
function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "—";
  const s = Math.round(Number(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const DEFAULT_TARGETS = { kcal: null, protein: null, carbs: null, fat: null, fiber: null, weight: null };

/* État de l'application en mémoire (rechargé depuis la base après chaque modification). */
const state = {
  view: "dashboard",
  day: null,                 // date du jour mémorisée, pour détecter le passage à minuit
  program: null,
  targets: { ...DEFAULT_TARGETS },
  workouts: [],              // toutes les séances (légères : quelques Ko chacune)
  measurements: [],
  wellbeing: [],
  battery: [],               // résultats de la batterie de tests (toutes les 4 semaines)
  recentMeals: [],           // repas des 90 derniers jours (suggestions, bilans)
  nutritionDate: null,
  dayMeals: [],              // repas du jour affiché dans « Nutrition »
  editing: { workout: null, meal: null, measurement: null, wellbeing: null, battery: null },
  pages: { workouts: 1, measurements: 1, wellbeing: 1 },
  weightRange: 90,
  progressExercise: null
};

/* Mini-base hors ligne : valeurs moyennes indicatives pour 100 g (ou 100 ml pour les boissons).
   Elles ne remplacent pas l'étiquette du produit. */
const FOODS = [
  ["Skyr nature", 60, 10.5, 3.8, 0.2, 0], ["Fromage blanc 0 %", 49, 7.5, 4.3, 0.2, 0], ["Yaourt nature", 61, 3.5, 4.7, 3.3, 0],
  ["Lait demi-écrémé (100 ml)", 46, 3.3, 4.8, 1.6, 0], ["Œuf entier", 143, 12.6, 0.7, 9.5, 0], ["Blanc d'œuf", 52, 10.9, 0.7, 0.2, 0],
  ["Blanc de poulet cuit", 165, 31, 0, 3.6, 0], ["Escalope de dinde cuite", 135, 29.9, 0, 1.6, 0], ["Steak haché 5 % MG cru", 125, 20.5, 0, 5, 0],
  ["Jambon blanc", 112, 21, 0.8, 3, 0], ["Saumon cuit", 206, 22, 0, 12, 0], ["Cabillaud cuit", 105, 22.8, 0, 0.9, 0],
  ["Thon au naturel égoutté", 116, 25.5, 0, 0.8, 0], ["Emmental", 375, 28.5, 0.5, 28.5, 0],
  ["Riz blanc cuit", 130, 2.7, 28, 0.3, 0.4], ["Pâtes cuites", 158, 5.8, 30.9, 0.9, 1.8], ["Quinoa cuit", 120, 4.4, 21.3, 1.9, 2.8],
  ["Pomme de terre cuite", 87, 1.9, 20.1, 0.1, 1.8], ["Patate douce cuite", 90, 2, 20.7, 0.2, 3.3], ["Lentilles cuites", 116, 9, 20.1, 0.4, 7.9],
  ["Pois chiches cuits", 164, 8.9, 27.4, 2.6, 7.6], ["Flocons d'avoine", 389, 16.9, 66.3, 6.9, 10.6], ["Pain complet", 247, 13, 41, 4.2, 7],
  ["Baguette", 272, 9, 55, 1.5, 3], ["Brocoli cuit", 35, 2.4, 7.2, 0.4, 3.3], ["Haricots verts cuits", 35, 1.9, 7.9, 0.3, 3.2],
  ["Avocat", 160, 2, 8.5, 14.7, 6.7], ["Banane", 89, 1.1, 22.8, 0.3, 2.6], ["Pomme", 52, 0.3, 13.8, 0.2, 2.4],
  ["Orange", 47, 0.9, 11.8, 0.1, 2.4], ["Kiwi", 61, 1.1, 14.7, 0.5, 3], ["Amandes", 579, 21.2, 21.6, 49.9, 12.5],
  ["Beurre de cacahuète", 588, 25, 20, 50, 6], ["Chocolat noir 70 %", 598, 7.8, 45.9, 42.6, 10.9], ["Huile d'olive", 884, 0, 0, 100, 0],
  ["Beurre", 717, 0.9, 0.1, 81, 0], ["Whey en poudre (moyenne, vérifie l'étiquette)", 380, 75, 8, 6, 0],
  ["Bière blonde (100 ml)", 43, 0.5, 3.6, 0, 0], ["Vin rouge (100 ml)", 85, 0.1, 2.6, 0, 0], ["Soda type cola (100 ml)", 42, 0, 10.6, 0, 0]
].map(([name, kcal, protein, carbs, fat, fiber]) => ({ name, per100: { kcal, protein, carbs, fat, fiber } }));

/* ==========================================================================
   Contrôle et nettoyage des données importées (audit C2 et I1).
   Toute entrée est vérifiée champ par champ avant d'être écrite.
   ========================================================================== */

const LIMITS = {
  kcal: [0, 20000], grams: [0, 5000], macro: [0, 2000], weight: [20, 400], cm: [5, 300],
  load: [0, 1000], reps: [0, 1000], duration: [0, 1440], sleep: [0, 24], water: [0, 20],
  scale1: [1, 10], scale0: [0, 10], scale5: [1, 5], alcohol: [0, 100],
  volumeMl: [0, 5000], abv: [0, 96], pause: [0, 600], seconds: [0, 86400], km: [0, 300], level: [0, 100],
  cmSigned: [-100, 100], count: [0, 1000]
};

function cleanNum(value, [min, max], decimals = 2) {
  const n = parseNumber(value);
  if (n === null || Number.isNaN(n) || n < min || n > max) return null;
  return round(n, decimals);
}
function cleanText(value, max = 500) {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, max).trim();
}
function cleanId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
}
function cleanTime(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 8.64e15 ? n : null;
}

/* Une série : charge, reps avant l'échec, et en rest-pause le complément après la pause (rpReps, rpPause en s).
   Les champs de rest-pause n'existent que s'ils sont renseignés : les anciennes séances restent identiques. */
function cleanSets(sets) {
  if (!Array.isArray(sets)) return [];
  return sets.slice(0, 20).map((s) => {
    const out = { load: cleanNum(s && s.load, LIMITS.load, 2), reps: cleanNum(s && s.reps, LIMITS.reps, 0) };
    const rp = cleanNum(s && s.rpReps, LIMITS.reps, 0);
    if (rp) {
      out.rpReps = rp;
      const pause = cleanNum(s.rpPause, LIMITS.pause, 0);
      if (pause !== null) out.rpPause = pause;
    }
    return out;
  });
}
/* Ajoute à « target » les champs renseignés seulement (les entrées restent légères et lisibles). */
function assignDefined(target, values) {
  Object.entries(values).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") target[k] = v; });
  return target;
}
function cleanPer100(p) {
  if (!p || typeof p !== "object") return null;
  const out = {
    kcal: cleanNum(p.kcal, LIMITS.kcal, 1), protein: cleanNum(p.protein, LIMITS.macro, 2), carbs: cleanNum(p.carbs, LIMITS.macro, 2),
    fat: cleanNum(p.fat, LIMITS.macro, 2), fiber: cleanNum(p.fiber, LIMITS.macro, 2)
  };
  return out.kcal === null ? null : out;
}

/* Renvoie { record, photo } nettoyés, ou null si l'entrée est inutilisable. */
function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isValidISO(raw.date)) return null;
  const createdAt = cleanTime(raw.createdAt) || Date.now();
  const base = { id: cleanId(raw.id) || uid(), type: raw.type, date: raw.date, createdAt, updatedAt: cleanTime(raw.updatedAt) || createdAt };
  let photo = null;

  switch (raw.type) {
    case "workout": {
      const exercises = (Array.isArray(raw.exercises) ? raw.exercises : []).slice(0, 40)
        .map((e) => ({ exerciseId: cleanText(e && e.exerciseId, 80) || null, name: cleanText(e && e.name, 80), sets: cleanSets(e && e.sets) }))
        .filter((e) => e.name);
      return {
        record: assignDefined({
          ...base, sessionId: cleanText(raw.sessionId, 80) || null, sessionType: cleanText(raw.sessionType, 60) || "Séance",
          duration: cleanNum(raw.duration, LIMITS.duration, 0), cardio: cleanText(raw.cardio, 200), notes: cleanText(raw.notes, 2000), exercises
        }, {
          bikeKm: cleanNum(raw.bikeKm, LIMITS.km, 2), bikeTimeS: cleanNum(raw.bikeTimeS, LIMITS.seconds, 0),
          bikeLevel: cleanNum(raw.bikeLevel, LIMITS.level, 0), walkKm: cleanNum(raw.walkKm, LIMITS.km, 2)
        }), photo
      };
    }
    case "meal": {
      const record = {
        ...base, kind: MEAL_KINDS.includes(raw.kind) ? raw.kind : "Autre", name: cleanText(raw.name, 120) || "Sans nom",
        quantity: cleanText(raw.quantity, 60), grams: cleanNum(raw.grams, LIMITS.grams, 1),
        kcal: cleanNum(raw.kcal, LIMITS.kcal, 0) || 0, protein: cleanNum(raw.protein, LIMITS.macro, 1) || 0,
        carbs: cleanNum(raw.carbs, LIMITS.macro, 1) || 0, fat: cleanNum(raw.fat, LIMITS.macro, 1) || 0,
        fiber: cleanNum(raw.fiber, LIMITS.macro, 1) || 0, per100: cleanPer100(raw.per100), photoId: cleanId(raw.photoId)
      };
      assignDefined(record, { volumeMl: cleanNum(raw.volumeMl, LIMITS.volumeMl, 0), abv: cleanNum(raw.abv, LIMITS.abv, 1) });
      /* Sauvegarde de la version 1 : la photo était stockée dans l'entrée elle-même. */
      if (typeof raw.photo === "string" && /^data:image\/(jpeg|png|webp|gif);base64,/.test(raw.photo)) {
        try {
          photo = { id: uid(), mealId: record.id, blob: dataURLToBlob(raw.photo), createdAt };
          record.photoId = photo.id;
        } catch { record.photoId = null; }
      }
      return { record, photo };
    }
    case "measurement": {
      return {
        record: {
          ...base, weight: cleanNum(raw.weight, LIMITS.weight, 2), waist: cleanNum(raw.waist, LIMITS.cm, 1),
          belly: cleanNum(raw.belly, LIMITS.cm, 1), chest: cleanNum(raw.chest, LIMITS.cm, 1), arm: cleanNum(raw.arm, LIMITS.cm, 1),
          thigh: cleanNum(raw.thigh, LIMITS.cm, 1), notes: cleanText(raw.notes, 500),
          ...(WEIGH_IN_MOMENTS.includes(raw.moment) ? { moment: raw.moment } : {})
        }, photo
      };
    }
    case "wellbeing": {
      return {
        record: assignDefined({
          ...base, sleep: cleanNum(raw.sleep, LIMITS.sleep, 2), water: cleanNum(raw.water, LIMITS.water, 1),
          fatigue: cleanNum(raw.fatigue, LIMITS.scale1, 0), stress: cleanNum(raw.stress, LIMITS.scale1, 0),
          motivation: cleanNum(raw.motivation, LIMITS.scale1, 0), alcohol: cleanNum(raw.alcohol, LIMITS.alcohol, 1),
          pain: cleanNum(raw.pain, LIMITS.scale0, 0), notes: cleanText(raw.notes, 2000)
        }, {
          sleepQuality: cleanNum(raw.sleepQuality, LIMITS.scale5, 0),
          kneeBefore: cleanNum(raw.kneeBefore, LIMITS.scale0, 1), kneeDuring: cleanNum(raw.kneeDuring, LIMITS.scale0, 1),
          kneeNext: cleanNum(raw.kneeNext, LIMITS.scale0, 1)
        }), photo
      };
    }
    case "battery": {
      const record = assignDefined({ ...base, notes: cleanText(raw.notes, 1000) }, {
        bikeS: cleanNum(raw.bikeS, LIMITS.seconds, 0), chestPress8rm: cleanNum(raw.chestPress8rm, LIMITS.load, 2),
        row8rm: cleanNum(raw.row8rm, LIMITS.load, 2), pushups: cleanNum(raw.pushups, LIMITS.count, 0),
        plankS: cleanNum(raw.plankS, LIMITS.seconds, 0), backScratchR: cleanNum(raw.backScratchR, LIMITS.cmSigned, 1),
        backScratchL: cleanNum(raw.backScratchL, LIMITS.cmSigned, 1)
      });
      return BATTERY_KEYS.some((k) => record[k] !== undefined) ? { record, photo } : null;
    }
    default:
      return null;
  }
}

function normalizeProgram(raw) {
  if (!raw || !Array.isArray(raw.sessions)) return null;
  const sessions = raw.sessions.slice(0, 20).map((s) => {
    const name = cleanText(s && s.name, 40);
    if (!name) return null;
    const exercises = (Array.isArray(s.exercises) ? s.exercises : []).slice(0, 30).map((e) => {
      const exName = cleanText(e && e.name, 80);
      if (!exName) return null;
      const sets = cleanNum(e.sets, [1, 10], 0) || 4;
      const repMin = cleanNum(e.repMin, [1, 100], 0) || 8;
      const repMax = Math.max(repMin, cleanNum(e.repMax, [1, 100], 0) || repMin);
      const loads = (Array.isArray(e.loads) ? e.loads : []).slice(0, 10).map((l) => cleanNum(l, LIMITS.load, 2));
      /* Les programmes des versions 1 et 2 n'ont pas de mode : ils passent en rest-pause (méthode actuelle). */
      const mode = e.mode === "classic" ? "classic" : "restpause";
      const target = cleanNum(e.target, [1, 100], 0) || RP_DEFAULTS.target;
      const upAt = cleanNum(e.upAt, [1, 100], 0) || RP_DEFAULTS.upAt;
      const rpPause = cleanNum(e.rpPause, LIMITS.pause, 0) ?? RP_DEFAULTS.rpPause;
      return { id: cleanId(e.id) || uid(), name: exName, sets, mode, target, upAt, rpPause, repMin, repMax, increment: cleanNum(e.increment, [0, 50], 2) ?? 2.5, loads };
    }).filter(Boolean);
    return { id: cleanId(s.id) || uid(), name, exercises };
  }).filter(Boolean);
  return sessions.length ? { schema: cleanNum(raw.schema, [1, 100], 0) || 2, sessions } : null;
}

/* Programme d'une version précédente : ajoute une seule fois « Reverse butterfly machine » à la séance Pull.
   Si tu le retires ensuite, il ne revient pas (le programme est marqué « schéma 3 »). */
function upgradeProgram(program) {
  if (!program || program.schema >= PROGRAM_SCHEMA) return { program, changed: false };
  const pull = program.sessions.find((s) => s.id === "pull" || fold(s.name) === "pull");
  const def = DEFAULT_PROGRAM.sessions[1].exercises.find((e) => e.id === "reverse-butterfly-machine");
  if (pull && !pull.exercises.some((e) => fold(e.name) === fold(def.name))) pull.exercises.push(JSON.parse(JSON.stringify(def)));
  program.schema = PROGRAM_SCHEMA;
  return { program, changed: true };
}

function normalizeTargets(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  return {
    kcal: cleanNum(t.kcal, [500, 10000], 0), protein: cleanNum(t.protein, [0, 1000], 0), carbs: cleanNum(t.carbs, [0, 2000], 0),
    fat: cleanNum(t.fat, [0, 1000], 0), fiber: cleanNum(t.fiber, [0, 200], 0), weight: cleanNum(t.weight, LIMITS.weight, 1)
  };
}
