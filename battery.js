"use strict";
/* ==========================================================================
   Batterie de tests (toutes les 4 semaines, conditions identiques) :
   saisie, comparaison avec le premier test (référence) et le précédent.
   Les champs sont définis dans js/data.js (BATTERY_FIELDS).
   ========================================================================== */

function batteryForm() { return document.getElementById("battery-form"); }

async function reloadBattery() {
  state.battery = (await getByType("battery")).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

/* Affichage d'une valeur selon son type : « 8:10 », « 72,5 kg », « 25 », « −5 cm ». */
function fmtBatteryValue(kind, v) {
  if (v === null || v === undefined) return "—";
  if (kind === "time") return fmtDuration(v);
  if (kind === "kg") return `${fmt(v, 2)} kg`;
  if (kind === "cm") return `${fmt(v, 1)} cm`;
  return fmt(v, 0);
}
function fmtBatteryDelta(kind, delta) {
  if (kind === "time") return `${fmtSigned(delta, 0)} s`;
  if (kind === "kg") return `${fmtSigned(delta, 2)} kg`;
  if (kind === "cm") return `${fmtSigned(delta, 1)} cm`;
  return fmtSigned(delta, 0);
}

function renderBatterySummary() {
  const el = document.getElementById("battery-summary");
  const list = state.battery;
  if (!list.length) {
    el.innerHTML = '<p class="empty">Aucun test pour l\'instant. Le premier servira de référence.</p>';
    return;
  }
  const chrono = list.slice().reverse();
  const rows = BATTERY_FIELDS.map(([key, label, kind, direction]) => {
    const values = chrono.filter((t) => t[key] !== null && t[key] !== undefined);
    if (!values.length) return "";
    const ref = values[0], last = values[values.length - 1], prev = values.length > 1 ? values[values.length - 2] : null;
    let delta = "—";
    if (values.length > 1) {
      const d = last[key] - ref[key];
      const cls = d * direction > 0 ? "trend-good" : d * direction < 0 ? "trend-bad" : "";
      delta = `<span class="${cls}">${esc(fmtBatteryDelta(kind, d))}</span>`;
    }
    return `<tr><td>${esc(label)}</td>
      <td>${esc(fmtBatteryValue(kind, ref[key]))} <small>${esc(fmtShortDate(ref.date))}</small></td>
      <td>${prev ? `${esc(fmtBatteryValue(kind, prev[key]))} <small>${esc(fmtShortDate(prev.date))}</small>` : "—"}</td>
      <td><b>${esc(fmtBatteryValue(kind, last[key]))}</b> <small>${esc(fmtShortDate(last.date))}</small></td>
      <td>${delta}</td></tr>`;
  }).join("");
  const next = addDays(list[0].date, 28);
  el.innerHTML = `<table class="data-table"><thead><tr><th>Test</th><th>Référence</th><th>Précédent</th><th>Dernier</th><th>Écart / réf.</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint">Prochain test conseillé : ${esc(fmtDate(next))} (4 semaines après le dernier).</p>`;
}

function renderBatteryHistory() {
  const el = document.getElementById("battery-history");
  if (!state.battery.length) { el.innerHTML = ""; return; }
  el.innerHTML = state.battery.map((t) => {
    const bits = BATTERY_FIELDS.filter(([k]) => t[k] !== null && t[k] !== undefined).map(([k, label, kind]) => `${label} ${fmtBatteryValue(kind, t[k])}`);
    return `<article class="record-item"><div class="record-main"><b>Test du ${esc(fmtDate(t.date))}</b><small>${esc(bits.join(" · "))}</small>${t.notes ? `<p class="record-note">${esc(t.notes)}</p>` : ""}</div>
      <div class="record-actions"><button type="button" class="small-button" data-action="edit-battery" data-id="${esc(t.id)}">Modifier</button><button type="button" class="small-button delete" data-action="delete-record" data-id="${esc(t.id)}">Supprimer</button></div></article>`;
  }).join("");
}

function renderBattery() {
  safeRender("résumé de la batterie de tests", renderBatterySummary);
  safeRender("historique de la batterie de tests", renderBatteryHistory);
}

function resetBatteryForm() {
  const form = batteryForm();
  state.editing.battery = null;
  form.reset();
  form.elements.date.value = today();
  document.getElementById("battery-submit").textContent = "Enregistrer le test";
  document.getElementById("battery-cancel").hidden = true;
}
function startEditBattery(id) {
  const t = state.battery.find((x) => x.id === id);
  if (!t) return;
  const form = batteryForm();
  state.editing.battery = id;
  form.elements.date.value = t.date;
  BATTERY_FIELDS.forEach(([k, , kind]) => {
    if (kind === "time") form.elements[k].value = t[k] !== undefined && t[k] !== null ? fmtDuration(t[k]) : "";
    else setField(form, k, t[k]);
  });
  form.elements.notes.value = t.notes || "";
  document.getElementById("battery-submit").textContent = "Enregistrer les modifications";
  document.getElementById("battery-cancel").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function readBatteryTime(form, name, plainUnit, label) {
  const v = parseDuration(form.elements[name].value, plainUnit);
  if (Number.isNaN(v) || (v !== null && (v <= 0 || v > 86400))) {
    form.elements[name].focus();
    throw new UserError(`« ${label} » : écris par exemple ${plainUnit === "s" ? "1:30 ou 90" : "8:10"}.`);
  }
  return v;
}

async function onBatterySubmit(event) {
  event.preventDefault();
  await withBusy(event.submitter, async () => {
    const form = batteryForm();
    const date = form.elements.date.value;
    if (!isValidISO(date)) throw new UserError("Choisis une date valide.");
    const existing = state.editing.battery ? state.battery.find((x) => x.id === state.editing.battery) : null;
    const record = { id: existing ? existing.id : uid(), type: "battery", date, notes: readText(form, "notes", 1000), createdAt: existing ? existing.createdAt : undefined };
    assignDefined(record, {
      bikeS: readBatteryTime(form, "bikeS", "min", "Vélo 5 km"),
      chestPress8rm: readNumber(form, "chestPress8rm", { min: 0, max: 1000, decimals: 2, label: "Chest press 8 RM" }),
      row8rm: readNumber(form, "row8rm", { min: 0, max: 1000, decimals: 2, label: "Tirage horizontal 8 RM" }),
      pushups: readNumber(form, "pushups", { min: 0, max: 1000, decimals: 0, label: "Pompes", integer: true }),
      plankS: readBatteryTime(form, "plankS", "s", "Planche"),
      backScratchR: readNumber(form, "backScratchR", { min: -100, max: 100, decimals: 1, label: "Mobilité épaule droite" }),
      backScratchL: readNumber(form, "backScratchL", { min: -100, max: 100, decimals: 1, label: "Mobilité épaule gauche" })
    });
    if (!BATTERY_KEYS.some((k) => record[k] !== undefined)) throw new UserError("Renseigne au moins un résultat.");
    await saveRecord(record);
    await reloadBattery();
    resetBatteryForm();
    renderBattery();
    showToast(existing ? "Test modifié." : "Test enregistré.");
  });
}

function setupBattery() {
  batteryForm().addEventListener("submit", onBatterySubmit);
  document.getElementById("battery-cancel").addEventListener("click", resetBatteryForm);
}
