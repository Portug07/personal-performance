"""Tests automatiques de Personal Performance (parcours complets dans un vrai navigateur).

Usage (depuis le dossier de l'application) :
    pip install playwright pillow && playwright install chromium
    python test_app.py

Le script lance son propre petit serveur local, ouvre l'application dans Chromium,
et vérifie les parcours principaux. Toutes les vérifications doivent être « OK » avant une livraison.
"""
import asyncio, json, sys, os, io, socket, subprocess, tempfile, time
from playwright.async_api import async_playwright
from PIL import Image
import random

ROOT = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix="pp-tests-")
def free_port():
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0)); return so.getsockname()[1]
PORT = free_port()
BASE = f"http://localhost:{PORT}/"
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("OK   " if cond else "ÉCHEC"), name, ("— " + str(detail)) if detail != "" else "")

def make_photo(path):
    img = Image.new("RGB", (4000, 3000))
    px = img.load()
    for x in range(0, 4000, 4):
        for y in range(0, 3000, 4):
            c = (random.randint(0, 255), (x // 16) % 256, (y // 12) % 256)
            for dx in range(4):
                for dy in range(4):
                    px[x + dx, y + dy] = c
    exif = img.getexif(); exif[0x0110] = "TestCamGPS"
    img.save(path, "JPEG", quality=92, exif=exif)
    return os.path.getsize(path)

async def fill_set(page, ex_index, set_index, load=None, reps=None):
    block = page.locator(".exercise-block").nth(ex_index)
    row = block.locator(".set-row").nth(set_index)
    if load is not None: await row.locator('[data-field="load"]').fill(str(load))
    if reps is not None: await row.locator('[data-field="reps"]').fill(str(reps))

async def main():
    photo_path = os.path.join(TMP, "photo.jpg")
    size = make_photo(photo_path)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 900}, permissions=["clipboard-read", "clipboard-write", "notifications"], accept_downloads=True)
        page = await ctx.new_page()
        _inner = page.inner_text
        async def inner_text(selector):  # espaces insécables → espaces simples, pour comparer facilement
            return (await _inner(selector)).replace("\xa0", " ").replace("\u202f", " ")
        page.inner_text = inner_text
        errors, dialogs = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        def on_dialog(d):
            dialogs.append(d.message); asyncio.ensure_future(d.accept())
        page.on("dialog", on_dialog)
        await page.goto(BASE); await page.wait_for_timeout(1500)
        async def day(n):  # dates relatives à aujourd'hui : les tests ne dépendent plus du jour où on les lance
            return await page.evaluate(f"addDays(today(),{n})")

        # ---------- Objectifs ----------
        await page.click("button[data-view=settings]")
        await page.fill("#targets-form [name=kcal]", "2200")
        await page.fill("#targets-form [name=protein]", "180")
        await page.fill("#targets-form [name=weight]", "95")
        await page.click("#targets-form button[type=submit]"); await page.wait_for_timeout(300)
        check("Objectifs enregistrés", await page.evaluate("state.targets.kcal===2200 && state.targets.protein===180 && state.targets.weight===95"))

        # ---------- Séance 1 (Push, date passée) ----------
        await page.click("button[data-view=training]")
        await page.fill("#workout-form [name=date]", await day(-3))
        await page.select_option("#workout-form [name=session]", "push")
        await page.wait_for_timeout(200)
        loads = await page.eval_on_selector_all('.exercise-block:first-child [data-field="load"]', "els=>els.map(e=>e.value)")
        check("Charges de départ du programme proposées", loads == ["65", "65", "70", "70"], loads)
        for i in range(4): await fill_set(page, 0, i, reps=12)
        for i, r in enumerate([10, 10, 9, 8]): await fill_set(page, 1, i, reps=r)
        await page.fill("#workout-form [name=duration]", "75")
        # double clic : une seule séance
        await page.evaluate("document.getElementById('workout-submit').click();document.getElementById('workout-submit').click();")
        await page.wait_for_timeout(800)
        n = await page.evaluate("state.workouts.length")
        check("Double clic = une seule séance", n == 1, n)
        w = await page.evaluate("state.workouts[0]")
        check("Seuls les exercices avec répétitions sont gardés", len(w["exercises"]) == 2 and w["exercises"][0]["sets"][0] == {"load": 65, "reps": 12}, [e["name"] for e in w["exercises"]])
        hist = await page.inner_text("#workout-history")
        check("Historique affiche charges × reps", "65 × 12" in hist and "70 × 8" in hist and "volume" in hist)
        nxt = await page.eval_on_selector("#workout-form [name=session]", "e=>e.value")
        check("Séance suivante proposée = Pull", nxt == "pull", nxt)

        # ---------- Séance 2 (Push) : mémoire des charges + conseil ----------
        await page.select_option("#workout-form [name=session]", "push"); await page.wait_for_timeout(200)
        meta = await page.inner_text(".exercise-block:first-child .exercise-meta")
        check("Dernière performance affichée", "Dernière fois" in meta and "65 × 12" in meta, meta.replace("\n", " | "))
        check("Progression automatique : seuil atteint → charges déjà augmentées (+2,5 kg)", "déjà augmentées de +2,5 kg" in meta, meta.replace("\n", " | "))
        prev = await page.inner_text(".exercise-block:first-child .set-row:first-child .set-prev")
        check("Série précédente rappelée sur chaque ligne", "65 × 12" in prev, prev)
        loads = await page.eval_on_selector_all('.exercise-block:first-child [data-field="load"]', "els=>els.map(e=>e.value)")
        check("Charges proposées : +2,5 kg sur chaque série", loads == ["67,5", "67,5", "72,5", "72,5"], loads)
        await page.click('.exercise-block:first-child [data-action="undo-increment"]')
        loads = await page.eval_on_selector_all('.exercise-block:first-child [data-field="load"]', "els=>els.map(e=>e.value)")
        check("« Garder les charges d'avant » annule l'augmentation", loads == ["65", "65", "70", "70"], loads)
        await page.click('.exercise-block:first-child [data-action="apply-increment"]')
        loads = await page.eval_on_selector_all('.exercise-block:first-child [data-field="load"]', "els=>els.map(e=>e.value)")
        check("Puis « Appliquer » la remet", loads == ["67,5", "67,5", "72,5", "72,5"], loads)
        for i in range(4): await fill_set(page, 0, i, reps=10)
        # brouillon : on recharge la page en pleine séance
        await page.wait_for_timeout(600)
        await page.reload(); await page.wait_for_timeout(1200)
        await page.click("button[data-view=training]")
        reps = await page.eval_on_selector_all('.exercise-block:first-child [data-field="reps"]', "els=>els.map(e=>e.value)")
        loads = await page.eval_on_selector_all('.exercise-block:first-child [data-field="load"]', "els=>els.map(e=>e.value)")
        check("Brouillon restauré après fermeture", reps == ["10"] * 4 and loads[0] == "67,5", (reps, loads))
        # erreur de saisie
        await fill_set(page, 1, 0, reps="abc")
        await page.click("#workout-submit"); await page.wait_for_timeout(300)
        toast = await page.inner_text("#toast")
        check("Saisie invalide refusée avec message clair", "répétitions invalide" in toast, toast)
        await fill_set(page, 1, 0, reps="10")
        await page.click("#workout-submit"); await page.wait_for_timeout(600)
        toast = await page.inner_text("#toast")
        check("Record détecté à l'enregistrement", "record" in toast.lower(), toast)
        check("Brouillon effacé après enregistrement", await page.evaluate("localStorage.getItem('pp-workout-draft')===null"))

        # ---------- Modifier une séance ----------
        first_id = await page.evaluate("state.workouts[state.workouts.length-1].id")
        await page.click(f'[data-action="edit-workout"][data-id="{first_id}"]'); await page.wait_for_timeout(300)
        title = await page.inner_text("#workout-form-title")
        await fill_set(page, 1, 3, reps=11)
        await page.click("#workout-submit"); await page.wait_for_timeout(600)
        w = await page.evaluate(f"state.workouts.find(x=>x.id==='{first_id}')")
        check("Modification d'une séance", "Modifier la séance" in title and w["exercises"][1]["sets"][3]["reps"] == 11 and await page.evaluate("state.workouts.length") == 2)

        # ---------- Séance libre ----------
        await page.select_option("#workout-form [name=session]", "libre"); await page.wait_for_timeout(200)
        await page.click("#add-exercise")
        await page.fill(".exercise-block:last-child .exercise-name", "Presse à cuisses")
        await fill_set(page, 0, 0, load="120", reps="12")
        await page.click("#workout-submit"); await page.wait_for_timeout(600)
        check("Séance libre avec exercice personnalisé", await page.evaluate("state.workouts.some(w=>w.sessionType==='Séance libre' && w.exercises[0].name==='Presse à cuisses')"))

        # ---------- V3 : rest-pause, pesée, vélo et marche (séance d'aujourd'hui) ----------
        await page.fill("#workout-form [name=date]", await day(0))
        await page.select_option("#workout-form [name=session]", "pull"); await page.wait_for_timeout(200)
        names = await page.eval_on_selector_all(".exercise-block .exercise-name", "els=>els.map(e=>e.value)")
        check("Programme Pull avec Reverse butterfly machine", names[-1] == "Reverse butterfly machine", names)
        meta = await page.inner_text(".exercise-block:nth-child(2) .exercise-meta")
        check("Objectif rest-pause affiché (15 reps, seuil 12)", "rest-pause" in meta and "15 reps" in meta and "12 reps avant l'échec" in meta, meta)
        rows = page.locator(".exercise-block").nth(1).locator(".set-row")
        await rows.nth(0).locator('[data-field="rp"]').fill("7")
        await page.click("#workout-submit"); await page.wait_for_timeout(300)
        check("Complément sans reps avant l'échec refusé", "indique d'abord les reps avant l'échec" in await page.inner_text("#toast"))
        for i, (r, rp) in enumerate([(8, 7), (7, 8), (7, 8), (6, 9)]):
            await rows.nth(i).locator('[data-field="reps"]').fill(str(r))
            await rows.nth(i).locator('[data-field="rp"]').fill(str(rp))
        await page.fill("#workout-form [name=weighIn]", "105,8")
        await page.fill("#workout-form [name=bikeTime]", "8:15")
        await page.fill("#workout-form [name=bikeLevel]", "25")
        await page.fill("#workout-form [name=walkKm]", "4,8")
        await page.wait_for_timeout(500)
        await page.reload(); await page.wait_for_timeout(1200)
        await page.click("button[data-view=training]")
        rp_vals = await page.eval_on_selector_all('.exercise-block:nth-child(2) [data-field="rp"]', "els=>els.map(e=>e.value)")
        check("Brouillon : compléments rest-pause et vélo restaurés", rp_vals == ["7", "8", "8", "9"] and await page.input_value("#workout-form [name=bikeTime]") == "8:15", rp_vals)
        await page.click("#workout-submit"); await page.wait_for_timeout(700)
        w = await page.evaluate("state.workouts.find(x=>x.sessionId==='pull' && x.date===today())")
        tv = next(e for e in w["exercises"] if e["name"] == "Tirage vertical")
        check("Série rest-pause enregistrée (70 × 8+7, pause 20 s)", tv["sets"][0] == {"load": 70, "reps": 8, "rpReps": 7, "rpPause": 20}, tv["sets"][0])
        check("Vélo et marche enregistrés (8:15 = 495 s)", w.get("bikeTimeS") == 495 and w.get("bikeKm") == 5 and w.get("bikeLevel") == 25 and w.get("walkKm") == 4.8, {k: w.get(k) for k in ["bikeTimeS", "bikeKm", "bikeLevel", "walkKm"]})
        m = await page.evaluate("state.measurements.find(x=>x.date===today() && x.moment==='Soir, avant séance')")
        check("Pesée de la séance enregistrée comme mesure du soir", m is not None and m["weight"] == 105.8, m)
        hist = await page.inner_text("#workout-history")
        check("Historique : notation 8+7 et cardio", "70 × 8+7" in hist and "Vélo 5 km en 8:15 (difficulté 25)" in hist and "Marche 4,8 km" in hist, hist[:300])
        await page.select_option("#workout-form [name=session]", "pull"); await page.wait_for_timeout(200)
        meta = await page.inner_text(".exercise-block:nth-child(2) .exercise-meta")
        check("Conseil rest-pause : viser une rep de plus sur la 1re série", "1re série : 8 reps avant l'échec" in meta and "vise 9" in meta, meta)
        ph = await page.eval_on_selector('.exercise-block:nth-child(2) .set-row:first-child [data-field="rp"]', "e=>e.placeholder")
        check("Complément précédent rappelé", ph == "7", ph)
        await page.evaluate("resetWorkoutForm()"); await page.wait_for_timeout(200)
        vol = await page.evaluate("volume([{load:70,reps:8,rpReps:7}])")
        check("Volume rest-pause = charge × (reps + complément)", vol == 1050, vol)

        # ---------- Nutrition ----------
        await page.click("button[data-view=nutrition]")
        await page.fill("#meal-form [name=name]", "pates"); await page.wait_for_timeout(200)
        sug = await page.inner_text("#food-suggestions")
        check("Recherche sans accents", "Pâtes cuites" in sug, sug)
        await page.click('#food-suggestions [data-food="Pâtes cuites"]')
        await page.fill("#meal-form [name=grams]", "250"); await page.wait_for_timeout(100)
        kcal = await page.input_value("#meal-form [name=kcal]")
        check("Calcul selon les grammes (250 g = 395 kcal)", kcal == "395", kcal)
        await page.set_input_files("#meal-form [name=photo]", photo_path)
        await page.click("#meal-submit"); await page.wait_for_timeout(2500)
        totals = await page.inner_text("#nutrition-totals")
        check("Objectif et reste du jour affichés", "/ 2 200" in totals.replace(" ", " ") and "reste 1 805 kcal" in totals.replace(" ", " "), totals.replace("\n", " | "))
        ph = await page.evaluate("""(async()=>{const ps=await getAllPhotos(); const b=ps[0].blob; const t=await b.text(); return {n:ps.length,size:b.size,type:b.type,exif:t.includes('TestCamGPS')}})()""")
        check(f"Photo compressée ({size//1024} Ko → {ph['size']//1024} Ko), métadonnées supprimées", ph["n"] == 1 and ph["size"] < 600_000 and not ph["exif"], ph)
        await page.wait_for_timeout(500)
        check("Miniature de la photo affichée", await page.evaluate("!!document.querySelector('#meal-history img[src^=\"blob:\"]')"))
        # repas d'hier puis navigation
        yesterday = await day(-1)
        yesterday_label = (await page.evaluate(f"fmtDate('{yesterday}')")).replace("\xa0", " ").replace("\u202f", " ")
        await page.fill("#meal-form [name=date]", yesterday)
        await page.fill("#meal-form [name=name]", "Repas d'hier")
        await page.fill("#meal-form [name=kcal]", "800")
        await page.click("#meal-submit"); await page.wait_for_timeout(500)
        toast = await page.inner_text("#toast")
        await page.click("#day-prev"); await page.wait_for_timeout(400)
        lst = await page.inner_text("#meal-history")
        check("Repas d'un autre jour visible via la navigation", "Repas d'hier" in lst and yesterday_label in toast.replace("\u00a0", " "), toast)
        await page.click("#meal-history [data-action=delete-record]"); await page.wait_for_timeout(500)
        check("…et supprimable", "Repas d'hier" not in await page.inner_text("#meal-history"))
        await page.click("#day-today"); await page.wait_for_timeout(300)
        await page.click("#meal-history [data-action=repeat-meal]"); await page.wait_for_timeout(500)
        check("Répéter un repas", await page.evaluate("state.dayMeals.length") == 2)
        await page.fill("#meal-form [name=name]", "pat"); await page.wait_for_timeout(200)
        check("Aliments déjà mangés proposés en premier", await page.evaluate("document.querySelector('#food-suggestions button')?.classList.contains('history')"), await page.inner_text("#food-suggestions"))
        await page.fill("#meal-form [name=name]", "")
        before_kcal = await page.evaluate("mealTotals(state.dayMeals).kcal")
        await page.select_option("#meal-form [name=kind]", "Alcool")
        check("Champs alcool affichés pour le type « Alcool »", await page.is_visible("#alcohol-fields"))
        await page.click('#alcohol-presets [data-alcohol="0"]'); await page.wait_for_timeout(100)
        check("Boisson prédéfinie : bière triple 500 ml 8,5 % 330 kcal", await page.input_value("#meal-form [name=volumeMl]") == "500" and await page.input_value("#meal-form [name=abv]") == "8,5" and await page.input_value("#meal-form [name=kcal]") == "330")
        await page.click("#meal-submit"); await page.wait_for_timeout(500)
        alc = await page.inner_text("#nutrition-alcohol")
        after_kcal = await page.evaluate("mealTotals(state.dayMeals).kcal")
        check("Verres standard calculés et calories comptées dans le total", "3,4 verre(s) standard" in alc and after_kcal == before_kcal + 330, (alc, before_kcal, after_kcal))
        check("Formulaire remis à zéro après l'alcool", not await page.is_visible("#alcohol-fields"))

        # ---------- Poids ----------
        await page.click("button[data-view=progress]")
        for i, wgt in enumerate([106.8, 106.2, 106.5, 105.9, 105.6, 105.8, 105.1, 104.9, 105.0, 104.4]):
            await page.fill("#measurement-form [name=date]", await day(i - 11))
            await page.fill("#measurement-form [name=weight]", str(wgt).replace(".", ","))
            await page.click("#measurement-submit"); await page.wait_for_timeout(250)
        summ = await page.inner_text("#weight-summary")
        check("Moyenne 7 jours et rythme calculés", "Moyenne 7 jours" in summ and "−" in summ, summ.replace("\n", " | "))
        check("Courbe de poids tracée", await page.evaluate("!!document.querySelector('#weight-chart svg path.s-trend')"))
        await page.fill("#battery-form [name=date]", await day(-28))
        for name, val in [("bikeS", "8:10"), ("chestPress8rm", "72,5"), ("row8rm", "75"), ("pushups", "25"), ("plankS", "1:00"), ("backScratchR", "-5"), ("backScratchL", "-10")]:
            await page.fill(f"#battery-form [name={name}]", val)
        await page.click("#battery-submit"); await page.wait_for_timeout(400)
        t = await page.evaluate("state.battery[0]")
        check("Batterie de tests enregistrée (8:10 = 490 s, planche 60 s, mobilité négative)", t.get("bikeS") == 490 and t.get("plankS") == 60 and t.get("backScratchR") == -5 and t.get("pushups") == 25, t)
        await page.fill("#battery-form [name=date]", await day(0))
        await page.fill("#battery-form [name=bikeS]", "7:58"); await page.fill("#battery-form [name=pushups]", "28")
        await page.click("#battery-submit"); await page.wait_for_timeout(400)
        summ_b = await page.inner_text("#battery-summary")
        check("Comparaison avec la référence (progrès en vert)", "−12 s" in summ_b and "+3" in summ_b and await page.evaluate("document.querySelectorAll('#battery-summary .trend-good').length") == 2, summ_b.replace("\n", " | ")[:300])
        await page.fill("#battery-form [name=plankS]", "abc"); await page.click("#battery-submit"); await page.wait_for_timeout(300)
        check("Temps invalide refusé", "Planche" in await page.inner_text("#toast"))
        await page.fill("#battery-form [name=plankS]", "")
        check("Progression par exercice tracée", await page.evaluate("!!document.querySelector('#exercise-chart svg')") and "Chest press" in await page.inner_text("#progress-exercise"))

        # ---------- Récupération ----------
        await page.click("button[data-view=wellbeing]")
        await page.fill("#wellbeing-form [name=sleep]", "7,5"); await page.fill("#wellbeing-form [name=fatigue]", "4")
        await page.fill("#wellbeing-form [name=sleepQuality]", "3")
        await page.fill("#wellbeing-form [name=kneeBefore]", "3"); await page.fill("#wellbeing-form [name=kneeDuring]", "3"); await page.fill("#wellbeing-form [name=kneeNext]", "2,5")
        await page.click("#wellbeing-submit"); await page.wait_for_timeout(400)
        check("Check-in et moyennes", "7,5 h" in await page.inner_text("#wellbeing-averages"))
        wb = await page.evaluate("state.wellbeing[0]")
        check("Douleur genou (avant/pendant/lendemain) et qualité du sommeil", wb.get("kneeBefore") == 3 and wb.get("kneeNext") == 2.5 and wb.get("sleepQuality") == 3, wb)
        await page.fill("#wellbeing-form [name=fatigue]", "12")
        await page.click("#wellbeing-submit"); await page.wait_for_timeout(300)
        check("Valeur hors bornes refusée", "entre 1 et 10" in await page.inner_text("#toast"))
        await page.fill("#wellbeing-form [name=fatigue]", "")

        # ---------- Tableau de bord + Claude ----------
        await page.click("button[data-view=dashboard]"); await page.wait_for_timeout(300)
        cards = await page.inner_text("#dash-cards")
        check("Accueil : calories / objectif", "/ 2 200" in cards.replace(" ", " "), cards.replace("\n", " | "))
        check("Alerte de sauvegarde visible (jamais sauvegardé)", await page.is_visible("#backup-alert"))
        await page.click("#copy-claude"); await page.wait_for_timeout(300)
        clip = await page.evaluate("navigator.clipboard.readText()")
        check("Bilan copié pour Claude", "# Bilan Personal Performance" in clip and "Chest press" in clip and "kcal" in clip, clip[:120])
        await page.click("#copy-recap"); await page.wait_for_timeout(300)
        recap = (await page.evaluate("navigator.clipboard.readText()")).replace("\u202f", " ").replace("\xa0", " ")
        tday = await day(0)
        expected = [f"JOUR {tday[8:10]}/{tday[5:7]}", "Poids : 105,8 kg (soir, avant séance)", "Sommeil : 7,5 h · qualité 3/5", "Tirage vertical : 70 × 8+7, 70 × 7+8", "rest-pause, pause 20 s",
                    "Alcool : Bière triple, 500 ml, 8,5 % (3,4 verres std, 330 kcal)", "(dont alcool 330)", "Cardio : vélo 5 km en 8:15 (difficulté 25) · marche 4,8 km",
                    "Tests : Vélo 5 km (effort max) 7:58", "Douleur genou : avant 3/10 · pendant 3/10 · lendemain 2,5/10"]
        missing = [e for e in expected if e not in recap]
        check("Récap du jour au format de la saisie rapide", not missing, missing or recap[:200])
        await page.fill("#recap-date", await day(-60)); await page.click("#copy-recap"); await page.wait_for_timeout(300)
        check("Récap d'un jour vide : aucune valeur inventée", "Aucune donnée saisie ce jour." in await page.evaluate("navigator.clipboard.readText()"))
        await page.select_option("#export-period", "last-7")
        async with page.expect_download() as dl:
            await page.click("#export-period-json")
        exp_dl = await dl.value
        exp = json.load(open(await exp_dl.path()))
        jt = next(j for j in exp["jours"] if j["date"] == tday)
        tv = next(e for s in jt["seances"] for e in s["exercices"] if e["nom"] == "Tirage vertical")
        check("Export période : nom de fichier et schéma", exp_dl.suggested_filename == f"personal-performance_{await day(-6)}_{tday}.json" and exp["export"]["version_schema"] == 2, exp_dl.suggested_filename)
        check("Export période : série rest-pause au format de la spec", tv["series"][0] == {"charge_kg": 70, "reps": 8, "reps_rest_pause": 7, "pause_s": 20}, tv["series"][0])
        check("Export période : pesée, alcool, totaux, douleurs, tests, cardio",
              jt["pesee"] == {"poids_kg": 105.8, "moment": "soir, avant séance"} and jt["alcool"][0]["verres_standard"] == 3.4 and jt["totaux"]["kcal_alcool"] == 330
              and jt["douleurs"][0] == {"zone": "genou gauche", "avant": 3, "pendant": 3, "lendemain": 2.5} and jt["tests"]["velo_5km_s"] == 478
              and {"type": "velo", "distance_km": 5, "duree_s": 495, "niveau": 25} in jt["cardio"], {k: jt.get(k) for k in ["pesee", "totaux", "douleurs", "cardio"]})
        def has_empty(o):
            if isinstance(o, dict): return any(v in (None, "", [], {}) or has_empty(v) for v in o.values())
            if isinstance(o, list): return any(has_empty(v) for v in o)
            return False
        other = [j for j in exp["jours"] if j["date"] != tday]
        check("Export période : aucun champ vide ni zéro inventé", not has_empty(exp) and all("sommeil" not in j for j in other), [j["date"] for j in other])

        # ---------- Export ----------
        await page.click("button[data-view=settings]")
        async with page.expect_download() as dl:
            await page.click("#export-json")
        path = await (await dl.value).path()
        data = json.load(open(path))
        check("Export JSON complet (entrées + programme + objectifs)", data["format"] == 3 and len(data["records"]) >= 15 and data["settings"]["targets"]["kcal"] == 2200, len(data["records"]))
        await page.click("button[data-view=dashboard]"); await page.wait_for_timeout(300)
        check("Alerte de sauvegarde masquée après export", not await page.is_visible("#backup-alert"))
        async with page.expect_download() as dl:
            await page.click("button[data-view=settings]"); await page.click("#export-json-photos")
        data_ph = json.load(open(await (await dl.value).path()))
        check("Export avec photos", len(data_ph["photos"]) == 1)
        async with page.expect_download() as dl:
            await page.click("#export-workouts-csv")
        csv = open(await (await dl.value).path(), encoding="utf-8-sig").read()
        check("CSV des séances (virgule décimale)", '"67,5"' in csv and "Chest press" in csv, csv.splitlines()[1] if len(csv.splitlines()) > 1 else csv)

        # ---------- Imports piégés ----------
        evil = {"app": "Personal Performance", "records": [
            {"id": "x1", "type": "meal", "date": "2026-11-04", "kind": "Déjeuner", "name": "<img src=x onerror=\"window.__xss=1\">", "kcal": 500,
             "protein": "<img src=x onerror=\"window.__xss2=1\">", "createdAt": 1},
            {"id": "x\"><img src=x onerror=\"window.__xss3=1\">", "type": "measurement", "date": "2026-11-01", "weight": "<b>100</b>"},
            {"id": "x4", "type": "workout", "date": "2026-11-02", "sessionType": "<svg onload=window.__xss4=1>", "duration": "<img src=x onerror=window.__xss5=1>"}]}
        open(os.path.join(TMP, "evil.json"), "w").write(json.dumps(evil))
        before = await page.evaluate("countRecords()")
        await page.set_input_files("#import-json", os.path.join(TMP, "evil.json")); await page.wait_for_timeout(1000)
        for v in ["dashboard", "nutrition", "progress", "training"]:
            await page.click(f"button[data-view={v}]"); await page.wait_for_timeout(250)
        xss = await page.evaluate("[window.__xss,window.__xss2,window.__xss3,window.__xss4,window.__xss5].filter(Boolean).length")
        check("Import piégé : aucun script exécuté", xss == 0, xss)
        after = await page.evaluate("countRecords()")
        check("Import piégé : entrées nettoyées puis fusionnées", after == before + 3, (before, after))
        broken = {"records": [{"id": "b1", "type": "workout", "date": "pas une date"}, {"type": "inconnu", "date": "2026-11-01"}]}
        open(os.path.join(TMP, "broken.json"), "w").write(json.dumps(broken))
        await page.click("button[data-view=settings]")
        await page.set_input_files("#import-json", os.path.join(TMP, "broken.json")); await page.wait_for_timeout(800)
        toast = await page.inner_text("#toast")
        check("Fichier abîmé : rien n'est modifié", "Rien n'a été modifié" in toast and await page.evaluate("countRecords()") == after, toast)
        open(os.path.join(TMP, "notjson.json"), "w").write("{oops")
        await page.set_input_files("#import-json", os.path.join(TMP, "notjson.json")); await page.wait_for_timeout(500)
        check("Fichier illisible : message clair", "illisible" in await page.inner_text("#toast"))
        # remplacement : copie de sécurité téléchargée avant
        await page.check('input[name="import-mode"][value="replace"]')
        async with page.expect_download() as dl:
            await page.set_input_files("#import-json", path)
        safety = await (await dl.value).path()
        await page.wait_for_timeout(1500)
        check("Remplacement : copie de sécurité téléchargée d'abord", len(json.load(open(safety))["records"]) == after)
        check("Remplacement : données du fichier restaurées", await page.evaluate("countRecords()") == len(data["records"]))
        await page.check('input[name="import-mode"][value="merge"]')

        # ---------- Notification via le service worker ----------
        await page.click("#notification-test"); await page.wait_for_timeout(600)
        if await page.evaluate("Notification.permission") == "granted":
            notifs = await page.evaluate("navigator.serviceWorker.getRegistration().then(r=>r.getNotifications()).then(n=>n.length)")
            check("Notification envoyée par le service worker (méthode compatible Android)", notifs >= 1, notifs)
        else:
            print("INFO  Notifications non testables dans ce navigateur sans affichage (permission refusée d'office).")

        # ---------- Stockage ----------
        info = await page.inner_text("#storage-info")
        check("État du stockage affiché", "Stockage protégé" in info and "Dernière sauvegarde" in info, info.replace("\n", " | ")[:200])

        # ---------- V3 : compatibilité avec les sauvegardes et programmes de la version 2 ----------
        v2 = {"app": "Personal Performance", "format": 2, "records": [
            {"id": "v2w1", "type": "workout", "date": await day(-20), "sessionType": "Push", "exercises": [{"name": "Chest press", "sets": [{"load": 60, "reps": 12}]}]},
            {"id": "v2m1", "type": "meal", "date": await day(-20), "kind": "Déjeuner", "name": "Riz", "kcal": 300}]}
        open(os.path.join(TMP, "v2.json"), "w").write(json.dumps(v2))
        before = await page.evaluate("countRecords()")
        await page.set_input_files("#import-json", os.path.join(TMP, "v2.json")); await page.wait_for_timeout(800)
        imported = await page.evaluate("state.workouts.find(w=>w.id==='v2w1')")
        check("Sauvegarde de la version 2 importée", await page.evaluate("countRecords()") == before + 2 and imported["exercises"][0]["sets"][0] == {"load": 60, "reps": 12}, imported)
        old_program = {"sessions": [{"id": "push", "name": "Push", "exercises": [{"id": "chest-press", "name": "Chest press", "sets": 4, "repMin": 8, "repMax": 12, "increment": 2.5, "loads": [65]}]},
                                    {"id": "pull", "name": "Pull", "exercises": [{"id": "rowing-machine", "name": "Rowing machine", "sets": 4, "repMin": 8, "repMax": 12, "increment": 2.5, "loads": [65]}]}]}
        await page.evaluate(f"setSetting('program', {json.dumps(old_program)})")
        await page.reload(); await page.wait_for_timeout(1200)
        prog = await page.evaluate("state.program")
        pull_names = [e["name"] for e in prog["sessions"][1]["exercises"]]
        check("Programme v2 mis à niveau : rest-pause + Reverse butterfly ajouté une fois", prog["schema"] == 3 and pull_names == ["Rowing machine", "Reverse butterfly machine"] and all(e["mode"] == "restpause" for s in prog["sessions"] for e in s["exercises"]), (prog.get("schema"), pull_names))
        stored = await page.evaluate("getSetting('program')")
        check("Mise à niveau du programme enregistrée", stored["schema"] == 3)
        await page.click("button[data-view=settings]"); await page.wait_for_timeout(300)
        await page.select_option(".program-session:first-child .program-ex:first-child .pe-mode", "classic")
        check("Réglages : méthode classique affiche reps min / max", await page.is_visible(".program-session:first-child .program-ex:first-child .pe-min") and not await page.is_visible(".program-session:first-child .program-ex:first-child .pe-upat"))
        await page.click("#program-save"); await page.wait_for_timeout(400)
        check("Programme enregistré avec la méthode choisie", await page.evaluate("state.program.sessions[0].exercises[0].mode") == "classic" and await page.evaluate("state.program.schema") == 3)
        async with page.expect_download() as dl:
            await page.click("#export-workouts-csv")
        csv3 = open(await (await dl.value).path(), encoding="utf-8-sig").read()
        check("CSV des séances avec le complément de rest-pause", "complement_rest_pause" in csv3.splitlines()[0] and '"Tirage vertical";"1";"70";"8";"7";"";"20"' in csv3, csv3.splitlines()[0])

        # ---------- Hors connexion ----------
        await page.reload(); await page.wait_for_timeout(800)
        await ctx.set_offline(True)
        await page.goto(BASE + "?view=training"); await page.wait_for_timeout(1200)
        check("Hors connexion : l'app démarre et le raccourci ?view= fonctionne", await page.evaluate("state.view") == "training" and await page.evaluate("state.workouts.length") >= 3)
        await ctx.set_offline(False)

        check("Aucune erreur JavaScript pendant les parcours", not errors, errors[:5])
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
