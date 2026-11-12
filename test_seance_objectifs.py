"""Tests de la version 3.8 : plusieurs pauses rest-pause par série (8+5+3), écran noir du mode séance,
bips écran verrouillé, objectifs selon la journée (complet / semi / sans sport). Données fictives.

Usage (depuis le dossier de l'application) :
    python test_seance_objectifs.py
"""
import asyncio, os, socket, subprocess, sys, time
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

SEED = """(async () => {
  const d = (n) => addDays(today(), -n);
  const rp = (load, reps, rpReps, rpExtra) => ({ load, reps, rpReps, rpPause: 20, ...(rpExtra ? { rpExtra } : {}) });
  await saveRecords([{ id: 'w1', type: 'workout', date: d(3), sessionId: 'push', sessionType: 'Push', exercises: [
    { name: 'Chest press', sets: [rp(70, 9, 5, [3]), rp(70, 8, 4), rp(70, 7, 4), rp(70, 6, 3)] },
    { name: 'Butterfly', sets: [rp(65, 10, 5), rp(65, 9, 4)] }] }]);
  await reloadAll(); renderSessionOptions(); resetWorkoutForm();
})()"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        await ctx.add_init_script("window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; };")
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        ev = page.evaluate
        await page.goto(BASE); await page.wait_for_timeout(1000)
        await ev(SEED)

        # ================= Plusieurs pauses rest-pause dans une série =================
        check("Données : 8 + 5 + 3 gardé (rpExtra), un complément sans 1re pause ignoré",
              await ev("[cleanSets([{ load: 70, reps: 8, rpReps: 5, rpExtra: [3, '2', 0, 9] }])[0], cleanSets([{ load: 70, reps: 8, rpExtra: [3] }])[0]]")
              == [{"load": 70, "reps": 8, "rpReps": 5, "rpExtra": [3, 2]}, {"load": 70, "reps": 8}])
        check("Affichage « 70 × 9+5+3 », reps totales 17", await ev("[fmtSet({ load: 70, reps: 9, rpReps: 5, rpExtra: [3] }, false), totalReps({ reps: 9, rpReps: 5, rpExtra: [3] })]") == ["70\u00a0×\u00a09+5+3", 17])
        await page.click("button[data-view=training]"); await page.wait_for_timeout(200)
        await ev("workoutForm().elements.session.value='push'; workoutForm().elements.session.dispatchEvent(new Event('change'))"); await page.wait_for_timeout(200)
        row = page.locator(".exercise-block").nth(0).locator(".set-row").nth(0)
        check("Formulaire : ligne « pauses suivantes » cachée tant que le 1er complément est vide", not await row.locator(".set-more").is_visible())
        await row.locator('[data-field="reps"]').fill("9"); await row.locator('[data-field="rp"]').fill("5")
        await page.wait_for_timeout(100)
        check("1er complément noté : « + pause RP » proposé", await row.locator(".set-add-rp").is_visible() and not await row.locator('[data-field="rp2"]').is_visible())
        await row.locator(".set-add-rp").click(); await page.wait_for_timeout(100)
        check("« + pause RP » : case RP2 ouverte, curseur dedans, avec ton chiffre de la dernière fois en gris",
              await row.locator('[data-field="rp2"]').is_visible() and await ev("document.activeElement.dataset.field") == "rp2" and await row.locator('[data-field="rp2"]').get_attribute("placeholder") == "3")
        await row.locator('[data-field="rp2"]').fill("3")
        await row.locator(".set-add-rp").click(); await page.wait_for_timeout(100)
        check("Encore « + pause RP » : RP3, puis plus de bouton (3 pauses max)", await row.locator('[data-field="rp3"]').is_visible() and not await row.locator(".set-add-rp").is_visible())
        await row.locator('[data-field="rp3"]').fill("2")
        s0 = await ev("readEditor()[0].sets[0]")
        check("Lecture : 9 + 5 + 3 + 2", s0 == {"load": 70, "reps": 9, "rpReps": 5, "rpPause": 20, "rpExtra": [3, 2]}, s0)
        await row.locator('[data-field="rp2"]').fill("")
        err = await ev("(() => { try { readEditor(); return ''; } catch (e) { return e.message; } })()")
        check("RP3 sans RP2 : refusé avec un message clair", "dans l'ordre" in err, err)
        await row.locator('[data-field="rp2"]').fill("3")
        await page.wait_for_timeout(500)
        await page.reload(); await page.wait_for_timeout(1200)
        await page.click("button[data-view=training]"); await page.wait_for_timeout(200)
        check("Brouillon : les pauses suivantes sont gardées après fermeture de l'app", await ev("readEditor()[0].sets[0].rpExtra") == [3, 2] and await page.locator(".exercise-block >> nth=0 >> .set-row >> nth=0 >> [data-field=rp3]").is_visible())

        # Mode séance : « encore une pause »
        await ev("resetWorkoutForm(); workoutForm().elements.session.value='push'; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.click("#session-open"); await page.wait_for_timeout(300)
        await page.click("[data-sm-action=fail]"); await page.wait_for_timeout(150)
        check("Mode séance : après l'échec, « encore une pause » proposé", await page.locator("[data-sm-action=more-rp]").count() == 1)
        await page.click("[data-sm-action=more-rp]"); await page.wait_for_timeout(200)
        state1 = await ev("[readEditor()[0].sets[0], document.getElementById('sm-timer-label').textContent, document.querySelector('.sm-current .eyebrow').textContent, !!document.querySelector('[data-sm-field=rp2]'), sm.set]")
        check("« Encore une pause » : 1er complément noté, nouvelle pause RP, complément 2 attendu sur la même série",
              state1[0]["rpReps"] == 5 and state1[1] == "Pause RP" and "COMPLÉMENT 2" in state1[2] and state1[3] and state1[4] == 0, state1)
        await page.click("[data-sm-action=done-rp]"); await page.wait_for_timeout(200)
        s1 = await ev("readEditor()[0].sets[0]")
        check("Complément 2 fait → repos : 9 + 5 + 3 notés (chiffres de la dernière fois), série 2 active",
              s1.get("rpExtra") == [3] and s1["rpReps"] == 5 and await page.inner_text("#sm-timer-label") == "Repos" and await ev("sm.set") == 1, s1)
        check("Liste des séries du mode séance : « 70 kg × 9 + 5 + 3 »", "9 + 5 + 3" in await page.inner_text("#sm-sets"))

        # ================= Écran noir du mode séance =================
        await ev("smDim()"); await page.wait_for_timeout(100)
        dim = await ev("[!document.getElementById('sm-dim').hidden, document.getElementById('sm-dim-label').textContent, /\\d:\\d\\d/.test(document.getElementById('sm-dim-time').textContent)]")
        check("Écran noir : le décompte du repos reste lisible en gris", dim == [True, "Repos", True], dim)
        set_before = await ev("sm.set")
        await page.mouse.click(195, 820); await page.wait_for_timeout(150)
        check("Un appui rallume, sans déclencher le bouton du dessous", await ev("document.getElementById('sm-dim').hidden") and await ev("sm.set") == set_before and await ev("readEditor()[0].sets[1].reps") is None)
        await ev("smDim()")
        await ev("restTimer.end = Date.now() - 10; tickRestTimer()"); await page.wait_for_timeout(100)
        check("Fin du repos : l'écran se rallume tout seul sur la série suivante", await ev("document.getElementById('sm-dim').hidden"))
        await page.click("#sm-dim-toggle"); await page.wait_for_timeout(100)
        await ev("smDim()")
        check("Option « Écran noir : non » : l'écran reste normal", await ev("document.getElementById('sm-dim').hidden") and "non" in await page.inner_text("#sm-dim-toggle"))
        await page.click("#sm-dim-toggle")
        check("Écran noir programmé après 15 s sans toucher l'écran", await ev("smIdleTimer !== null && SM_DIM_AFTER_MS") == 15000)
        await page.click("#sm-close"); await page.wait_for_timeout(200)

        # ================= Bips écran verrouillé =================
        await page.check("#rest-locked")
        await ev("startRestTimer(30, 'Repos')")
        check("Option « sonner écran verrouillé » : son continu pendant le décompte, bips de fin programmés d'avance",
              await ev("restTimer.keep !== null && restTimer.nodes.length === 3"))
        await page.click("#rest-stop")
        check("Arrêt : son continu coupé", await ev("restTimer.keep === null && restTimer.nodes.length === 0"))
        await page.uncheck("#rest-locked")
        await ev("startRestTimer(30, 'Repos')")
        check("Sans l'option : pas de son continu (la musique n'est pas touchée)", await ev("restTimer.keep === null"))
        await page.click("#rest-stop")

        # ================= Objectifs selon la journée =================
        await ev("resetWorkoutForm()")
        await ev("(async () => { const t = normalizeTargets({ kcal: 2300, protein: 170, carbs: 250, fat: 70, fiber: 30, weight: 80 }); await setSetting('targets', t); state.targets = t; })()")
        await page.click("button[data-view=dashboard]"); await page.wait_for_timeout(200)
        check("Sans objectifs par journée : un seul objectif, pas de barre « Journée »", await page.inner_text("#dash-daytype") == "" and "/ 2" in await page.inner_text("#dash-cards") and await ev("targetsFor(today()).kcal") == 2300)
        await page.click("button[data-view=settings]"); await page.wait_for_timeout(200)
        await page.fill("#day-targets-form [name=full-protein]", "170")
        await page.click("#day-targets-form button[type=submit]"); await page.wait_for_timeout(200)
        check("Ligne sans calories : refusée", "au moins les calories" in await page.inner_text("#toast"))
        vals = {"full": [2500, 170, 290, 75], "semi": [2250, 170, 240, 70], "rest": [2000, 170, 190, 65]}
        for k, v in vals.items():
            for m, x in zip(["kcal", "protein", "carbs", "fat"], v):
                await page.fill(f"#day-targets-form [name={k}-{m}]", str(x))
        await page.click("#day-targets-form button[type=submit]"); await page.wait_for_timeout(300)
        tg = await ev("getSetting('targets')")
        check("Réglages : 3 jeux d'objectifs enregistrés (fibres et poids cible gardés)", tg["days"]["full"] == {"kcal": 2500, "protein": 170, "carbs": 290, "fat": 75} and tg["days"]["rest"]["kcal"] == 2000 and tg["fiber"] == 30 and tg["weight"] == 80, tg)
        await page.fill("#targets-form [name=fiber]", "32"); await page.click("#targets-form button[type=submit]"); await page.wait_for_timeout(300)
        check("Modifier les objectifs du haut garde les objectifs par journée", (await ev("getSetting('targets')")).get("days", {}).get("semi", {}).get("kcal") == 2250)

        await page.click("button[data-view=dashboard]"); await page.wait_for_timeout(200)
        bar = await page.inner_text("#dash-daytype")
        check("Accueil, rien de noté aujourd'hui : journée sans sport, 2 000 kcal", "Sans sport" in bar and "(auto)" in bar and "/ 2\u202f000" in (await page.inner_text("#dash-cards")).replace("\u00a0", "\u202f"), (bar, await page.inner_text("#dash-cards")))
        await ev("""(async () => { await saveRecord({ id: 'wt', type: 'workout', date: today(), sessionId: 'push', sessionType: 'Push', exercises: [{ name: 'Chest press', sets: [{ load: 70, reps: 8 }] }] }); await reloadWorkouts(); renderView(state.view); })()""")
        check("Séance notée sans vélo ni marche : journée semi (2 250 kcal)", await ev("[targetsFor(today()).dayType, targetsFor(today()).kcal]") == ["semi", 2250] and "Semi" in await page.inner_text("#dash-daytype"))
        await ev("""(async () => { await saveRecord({ ...state.workouts.find(w => w.id === 'wt'), bikeKm: 5, bikeTimeS: 500, walkKm: 4.8 }); await reloadWorkouts(); renderView(state.view); })()""")
        check("Séance avec vélo + marche du retour : journée complète (2 500 kcal, G 290, L 75)", await ev("(() => { const t = targetsFor(today()); return [t.dayType, t.kcal, t.carbs, t.fat, t.protein, t.fiber]; })()") == ["full", 2500, 290, 75, 170, 32])
        check("Course seule : journée semi", await ev("(() => { state.runs = [{ id: 'r', type: 'run', date: addDays(today(), -5), durationS: 1800 }]; return autoDayType(addDays(today(), -5)); })()") == "semi")
        # Choix à la main : « Complet » le matin avant la salle.
        await ev("(async () => { await deleteRecord('wt'); await reloadWorkouts(); renderView(state.view); })()")
        await page.click("#dash-daytype [data-day-type=full]"); await page.wait_for_timeout(300)
        check("Choisir « Complet » sur l'accueil : 2 500 kcal tout de suite", "(choisie)" in await page.inner_text("#dash-daytype") and await ev("targetsFor(today()).kcal") == 2500 and "Objectif choisi" in await page.inner_text("#toast"))
        await page.click("button[data-view=nutrition]"); await page.wait_for_timeout(300)
        nut = (await page.inner_text("#nutrition-totals")).replace("\u00a0", "\u202f")
        check("Nutrition et « Il te reste » suivent l'objectif du jour", "/ 2\u202f500" in nut and "2\u202f500 kcal" in (await page.inner_text("#remaining-text")).replace("\u00a0", "\u202f"), (nut[:80], await page.inner_text("#remaining-text")))
        check("Menu de la journée : calcule sur 2 500 kcal", await ev("menuTargets().remKcal") == 2500)
        check("Choix gardé dans les objectifs (synchronisé avec eux)", (await ev("getSetting('targets')"))["dayOverrides"] == {await ev("today()"): "full"})
        await page.click("#nutrition-daytype [data-day-type=auto]"); await page.wait_for_timeout(300)
        check("« Auto » : retour à la détection (sans sport)", await ev("[targetsFor(today()).dayType, targetsFor(today()).dayAuto]") == ["rest", True])
        old = await ev("(async () => { await setDayOverride(addDays(today(), -40), 'full'); await setDayOverride(today(), 'semi'); return Object.keys(state.targets.dayOverrides); })()")
        check("Choix de plus de 30 jours effacés tout seuls", old == [await ev("today()")], old)
        check("Objectifs relus depuis Firebase / une sauvegarde : rien de perdu", await ev("JSON.stringify(normalizeTargets(JSON.parse(JSON.stringify(state.targets)))) === JSON.stringify(state.targets)"))

        # Coach
        exp = await ev("buildPeriodExport(addDays(today(), -3), today())")
        jours = {j["date"]: j for j in exp["jours"]}
        td = await ev("today()")
        check("Export coach : objectifs par journée + type de chaque jour",
              exp["objectifs"]["par_journee"]["complet"]["kcal"] == 2500 and exp["objectifs"]["par_journee"]["sans_sport"]["lipides_g"] == 65 and "kcal" not in exp["objectifs"]
              and jours[await ev("addDays(today(), -3)")]["type_journee"]["type"] == "semi", exp["objectifs"])
        check("Export coach : un jour vide n'est pas compté comme renseigné", td not in jours and exp["export"]["jours_renseignes"] == len(exp["jours"]), {d: list(j) for d, j in jours.items()})
        check("Export coach : compléments suivants de rest-pause", jours[await ev("addDays(today(), -3)")]["seances"][0]["exercices"][0]["series"][0]["reps_pauses_suivantes"] == [3])
        await ev("saveRecord({ id: 'mx', type: 'meal', date: today(), kind: 'Déjeuner', name: 'Poulet riz', kcal: 650, protein: 45, carbs: 70, fat: 12, fiber: 3 }).then(() => reloadMeals())")
        recap = await ev("buildDayRecap(today())")
        check("Récap du jour : objectif du type de journée", "Objectif du jour : journée semi (choisie) · 2\u202f250 kcal" in recap.replace("\u00a0", "\u202f"), recap)
        sheet = await ev("buildCoachSheet('# Fiche\\n\\n## Profil\\n\\n## Objectifs en cours\\n\\n- Cible calorique et macros : à définir.\\n')")
        check("Fiche « État actuel » : cible selon la journée", "- Cible calorique et macros : selon la journée — complet 2" in sheet and "sans sport 2" in sheet, [l for l in sheet.split("\n") if "Cible" in l])
        summary = await ev("buildClaudeSummary(7)")
        check("Bilan « Copier pour Claude » : les 3 objectifs", "Objectifs selon la journée : Complet" in summary)
        csv_header = await ev("(async () => { let blob = null; const orig = downloadBlob; window.downloadBlob = (n, b) => { blob = b; }; await exportWorkoutsCSV(); window.downloadBlob = orig; return (await blob.text()).split('\\r\\n')[0]; })()")
        check("Export CSV des séances : colonne des compléments suivants", "complements_suivants" in csv_header, csv_header)

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
