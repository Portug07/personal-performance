"use strict";
/* ==========================================================================
   Bibliothèque d'exercices du haut du corps (pas de jambes pour l'instant) et cardio.
   Sert au générateur de séance et au bouton « Remplacer ». Groupes :
   pecs, epaules (avant / latéral), arriere (arrière d'épaule), triceps, dos, biceps, abdos, cardio.
   ========================================================================== */

/* [nom, groupe, matériel, polyarticulaire] */
const EXERCISE_LIBRARY = [
  ["Chest press", "pecs", "machine", true], ["Développé couché", "pecs", "barre", true], ["Développé couché haltères", "pecs", "haltères", true],
  ["Développé incliné haltères", "pecs", "haltères", true], ["Développé incliné machine", "pecs", "machine", true],
  ["Butterfly", "pecs", "machine", false], ["Écarté à la poulie", "pecs", "poulie", false], ["Pompes", "pecs", "poids du corps", true],
  ["Développé militaire haltères", "epaules", "haltères", true], ["Shoulder press machine", "epaules", "machine", true],
  ["Élévations latérales", "epaules", "haltères", false], ["Élévations latérales à la poulie", "epaules", "poulie", false],
  ["Élévations latérales machine", "epaules", "machine", false],
  ["Reverse butterfly machine", "arriere", "machine", false], ["Oiseau haltères", "arriere", "haltères", false], ["Oiseau à la poulie", "arriere", "poulie", false],
  ["Extension triceps", "triceps", "machine", false], ["Extension triceps à la poulie", "triceps", "poulie", false], ["Barre au front", "triceps", "barre", false],
  ["Extension triceps nuque haltère", "triceps", "haltères", false], ["Machine à dips", "triceps", "machine", true], ["Dips", "triceps", "poids du corps", true],
  ["Tirage vertical", "dos", "poulie", true], ["Tirage vertical prise serrée", "dos", "poulie", true], ["Tractions", "dos", "poids du corps", true],
  ["Tirage horizontal", "dos", "poulie", true], ["Rowing machine", "dos", "machine", true], ["Rowing haltère", "dos", "haltères", true],
  ["Rowing barre", "dos", "barre", true], ["Pull-over à la poulie", "dos", "poulie", false],
  ["Curl biceps machine", "biceps", "machine", false], ["Curl haltères", "biceps", "haltères", false], ["Curl marteau", "biceps", "haltères", false],
  ["Curl à la poulie", "biceps", "poulie", false], ["Curl barre EZ", "biceps", "barre", false],
  ["Crunch à la poulie", "abdos", "poulie", false], ["Crunch machine", "abdos", "machine", false], ["Relevés de genoux suspendu", "abdos", "poids du corps", false]
].map(([name, group, equip, compound]) => ({ name, group, equip, compound }));

/* Cardio intégré aux séances : doux pour le genou d'abord (pas de course pour l'instant). */
const CARDIO_OPTIONS = ["Vélo", "Elliptique", "Rameur", "Marche inclinée sur tapis", "Ergomètre à bras"];

const GROUP_LABELS = { pecs: "pectoraux", epaules: "épaules", arriere: "arrière d'épaule", triceps: "triceps", dos: "dos", biceps: "biceps", abdos: "abdos", cardio: "cardio", jambes: "jambes", autre: "autre" };
const GROUP_ROLE = { pecs: "push", epaules: "push", triceps: "push", dos: "pull", biceps: "pull", arriere: "pull", abdos: "core", jambes: "legs", autre: "other" };

/* Groupe d'un exercice : la bibliothèque, sinon des mots du nom (tes exercices à toi). */
function exerciseGroup(name) {
  const key = fold(name);
  const lib = EXERCISE_LIBRARY.find((e) => fold(e.name) === key);
  if (lib) return lib.group;
  const n = ` ${foodWords(name).join(" ")} `;
  const has = (...words) => words.some((w) => n.includes(` ${w}`));
  if (has("squat", "presse a cuisse", "leg", "fente", "mollet", "ischio", "quadri", "soulevé de terre", "souleve de terre", "hip thrust", "adducteur", "abducteur")) return "jambes";
  if (has("reverse", "oiseau", "face pull", "arriere")) return "arriere";
  if (has("curl", "biceps")) return "biceps";
  if (has("triceps", "dips", "barre au front", "kickback")) return "triceps";
  if (has("elevation", "lateral", "militaire", "shoulder", "epaule", "arnold")) return "epaules";
  if (has("chest", "pec", "butterfly", "developpe", "ecarte", "pompe")) return "pecs";
  if (has("tirage", "rowing", "traction", "pull", "lat", "dos")) return "dos";
  if (has("crunch", "abdo", "gainage", "planche", "releve")) return "abdos";
  return "autre";
}
/* Exercices du même groupe : bibliothèque + tes exercices déjà notés ou au programme. */
function alternativesFor(name, exclude = []) {
  const group = exerciseGroup(name);
  const skip = new Set([fold(name), ...exclude.map(fold)]);
  const names = new Map();
  EXERCISE_LIBRARY.filter((e) => e.group === group).forEach((e) => names.set(fold(e.name), e.name));
  knownExerciseNames().filter((n) => exerciseGroup(n) === group).forEach((n) => names.set(fold(n), n));
  return [...names.entries()].filter(([k]) => !skip.has(k)).map(([, n]) => n);
}
function libraryEntry(name) { return EXERCISE_LIBRARY.find((e) => fold(e.name) === fold(name)) || null; }
