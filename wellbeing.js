"use strict";
/* ==========================================================================
   Récupération : check-in quotidien, moyennes sur 7 jours, historique complet.
   ========================================================================== */

const WELL_FIELDS = [
  ["sleep", "Sommeil", "h", LIMITS.sleep, 2], ["sleepQuality", "Qualité du sommeil", "/5", LIMITS.scale5, 0],
  ["water", "Eau", "L", LIMITS.water, 1], ["fatigue", "Fatigue", "/10", LIMITS.scale1, 0],
  ["stress", "Stress", "/10", LIMITS.scale1, 0], ["motivation", "Motivation", "/10", LIMITS.scale1, 0],
  ["alcohol", "Alcool déclaré", "verre(s)", LIMITS.alcohol, 1], ["pain", "Douleur autre", "/10", LIMITS.scale0, 0],
  ["kneeBefore", "Genou avant", "/10", LIMITS.scale0, 1], ["kneeDuring", "Genou pendant", "/10", LIMITS.scale0, 1],
  ["kneeNext", "Genou lendemain", "/10", LIMITS.scale0, 1]
];

async function reloadWellbeing() {
  state.wellbeing = (await getByType("wellbeing")).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}
function wellbeingInRange(fromIso, toIso) { return state.wellbeing.filter((w) => w.date >= fromIso && w.date <= toIso); }

function renderWellbeingAverages() {
  const el = document.getElementById("wellbeing-averages");
  const items = wellbeingInRange(addDays(today(), -6), today());
  if (!items.length) { el.innerHTML = '<p class="empty">Pas de check-in ces 7 derniers jours.</p>'; return; }
  el.innerHTML = `<div class="mini-stats">${WELL_FIELDS.map(([k, label, unit]) => {
    const values = items.map((w) => w[k]);
    if (!values.some((v) => v !== null && v !== undefined)) return "";
    const v = k === "alcohol" ? values.reduce((a, b) => a + (Number(b) || 0), 0) : average(values);
    return `<div><span>${esc(label)}${k === "alcohol" ? " (total)" : ""}</span><b>${fmt(v, 1)} ${esc(unit)}</b></div>`;
  }).join("")}</div><p class="hint">${plural(items.length, "check-in")} sur les 7 derniers jours.</p>`;
}

function renderWellbeingHistory() {
  const el = document.getElementById("wellbeing-history");
  const list = state.wellbeing;
  if (!list.length) { el.innerHTML = '<p class="empty">Aucun check-in enregistré.</p>'; return; }
  const shown = list.slice(0, state.pages.wellbeing * LIST_PAGE_SIZE);
  el.innerHTML = shown.map((w) => {
    const bits = WELL_FIELDS.filter(([k]) => w[k] !== null && w[k] !== undefined).map(([k, label, unit]) => `${label} ${fmt(w[k], 2)} ${unit}`);
    return `<article class="record-item"><div class="record-main"><b>${esc(fmtDate(w.date))}</b><small>${esc(bits.join(" · ") || "Aucune valeur")}</small>${w.notes ? `<p class="record-note">${esc(w.notes)}</p>` : ""}</div>
      <div class="record-actions"><button type="button" class="small-button" data-action="edit-wellbeing" data-id="${esc(w.id)}">Modifier</button><button type="button" class="small-button delete" data-action="delete-record" data-id="${esc(w.id)}">Supprimer</button></div></article>`;
  }).join("") + (list.length > shown.length ? `<button type="button" class="secondary-button" data-action="more" data-list="wellbeing">Afficher plus (${list.length - shown.length} restants)</button>` : "");
}

function wellbeingForm() { return document.getElementById("wellbeing-form"); }
function resetWellbeingForm() {
  const form = wellbeingForm();
  state.editing.wellbeing = null;
  form.reset();
  form.elements.date.value = today();
  document.getElementById("wellbeing-submit").textContent = "Enregistrer mon check-in";
  document.getElementById("wellbeing-cancel").hidden = true;
}
function startEditWellbeing(id) {
  const w = state.wellbeing.find((x) => x.id === id);
  if (!w) return;
  const form = wellbeingForm();
  state.editing.wellbeing = id;
  form.elements.date.value = w.date;
  WELL_FIELDS.forEach(([k]) => setField(form, k, w[k]));
  form.elements.notes.value = w.notes || "";
  document.getElementById("wellbeing-submit").textContent = "Enregistrer les modifications";
  document.getElementById("wellbeing-cancel").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function onWellbeingSubmit(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = wellbeingForm();
    const date = form.elements.date.value;
    if (!isValidISO(date)) throw new UserError("Choisis une date valide.");
    const existing = state.editing.wellbeing ? state.wellbeing.find((x) => x.id === state.editing.wellbeing) : null;
    const record = { id: existing ? existing.id : uid(), type: "wellbeing", date, notes: readText(form, "notes", 2000), createdAt: existing ? existing.createdAt : undefined };
    WELL_FIELDS.forEach(([k, label, , [min, max], decimals]) => { record[k] = readNumber(form, k, { min, max, decimals, label, integer: decimals === 0 }); });
    if (!WELL_FIELDS.some(([k]) => record[k] !== null) && !record.notes) throw new UserError("Renseigne au moins une valeur.");
    await saveRecord(record);
    await reloadWellbeing();
    resetWellbeingForm();
    renderWellbeing();
    showToast(existing ? "Check-in modifié." : "Check-in enregistré.");
  });
}

function renderWellbeing() {
  safeRender("moyennes récupération", renderWellbeingAverages);
  safeRender("historique récupération", renderWellbeingHistory);
}
function setupWellbeing() {
  wellbeingForm().addEventListener("submit", onWellbeingSubmit);
  document.getElementById("wellbeing-cancel").addEventListener("click", resetWellbeingForm);
}
