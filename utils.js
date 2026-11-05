"use strict";
/* ==========================================================================
   Outils communs : dates, nombres, sécurité de l'affichage, messages.
   Chargé en premier : les autres fichiers s'en servent.
   ========================================================================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function uid() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

/* ---------- Dates (format AAAA-MM-JJ, heure locale, sans dépendre de la langue) ---------- */

function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today() { return isoDate(new Date()); }
function parseISO(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
function isValidISO(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return isoDate(parseISO(iso)) === iso;
}
function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function daysBetween(fromIso, toIso) {
  return Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000);
}
/* Les formateurs sont réutilisés : en créer un à chaque affichage ralentit les longues listes. */
const dateFormatters = new Map();
function fmtDate(iso, options = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!isValidISO(iso)) return "Date inconnue";
  const key = JSON.stringify(options);
  if (!dateFormatters.has(key)) dateFormatters.set(key, new Intl.DateTimeFormat("fr-FR", options));
  return dateFormatters.get(key).format(parseISO(iso));
}
function fmtShortDate(iso) { return fmtDate(iso, { day: "numeric", month: "short" }); }
function fmtDayLabel(iso) {
  const t = today();
  if (iso === t) return "Aujourd'hui";
  if (iso === addDays(t, -1)) return "Hier";
  if (iso === addDays(t, 1)) return "Demain";
  return fmtDate(iso, { weekday: "long", day: "numeric", month: "long" });
}
function fmtWeekday(iso) { return fmtDate(iso, { weekday: "short", day: "numeric" }); }
function mondayOf(iso) {
  const d = parseISO(iso);
  const shift = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - shift);
  return isoDate(d);
}
function timeAgo(timestamp) {
  if (!timestamp) return "jamais";
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} jours`;
}

/* ---------- Nombres ---------- */

/* Convertit une saisie (« 72,5 », « 72.5 », 72.5) en nombre ; renvoie null si vide ou invalide. */
function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (text === "") return null;
  if (!/^-?\d*\.?\d+$/.test(text)) return NaN;
  return Number(text);
}
function round(n, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
/* Affichage français : 1 234,5 ; « — » si absent. */
const numberFormatters = new Map();
function fmt(n, decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  if (!numberFormatters.has(decimals)) numberFormatters.set(decimals, new Intl.NumberFormat("fr-FR", { maximumFractionDigits: decimals, minimumFractionDigits: 0 }));
  return numberFormatters.get(decimals).format(Number(n));
}
function fmtSigned(n, decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = fmt(Math.abs(n), decimals);
  if (round(n, decimals) === 0) return "0";
  return (n > 0 ? "+" : "−") + s;
}
function sum(list, key) { return list.reduce((acc, item) => acc + (Number(item[key]) || 0), 0); }
function average(values) {
  const nums = values.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/* ---------- Textes ---------- */

/* Échappe tout texte inséré dans la page : empêche l'injection de code (audit I1). */
function esc(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
}
/* Minuscules sans accents, pour les recherches (« pates » trouve « Pâtes »). */
function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function plural(n, singular, pluralForm) { return `${fmt(n, 0)} ${Math.abs(n) > 1 ? (pluralForm || singular + "s") : singular}`; }

/* ---------- Messages et erreurs ---------- */

class UserError extends Error {
  constructor(message) { super(message); this.userMessage = message; }
}
function humanError(err) {
  if (err && err.userMessage) return err.userMessage;
  if (err && err.name === "QuotaExceededError") return "Stockage plein : libère de l'espace sur l'appareil ou supprime des photos. Rien n'a été enregistré.";
  return "Une erreur est survenue. Rien n'a été enregistré.";
}
let toastTimer = null;
function showToast(message, kind = "ok") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${kind === "error" ? "toast-error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), kind === "error" ? 5000 : 2800);
}
/* Désactive le bouton pendant l'action : évite les doublons (audit I5) et affiche les erreurs. */
async function withBusy(button, action) {
  if (button && button.disabled) return undefined;
  if (button) button.disabled = true;
  try {
    return await action();
  } catch (err) {
    if (!err || !err.userMessage) console.error(err);
    showToast(humanError(err), "error");
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}
/* Affiche une section même si une donnée est abîmée : une erreur ne bloque plus toute l'application (audit C2). */
function safeRender(name, fn) {
  try { fn(); } catch (err) { console.error(`Affichage « ${name} » :`, err); }
}

/* ---------- Petits stockages de préférences (propres à l'appareil) ---------- */

function localGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function localSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible : sans conséquence */ }
}
function localRemove(key) {
  try { localStorage.removeItem(key); } catch { /* idem */ }
}

/* ---------- Fichiers ---------- */

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL) {
  const comma = dataURL.indexOf(",");
  const head = dataURL.slice(0, comma);
  const mime = (head.match(/^data:([^;,]+)/) || [])[1] || "image/jpeg";
  const binary = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ---------- Formulaires ---------- */

/* Lit un champ numérique d'un formulaire avec contrôle des bornes. */
function readNumber(form, name, { min = 0, max = 100000, decimals = 2, label = name, required = false, integer = false } = {}) {
  const field = form.elements[name];
  const raw = field ? field.value : "";
  const n = parseNumber(raw);
  if (n === null) {
    if (required) throw new UserError(`Renseigne « ${label} ».`);
    return null;
  }
  if (Number.isNaN(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    if (field) field.focus();
    throw new UserError(`« ${label} » : saisis un nombre entre ${fmt(min, 2)} et ${fmt(max, 2)}.`);
  }
  return round(n, decimals);
}
function readText(form, name, max = 500) {
  const field = form.elements[name];
  return field ? String(field.value || "").trim().slice(0, max) : "";
}
function setField(form, name, value) {
  const field = form.elements[name];
  if (!field) return;
  if (field.type === "checkbox") field.checked = Boolean(value);
  else field.value = value === null || value === undefined ? "" : (typeof value === "number" ? String(value).replace(".", ",") : value);
}
