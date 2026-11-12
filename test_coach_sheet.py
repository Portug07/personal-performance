"""Tests de la version 3.6 : fiche « État actuel » du projet coach mise à jour par l'app.
Données fictives (dépôt public).

Usage (depuis le dossier de l'application) :
    python test_coach_sheet.py
"""
import asyncio, difflib, os, socket, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
def free_port():
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0)); return so.getsockname()[1]
PORT = free_port()
BASE = f"http://localhost:{PORT}/"
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("OK   " if cond else "ÉCHEC"), name, ("— " + str(detail)) if detail != "" else "")

BASE_SHEET = """# Fiche État actuel

Dernière mise à jour : 05/10/2026. Mets la date et les valeurs à jour chaque mois.

## Profil

- Âge : 35 ans.
- Poids de référence : 90 kg, mesuré le 1er octobre.
- Tour de taille : 95 cm, au niveau du nombril, le matin à jeun.

## Objectifs en cours

- Objectif principal : perdre du gras en gardant la force.
- Cible calorique et macros : [à définir avec l'agent].

## Entraînement

- Rythme prévu : 3 séances par semaine.
- Rythme réel (app, 4 dernières semaines) : 9,9 séances par semaine (ancienne ligne).

| Séance | Exercice | Repère de charge |
| --- | --- | --- |
| PUSH | Chest press | 50 kg |
| PUSH | Machine à dips | 80 kg (charge poussée, pas d'assistance) |

Note sous le tableau : garder.

## Santé

- Genou : suivi kiné.

## Nutrition et habitudes

- Pas d'aliment X.

## Batterie de tests (toutes les 4 semaines)

- Test 1 : pompes max.
"""

SEED = """(async () => {
  const d = (n) => addDays(today(), -n);
  const rp = (load, reps, rpReps) => ({ load, reps, rpReps, rpPause: 20 });
  const R = [];
  for (let i = 0; i < 8; i++) R.push({ id: 'w' + i, type: 'workout', date: d(2 + i * 3), sessionId: i % 2 ? 'pull' : 'push', sessionType: i % 2 ? 'Pull' : 'Push',
    bikeKm: 5, bikeTimeS: 600 - i, exercises: i % 2 ? [{ name: 'Rowing machine', sets: [rp(60, 10, 4), rp(60, 9, 4)] }]
      : [{ name: 'Chest press', sets: [rp(55, 9, 5), rp(55, 8, 4), rp(57.5, 7, 4), rp(57.5, 6, 3)] }, { name: 'Pompes', bodyweight: true, sets: [{ load: null, reps: 20 }, { load: null, reps: 18 }] }] });
  R.push({ id: 'm1', type: 'measurement', date: d(1), weight: 88.4, moment: 'Matin à jeun' });
  R.push({ id: 'm2', type: 'measurement', date: d(3), weight: 88.9 });
  R.push({ id: 'm3', type: 'measurement', date: d(10), weight: 89.5, waist: 93 });
  R.push({ id: 'k1', type: 'wellbeing', date: d(2), kneeBefore: 2, kneeDuring: 3, kneeNext: 1 });
  R.push({ id: 'b1', type: 'battery', date: d(5), pushups: 30, chestPress8rm: 60 });
  for (let n = 1; n <= 10; n++) R.push({ id: 'f' + n, type: 'meal', date: d(n), kind: 'Déjeuner', name: 'Plat', kcal: 2000, protein: 150, carbs: 0, fat: 0, fiber: 0 });
  R.push({ id: 'a1', type: 'meal', date: d(4), kind: 'Alcool', name: 'Bière', kcal: 215, protein: 0, carbs: 18, fat: 0, fiber: 0, volumeMl: 500, abv: 5 });
  await saveRecords(R);
  const t = { ...state.targets, kcal: 2100, protein: 170 }; await setSetting('targets', t); state.targets = t;
  await reloadAll();
})()"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        ev = page.evaluate
        await page.goto(BASE); await page.wait_for_timeout(1000)
        await ev(SEED)
        t = await ev("frDate(today())")

        # ---------- Sans fiche collée : fiche courte avec les données de l'app ----------
        await page.click("#coach-sheet-open"); await page.wait_for_timeout(300)
        out = await page.input_value("#coach-sheet-output")
        check("Sans fiche de base : on te demande de la coller une fois", await page.is_visible("#coach-sheet-base") and "Colle d'abord" in await page.inner_text("#coach-sheet-status"))
        check("Fiche courte quand même produite (date, tableau, moyennes)", f"Dernière mise à jour : {t}" in out and "| PUSH | Chest press |" in out and "Moyennes (app" in out, out[:300])

        # ---------- Fiche collée ----------
        await page.fill("#coach-sheet-base", BASE_SHEET)
        await page.click("#coach-sheet-save-base"); await page.wait_for_timeout(400)
        out = await page.input_value("#coach-sheet-output")
        lines = out.split("\n")
        check("Fiche enregistrée sur l'appareil, zone de collage refermée", await ev("getSetting('coachSheetBase')") == BASE_SHEET.strip() and not await page.is_visible("#coach-sheet-base"))
        check("Date de mise à jour remplacée, la suite de la phrase gardée", f"Dernière mise à jour : {t}. Mets la date" in out, lines[2])
        w_date = await ev("frDate(addDays(today(), -1))")
        check("Poids de référence : dernière pesée", f"- Poids de référence : 88,4 kg, mesuré le {w_date} (matin à jeun)." in out, [l for l in lines if "Poids de r" in l])
        wa_date = await ev("frDate(addDays(today(), -10))")
        check("Tour de taille : dernière mesure, précisions gardées", f"- Tour de taille : 93 cm (mesuré le {wa_date}), au niveau du nombril, le matin à jeun." in out, [l for l in lines if "Tour de taille" in l])
        check("Cible calorique : objectifs de l'app", "- Cible calorique et macros : 2" in out and "100 kcal · protéines 170 g (réglée dans l'app)." in out, [l for l in lines if "Cible" in l])
        check("Textes personnels gardés", all(x in out for x in ["- Âge : 35 ans.", "- Objectif principal : perdre du gras en gardant la force.", "Note sous le tableau : garder.", "- Genou : suivi kiné.", "- Pas d'aliment X.", "- Test 1 : pompes max."]))
        cp = [l for l in lines if "| Chest press |" in l]
        dips = [l for l in lines if "| Machine à dips |" in l]
        check("Tableau : charges de la dernière séance regroupées", len(cp) == 1 and "2 séries à 55 kg + 2 à 57,5 kg" in cp[0] and "9+5, 8+4, 7+4, 6+3 reps" in cp[0], cp)
        check("Tableau : remarque entre parenthèses de l'ancienne fiche gardée", dips == ["| PUSH | Machine à dips | séries à 90, 95, 100 et 105 kg (charges du programme) (charge poussée, pas d'assistance) |"], dips)
        check("Tableau : tous les exercices du programme, une seule fois", out.count("| Séance | Exercice |") == 1 and len([l for l in lines if l.startswith("| P")]) == 10, len([l for l in lines if l.startswith("| P")]))
        check("Ancienne ligne « (app) » remplacée par la nouvelle", "9,9 séances" not in out and out.count("Rythme réel (app") == 1 and "2 séances par semaine (8 au total)" in out, [l for l in lines if "Rythme" in l])
        sec = out.split("## Entraînement")[1].split("##")[0]
        check("Lignes « (app) » rangées dans leur section, avant le tableau", sec.index("Rythme réel (app") < sec.index("| Séance") and sec.index("- Rythme prévu") < sec.index("Rythme réel"))
        check("Vélo d'échauffement : dernier temps", "Vélo d'échauffement (app) : dernier 5 km en 10:00" in out, [l for l in lines if "Vélo" in l])
        check("Genou : dernier relevé dans Santé", "avant 2/10 · pendant 3/10 · lendemain 1/10" in out.split("## Santé")[1].split("##")[0])
        nut = [l for l in lines if "Moyennes (app" in l]
        check("Moyennes 4 semaines : calories, protéines, alcool", len(nut) == 1 and "10 jours renseignés" in nut[0] and "022 kcal et 150 g" in nut[0] and "alcool 0,5 verre standard" in nut[0], nut)
        bat = out.split("## Batterie de tests")[1]
        check("Batterie : derniers résultats", "Pompes (max) 30" in bat and "Chest press 8 RM 60" in bat, bat[:200])
        check("Tendance du poids dans Profil", "Tendance du poids (app)" in out.split("## Profil")[1].split("##")[0])

        # ---------- Régénérée sur sa propre sortie : stable ----------
        again = await ev("buildCoachSheet(document.getElementById('coach-sheet-output').value)")
        check("Fiche à jour régénérée : identique (pas de lignes en double)", again == out, "\n".join(difflib.unified_diff(out.split("\n"), again.split("\n"), lineterm=""))[:1500])

        # ---------- Copier / télécharger ----------
        await ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        await page.click("#coach-sheet-copy"); await page.wait_for_timeout(300)
        check("Copier : fiche dans le presse-papiers", await ev("navigator.clipboard.readText()") == out)
        async with page.expect_download() as dl:
            await page.click("#coach-sheet-download")
        d = await dl.value
        check("Télécharger : « Fiche État actuel.md »", d.suggested_filename == "Fiche État actuel.md")
        await page.click("#coach-sheet-close")

        # ---------- Sécurité : texte piégé ----------
        await ev("""setSetting('coachSheetBase', '# Fiche\\n\\n- <img src=x onerror="window.pwned=1">')""")
        await page.click("#coach-sheet-open"); await page.wait_for_timeout(300)
        check("Texte de fiche piégé : affiché comme du texte, jamais exécuté", not await ev("window.pwned === 1") and "<img" in await page.input_value("#coach-sheet-output"))
        await page.click("#coach-sheet-close")

        check("Aucune erreur JavaScript", not errors, errors[:5])
        await b.close()
    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} vérifications réussies")
    return passed == len(results)

if __name__ == "__main__":
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        ok = asyncio.run(main())
    finally:
        server.terminate()
    sys.exit(0 if ok else 1)
