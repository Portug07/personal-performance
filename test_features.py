"""Tests des fonctions des versions 3.2 et 3.3 : minuteur, mode séance plein écran, repas habituels,
« Comme hier », recettes maison, exercices au poids du corps, « Il te reste… », Nutri-Score et NOVA.

Usage (depuis le dossier de l'application) :
    python test_features.py
"""
import asyncio, json, os, socket, subprocess, sys, time
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

OFF_PRODUCT = {"code": "3017620422003", "status": 1, "product": {"product_name_fr": "Crème légère test", "brands": "MarqueTest", "nutriscore_grade": "d", "nova_group": 4,
               "nutriments": {"energy-kcal_100g": 120, "proteins_100g": 3, "carbohydrates_100g": 4, "fat_100g": 10, "fiber_100g": 0}}}
async def off_route(route):
    await route.fulfill(status=200, content_type="application/json", body=json.dumps(OFF_PRODUCT), headers={"access-control-allow-origin": "*"})

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        await ctx.route("https://world.openfoodfacts.org/**", off_route)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        ev = page.evaluate
        await page.goto(BASE); await page.wait_for_timeout(1000)

        # Historique : une séance Push il y a 3 jours, des repas hier.
        await ev("""(async () => {
          const y = addDays(today(), -1);
          await saveRecords([
            {id:'w0',type:'workout',date:addDays(today(),-3),sessionId:'push',sessionType:'Push',exercises:[
              {exerciseId:'chest-press',name:'Chest press',sets:[{load:70,reps:9,rpReps:6,rpPause:20},{load:70,reps:7,rpReps:5,rpPause:20},{load:70,reps:6,rpReps:4,rpPause:20},{load:70,reps:6,rpReps:4,rpPause:20}]},
              {exerciseId:'butterfly',name:'Butterfly',sets:[{load:65,reps:10},{load:65,reps:9},{load:70,reps:8},{load:70,reps:7}]}]},
            {id:'y1',type:'meal',date:y,kind:'Petit-déjeuner',name:'Skyr nature',grams:200,kcal:120,protein:21,carbs:7.6,fat:0.4,fiber:0,per100:{kcal:60,protein:10.5,carbs:3.8,fat:0.2,fiber:0}},
            {id:'y2',type:'meal',date:y,kind:'Petit-déjeuner',name:"Flocons d'avoine",grams:50,kcal:186,protein:6.7,carbs:30,fat:3.5,fiber:5},
            {id:'y3',type:'meal',date:y,kind:'Déjeuner',name:'Poulet riz',grams:400,kcal:620,protein:48,carbs:70,fat:12,fiber:3},
            {id:'y4',type:'meal',date:y,kind:'Alcool',name:'Bière blonde',kcal:215,protein:0,carbs:18,fat:0,fiber:0,volumeMl:500,abv:5}
          ]);
          await reloadAll(); renderSessionOptions(); resetWorkoutForm();
        })()""")

        # ================= Minuteur =================
        await page.click("button[data-view=training]"); await page.wait_for_timeout(200)
        await ev("workoutForm().elements.session.value='push'; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.wait_for_timeout(200)
        await page.click(".exercise-block >> nth=0 >> [data-action=timer-rp]")
        await page.wait_for_timeout(300)
        check("Minuteur : « Pause RP » d'un exercice lance 20 s", await page.is_visible("#rest-pill") and await page.inner_text("#rest-pill-label") == "Pause RP" and await page.inner_text("#rest-pill-time") in ("0:20", "0:19"))
        await page.click("#rest-more"); await page.wait_for_timeout(200)
        check("Minuteur : +15 s", await page.inner_text("#rest-pill-time") in ("0:35", "0:34"), await page.inner_text("#rest-pill-time"))
        await page.reload(); await page.wait_for_timeout(1200)
        check("Minuteur : repris après fermeture de l'app", await page.is_visible("#rest-pill") and await page.inner_text("#rest-pill-label") == "Pause RP")
        await page.click("#rest-stop")
        check("Minuteur : arrêt", not await page.is_visible("#rest-pill") and await ev("localGet('pp-rest-timer') === null"))
        await ev("startRestTimer(5, 'Pause RP')"); await page.wait_for_timeout(5800)
        check("Minuteur : fin annoncée (complément de rest-pause)", "Pause terminée" in await page.inner_text("#toast") and not await page.is_visible("#rest-pill"))
        # Lancement automatique
        await page.click("button[data-view=training]")
        await ev("localSet('pp-rest-auto', true); localSet('pp-rest-seconds', 120)")
        reps = page.locator(".exercise-block").nth(0).locator(".set-row").nth(0).locator('[data-field="reps"]')
        await reps.fill("9"); await reps.dispatch_event("change"); await page.wait_for_timeout(200)
        auto1 = (await page.inner_text("#rest-pill-label"), await page.inner_text("#rest-pill-time"))
        rp = page.locator(".exercise-block").nth(0).locator(".set-row").nth(0).locator('[data-field="rp"]')
        await rp.fill("6"); await rp.dispatch_event("change"); await page.wait_for_timeout(200)
        auto2 = (await page.inner_text("#rest-pill-label"), await page.inner_text("#rest-pill-time"))
        check("Automatique : reps avant l'échec → pause RP, complément → repos réglé (2:00)", auto1[0] == "Pause RP" and auto2 == ("Repos", "2:00") or auto2 == ("Repos", "1:59"), (auto1, auto2))
        await page.click("#rest-stop")
        await ev("localSet('pp-rest-auto', false); resetWorkoutForm(); workoutForm().elements.session.value='push'; workoutForm().elements.session.dispatchEvent(new Event('change'))")

        # ================= Mode séance =================
        await page.click("#session-open"); await page.wait_for_timeout(400)
        st = await ev("""({open: sessionModeOpen(), name: document.getElementById('sm-name').textContent,
            load: document.querySelector('[data-sm-field=load]').value, repsPh: document.querySelector('[data-sm-field=reps]').placeholder,
            rpPh: document.querySelector('[data-sm-field=rp]').placeholder, main: document.querySelector('.sm-main').textContent})""")
        check("Mode séance : 1er exercice, charge et reps de la dernière fois proposées", st["open"] and st["name"] == "Chest press" and st["load"] == "70" and st["repsPh"] == "9" and st["rpPh"] == "6" and "pause 20 s" in st["main"], st)
        await page.click("[data-sm-action=fail]"); await page.wait_for_timeout(200)
        check("Échec en 1 appui : reps de la dernière fois notées, pause RP lancée",
              await ev("readEditor()[0].sets[0].reps") == 9 and await page.is_visible("#sm-timer") and await page.inner_text("#sm-timer-label") == "Pause RP")
        check("Message visible au-dessus du mode séance", await ev("(() => { showToast('test'); return document.getElementById('toast').parentElement.id; })()") == "session-dialog")
        await page.click("[data-sm-action=done-rp]"); await page.wait_for_timeout(200)
        s1 = await ev("readEditor()[0].sets[0]")
        check("Complément en 1 appui : 9 + 6 notés, repos lancé, série 2 active",
              s1 == {"load": 70, "reps": 9, "rpReps": 6, "rpPause": 20} and await page.inner_text("#sm-timer-label") == "Repos" and await ev("sm.set") == 1, s1)
        await page.click("[data-sm-step=reps][data-dir='1']"); await page.wait_for_timeout(100)
        await page.click("[data-sm-step=load][data-dir='1']"); await page.wait_for_timeout(100)
        await page.click("[data-sm-action=fail]"); await page.click("[data-sm-action=done-no-rp]"); await page.wait_for_timeout(200)
        s2 = await ev("readEditor()[0].sets[1]")
        check("Boutons + / − : 7 → 8 reps, 70 → 72,5 kg ; « Sans complément »", s2 == {"load": 72.5, "reps": 8}, s2)
        await page.click("[data-sm-step=reps][data-dir='1']")
        check("Un réglage + / − ne valide pas la série", await ev("document.querySelectorAll('.exercise-block')[0].querySelectorAll('[data-field=reps]')[2].value") == "" and await page.locator("[data-sm-action=fail]").count() == 1)
        await page.fill("[data-sm-field=reps]", "11"); await page.dispatch_event("[data-sm-field=reps]", "input")
        await page.click("[data-sm-action=fail]")
        check("Saisie au clavier puis « Échec » : écrite dans le formulaire", await ev("document.querySelectorAll('.exercise-block')[0].querySelectorAll('[data-field=reps]')[2].value") == "11")
        await page.click("[data-sm-action=done-rp]"); await page.wait_for_timeout(100)
        await page.click("[data-sm-action=fail]"); await page.click("[data-sm-action=done-rp]"); await page.wait_for_timeout(200)
        check("Dernière série faite : passage tout seul à l'exercice suivant", await ev("[sm.ex, sm.set]") == [1, 0] and await page.inner_text("#sm-name") == "Butterfly")
        await page.wait_for_timeout(500)   # le brouillon est écrit 0,3 s après le dernier changement
        draft = await ev("localGet('pp-workout-draft')")
        check("Brouillon gardé pendant le mode séance", draft and draft["exercises"][0]["sets"][3]["reps"] == "6")
        # Fermeture brutale de l'app : le mode séance revient au même exercice.
        await page.reload(); await page.wait_for_timeout(1500)
        check("App rouverte : mode séance repris au même exercice", await ev("sessionModeOpen()") and await page.inner_text("#sm-name") == "Butterfly" and await ev("readEditor()[0].sets[2].reps") == 11)
        # Exercice classique
        await ev("state.program.sessions[0].exercises[1].mode = 'classic'; renderSessionMode()")
        check("Exercice classique : un seul bouton « Série faite → repos »", await page.inner_text(".sm-main") == "Série faite → repos 2:00" and await page.locator("[data-sm-field=rp]").count() == 0)
        await ev("state.program.sessions[0].exercises[1].mode = 'restpause'; renderSessionMode()")
        await page.click("#sm-next"); await page.click("#sm-prev")
        check("Navigation entre exercices", await page.inner_text("#sm-name") == "Butterfly" and await ev("sm.ex") == 1)
        await page.click("#sm-add-set"); await page.wait_for_timeout(100)
        check("+ Série depuis le mode séance", await ev("readEditor()[1].sets.length") == 5 and await ev("sm.set") == 4)
        await ev("document.querySelectorAll('.exercise-block')[1].querySelectorAll('.set-row')[4].remove(); renderSessionMode()")
        # Fin : on remplit tout le reste.
        await ev("""(() => { document.querySelectorAll('[data-field=reps]').forEach((i) => { if (!i.value) i.value = '8'; }); saveWorkoutDraft(); renderSessionMode(); })()""")
        check("Toutes les séries notées : « Terminer la séance »", "Terminer la séance" in await page.inner_text("#sm-actions"))
        await page.click("[data-sm-action=finish]"); await page.wait_for_timeout(400)
        check("Terminer : retour au formulaire, rien de perdu", not await ev("sessionModeOpen()") and await ev("readEditor()[0].sets[1].load") == 72.5 and await ev("localGet('pp-session-mode')") is None)
        await page.click("#workout-submit"); await page.wait_for_timeout(600)
        saved = await ev("state.workouts[0].exercises[0].sets")
        check("Séance enregistrée normalement", len(saved) == 4 and saved[0] == {"load": 70, "reps": 9, "rpReps": 6, "rpPause": 20} and saved[1] == {"load": 72.5, "reps": 8}, saved)
        await ev("resetWorkoutForm(); state.editing.workout = null; workoutForm().elements.session.value = FREE_SESSION_ID; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.click("#session-open"); await page.wait_for_timeout(200)
        check("Séance vide : mode séance refusé avec explication", not await ev("sessionModeOpen()") and "ajoute un exercice" in await page.inner_text("#toast"))
        await ev("resetWorkoutForm()")

        # ================= Comme hier =================
        await page.click("button[data-view=nutrition]"); await page.wait_for_timeout(300)
        chips = await ev("[...document.querySelectorAll('#quick-yesterday .food-chip')].map(b => b.textContent)")
        check("Comme hier : un bouton par repas + toute la journée", chips == ["Petit-déjeuner · 306 kcal", "Déjeuner · 620 kcal", "Alcool · 215 kcal", "Toute la journée · 1 141 kcal"] or chips == ["Petit-déjeuner · 306 kcal", "Déjeuner · 620 kcal", "Alcool · 215 kcal", "Toute la journée · 1 141 kcal"], chips)
        await page.click("[data-quick=copy-kind][data-kind='Petit-déjeuner']"); await page.wait_for_timeout(500)
        day = await ev("state.dayMeals.map(m => [m.name, m.kind, m.date === today(), m.kcal])")
        check("Copie du petit-déjeuner d'hier sur aujourd'hui", sorted(day) == sorted([["Skyr nature", "Petit-déjeuner", True, 120], ["Flocons d'avoine", "Petit-déjeuner", True, 186]]), day)
        check("Message avec « Annuler »", "2 entrées ajoutées" in await page.inner_text("#toast") and await page.is_visible(".toast-action"))
        await page.click(".toast-action"); await page.wait_for_timeout(500)
        check("Annuler retire les entrées ajoutées", await ev("state.dayMeals.length") == 0 and await ev("getRecord('y1').then(Boolean)"))
        await page.click("[data-quick=copy-day]"); await page.wait_for_timeout(500)
        alc = await ev("state.dayMeals.find(m => m.name === 'Bière blonde')")
        check("Toute la journée copiée ; la bière garde « Alcool », volume et degré", await ev("state.dayMeals.length") == 4 and alc["kind"] == "Alcool" and alc["volumeMl"] == 500 and alc["abv"] == 5)

        # ================= Repas habituels =================
        await page.click("[data-quick=save-template][data-kind='Petit-déjeuner']"); await page.wait_for_timeout(300)
        check("★ Habituel : fenêtre avec les aliments du repas", await ev("document.getElementById('template-dialog').open") and await page.locator(".template-item").count() == 2)
        await page.fill("#template-form [name=name]", "Petit-déj salle")
        await page.click("#template-form button[type=submit]"); await page.wait_for_timeout(500)
        t = await ev("state.mealTemplates[0]")
        check("Repas habituel enregistré (nom, moment, aliments sans identifiant ni date)", t and t["name"] == "Petit-déj salle" and t["kind"] == "Petit-déjeuner" and len(t["items"]) == 2 and "id" not in t["items"][0] and "date" not in t["items"][0], t)
        check("Affiché dans l'ajout rapide avec ses calories", "Petit-déj salle" in await page.inner_text("#quick-templates") and "306 kcal" in (await page.inner_text("#quick-templates")).replace(" ", " "))
        await ev("setNutritionDate(addDays(today(), -2))"); await page.wait_for_timeout(300)
        await page.click("[data-quick=add-template]"); await page.wait_for_timeout(500)
        d2 = await ev("state.dayMeals.map(m => [m.name, m.kind, m.date])")
        d_2 = await ev("addDays(today(), -2)")
        check("Repas habituel ajouté en 1 appui au jour affiché (avant-hier)", len(d2) == 2 and all(x[2] == d_2 and x[1] == "Petit-déjeuner" for x in d2), d2)
        await ev("setNutritionDate(today())"); await page.wait_for_timeout(300)
        await page.click("#templates-manage"); await page.click("[data-quick=edit-template] >> nth=0"); await page.wait_for_timeout(300)
        await page.click("[data-remove-item='0']")
        await page.fill("#template-form [name=name]", "Petit-déj léger")
        await page.click("#template-form button[type=submit]"); await page.wait_for_timeout(500)
        t = await ev("state.mealTemplates[0]")
        check("Gérer → modifier : un aliment retiré, renommé", t["name"] == "Petit-déj léger" and len(t["items"]) == 1, t)
        await page.click("[data-quick=edit-template] >> nth=0"); await page.wait_for_timeout(300)
        await page.click("#template-delete"); await page.wait_for_timeout(500)
        check("Supprimer un repas habituel (le journal reste intact)", await ev("state.mealTemplates.length") == 0 and await ev("state.dayMeals.length") == 4)

        # ================= Recettes =================
        await page.click("#recipe-new"); await page.wait_for_timeout(500)
        await page.fill("#recipe-form [name=name]", "Bolognaise maison")
        async def add_ing(query, grams):
            await page.fill("#recipe-search", query); await page.dispatch_event("#recipe-search", "input"); await page.wait_for_timeout(600)
            await page.click("#recipe-suggestions .food-chip >> nth=0"); await page.wait_for_timeout(150)
            row = page.locator("[data-ing-row]").last
            await row.locator("[data-ing=grams]").fill(grams); await row.locator("[data-ing=grams]").dispatch_event("input")
        await add_ing("boeuf steak hache 15 cru", "500")
        await add_ing("tomate ronde crue", "800")
        # Ingrédient à la main, d'abord incomplet
        await page.click("#recipe-manual"); await page.wait_for_timeout(150)
        row = page.locator("[data-ing-row]").last
        await row.locator("[data-ing=name]").fill("Huile d'olive"); await row.locator("[data-ing=name]").dispatch_event("input")
        await row.locator("[data-ing=grams]").fill("20"); await row.locator("[data-ing=grams]").dispatch_event("input")
        await page.click("#recipe-form button[type=submit]"); await page.wait_for_timeout(300)
        check("Ingrédient à la main sans kcal : enregistrement refusé avec explication", "kcal pour 100 g" in await page.inner_text("#toast") and await ev("state.recipes.length") == 0, await page.inner_text("#toast"))
        await row.locator("[data-p100=kcal]").fill("900"); await row.locator("[data-p100=kcal]").dispatch_event("input")
        await row.locator("[data-p100=fat]").fill("100"); await row.locator("[data-p100=fat]").dispatch_event("input")
        # Scan d'un ingrédient emballé (Open Food Facts simulé), sans toucher au formulaire de repas
        await ev("mealForm().elements.name.value = ''")
        await page.click("#recipe-scan"); await page.wait_for_timeout(300)
        await ev("() => { window.__scan = scanImageData; scanImageData = () => null; }")
        await page.fill("#scan-manual [name=code]", "3017620422003"); await page.click("#scan-manual button[type=submit]"); await page.wait_for_timeout(800)
        ings = await ev("recipeDraft.ingredients.map(i => i.name)")
        check("Scan dans une recette : ingrédient ajouté, formulaire de repas intact", ings[-1] == "Crème légère test (MarqueTest)" and await ev("mealForm().elements.name.value") == "" and not await ev("document.getElementById('scan-dialog').open"), ings)
        row = page.locator("[data-ing-row]").last
        await row.locator("[data-ing=grams]").fill("100"); await row.locator("[data-ing=grams]").dispatch_event("input")
        await page.fill("#recipe-form [name=cookedGrams]", "1200"); await page.dispatch_event("#recipe-form [name=cookedGrams]", "input")
        expected = await ev("""(() => { const t = recipeTotals(recipeDraft.ingredients); return { kcal: t.kcal, grams: t.grams, per100: round(t.kcal * 100 / 1200, 1) }; })()""")
        summary = (await page.inner_text("#recipe-summary")).replace(" ", " ")
        check("Résumé : total, poids cru → cuit, valeurs pour 100 g", "1 420 g cru → 1 200 g cuit" in summary and f"{round(expected['per100'])} kcal" in summary, summary)
        await page.click("#recipe-form button[type=submit]"); await page.wait_for_timeout(500)
        r = await ev("state.recipes[0]")
        check("Recette enregistrée (4 ingrédients, poids cuit)", r and r["name"] == "Bolognaise maison" and len(r["ingredients"]) == 4 and r["cookedGrams"] == 1200, r and r["ingredients"])
        p100 = await ev("recipePer100(state.recipes[0])")
        check("Valeurs pour 100 g calculées sur le poids cuit", abs(p100["kcal"] - expected["kcal"] * 100 / 1200) < 0.1, (p100, expected))
        # Utilisation dans le journal
        await page.fill("#meal-form [name=name]", "bolo"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(400)
        chip = await ev("document.querySelector('#food-suggestions .food-chip.recipe')?.textContent")
        check("La recette sort en premier dans la recherche d'aliments", chip and chip.startswith("Recette · Bolognaise maison"), chip)
        await page.click("#food-suggestions .food-chip.recipe")
        await page.fill("#meal-form [name=grams]", "350"); await page.dispatch_event("#meal-form [name=grams]", "input")
        kcal = await page.input_value("#meal-form [name=kcal]")
        check("Portion de 350 g : calories calculées", kcal == str(round(p100["kcal"] * 3.5)), (kcal, p100["kcal"]))
        await page.click("#meal-submit"); await page.wait_for_timeout(400)
        check("Repas enregistré avec les valeurs pour 100 g de la recette", await ev("state.dayMeals.some(m => m.name === 'Bolognaise maison' && m.grams === 350 && m.per100.kcal === recipePer100(state.recipes[0]).kcal)"))
        await page.click("[data-recipe-action=use]"); await page.wait_for_timeout(300)
        check("« Utiliser » remplit le formulaire et place le curseur sur les grammes", await page.input_value("#meal-form [name=name]") == "Bolognaise maison" and await ev("document.activeElement.name") == "grams")
        await ev("resetMealForm()")
        await page.click("[data-recipe-action=edit]"); await page.wait_for_timeout(400)
        await page.fill("#recipe-form [name=cookedGrams]", "1000"); await page.click("#recipe-form button[type=submit]"); await page.wait_for_timeout(500)
        check("Modifier le poids cuit change les valeurs pour 100 g", abs(await ev("recipePer100(state.recipes[0]).kcal") - expected["kcal"] / 10) < 0.1)

        # ================= Données : sauvegarde, import, contrôle =================
        norm = await ev("""[normalizeRecord({type:'recipe',date:today(),name:'X',ingredients:[{name:'a',grams:100}]}),
          normalizeRecord({type:'mealTemplate',date:today(),name:'Y',items:[]}),
          normalizeRecord({type:'mealTemplate',date:today(),name:'<b>Z</b>',kind:'Dîner',items:[{name:'Riz',kcal:200,grams:150,evil:'x'}]}).record]""")
        check("Contrôle des fiches reçues ou importées (vides refusées, champs inconnus retirés)", norm[0] is None and norm[1] is None and "evil" not in norm[2]["items"][0] and norm[2]["items"][0]["kcal"] == 200, norm[2])
        exported = await ev("""(async () => { const { blob } = await buildBackupBlob(); return JSON.parse(await blob.text()).records.map(r => r.type); })()""")
        check("La sauvegarde contient les recettes (et repas habituels)", "recipe" in exported, sorted(set(exported)))

        await page.click("button[data-view=nutrition]")
        await page.click("[data-recipe-action=edit]"); await page.wait_for_timeout(300)
        await page.click("#recipe-delete"); await page.wait_for_timeout(500)
        check("Supprimer une recette (les repas notés restent)", await ev("state.recipes.length") == 0 and await ev("state.dayMeals.some(m => m.name === 'Bolognaise maison')"))

        # ================= Poids du corps (3.3) =================
        await page.click("button[data-view=training]")
        await ev("resetWorkoutForm(); workoutForm().elements.session.value = FREE_SESSION_ID; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.click("#add-exercise")
        blk = page.locator(".exercise-block").last
        await blk.locator(".exercise-name").fill("Pompes"); await blk.locator(".exercise-name").dispatch_event("change")
        check("« Pompes » reconnu : poids du corps, case de charge = lest facultatif",
              await ev("document.querySelector('.exercise-block:last-child').classList.contains('is-bw')")
              and await blk.locator('[data-field="load"]').first.get_attribute("placeholder") == "PDC"
              and await blk.locator(".bw-toggle").get_attribute("aria-pressed") == "true")
        check("Détection : « Machine à dips » reste à charge, « Tractions » au poids du corps",
              await ev("[isBodyweightName('Machine à dips'), isBodyweightName('Tractions pronation'), isBodyweightName('Chest press'), isBodyweightName('Fentes haltères')]") == [False, True, False, False])
        for i, r in enumerate(["20", "18", "15"]):
            await blk.locator(".set-row").nth(i).locator('[data-field="reps"]').fill(r)
        await blk.locator(".set-row").nth(2).locator('[data-field="load"]').fill("10")
        await page.click("#add-exercise")
        blk2 = page.locator(".exercise-block").last
        await blk2.locator(".exercise-name").fill("Gainage latéral"); await blk2.locator(".exercise-name").dispatch_event("change")
        await blk2.locator(".bw-toggle").click()
        check("Bouton « Poids du corps » : on peut l'enlever à la main", not await ev("document.querySelector('.exercise-block:last-child').classList.contains('is-bw')"))
        await ev("document.querySelector('.exercise-block:last-child').remove()")
        await page.click("#workout-submit"); await page.wait_for_timeout(500)
        ex = await ev("state.workouts[0].exercises[0]")
        check("Séance enregistrée : poids du corps, sans charge sauf le lest", ex["bodyweight"] is True and ex["sets"] == [{"load": None, "reps": 20}, {"load": None, "reps": 18}, {"load": 10, "reps": 15}], ex)
        check("Affichage « PDC × 20 » et « PDC+10 × 15 »", [x.replace("\xa0", " ") for x in await ev("[fmtSet({load:null,reps:20}, true), fmtSet({load:10,reps:15}, true)]")] == ["PDC × 20", "PDC+10 × 15"])
        # 2e séance : plus de reps → record au poids du corps
        await ev("workoutForm().elements.session.value = FREE_SESSION_ID; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.click("#add-exercise")
        blk = page.locator(".exercise-block").last
        await blk.locator(".exercise-name").fill("Pompes"); await blk.locator(".exercise-name").dispatch_event("change")
        meta = (await blk.locator(".exercise-meta").inner_text()).replace("\xa0", " ")
        check("La fois suivante : dernière fois et record en reps", "PDC × 20" in meta and "20 reps au poids du corps" in meta, meta)
        await blk.locator(".set-row").nth(0).locator('[data-field="reps"]').fill("23")
        await page.click("#workout-submit"); await page.wait_for_timeout(500)
        check("Record battu au poids du corps annoncé", "Pompes 23 reps au poids du corps" in await page.inner_text("#toast"), await page.inner_text("#toast"))
        hist = (await page.inner_text("#workout-history")).replace("\xa0", " ")
        check("Journal des séances : « PDC × 23 » et charges normales intactes (70 × 9+6)", "PDC × 23" in hist and "70 × 9+6" in hist and "PDC+70" not in hist, hist[:300])
        await page.click("button[data-view=progress]"); await page.wait_for_timeout(200)
        await page.select_option("#progress-exercise", "Pompes"); await page.wait_for_timeout(200)
        prog = await page.inner_text("#exercise-progress")
        check("Progression au poids du corps : record et courbe en reps", "23 reps" in prog and "Total" in prog, prog[:120])
        coach = await ev("""(async () => { const data = await buildPeriodExport(addDays(today(), -1), today()); return JSON.stringify(data); })()""")
        check("Export coach : « poids_du_corps » et lest en charge_kg", '"poids_du_corps":true' in coach, coach[:200])
        # Mode séance : lest
        await page.click("button[data-view=training]")
        await ev("workoutForm().elements.session.value = FREE_SESSION_ID; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.click("#add-exercise")
        blk = page.locator(".exercise-block").last
        await blk.locator(".exercise-name").fill("Pompes"); await blk.locator(".exercise-name").dispatch_event("change")
        await page.click("#session-open"); await page.wait_for_timeout(300)
        lab = await ev("document.querySelector('.sm-field .sm-field-label').textContent")
        check("Mode séance au poids du corps : « Lest (facultatif) », gris « PDC »", lab == "Lest (facultatif)" and await page.get_attribute("[data-sm-field=load]", "placeholder") == "PDC")
        await page.click("[data-sm-action=done-no-rp]"); await page.wait_for_timeout(100)
        check("Série au poids du corps notée sans charge", await ev("readEditor()[0].sets[0]") == {"load": None, "reps": 23} and "PDC × 23" in await page.inner_text("#sm-sets"))
        await page.click("#sm-close"); await ev("stopRestTimer(); resetWorkoutForm()")

        # ================= Il te reste (3.3) =================
        await ev("""(async () => { state.targets = { ...state.targets, kcal: 2200, protein: 180 };
          await saveRecords([{id:'h1',type:'meal',date:addDays(today(),-4),kind:'Collation',name:'Skyr nature',grams:200,kcal:120,protein:21,carbs:7.6,fat:0.4,fiber:0,per100:{kcal:60,protein:10.5,carbs:3.8,fat:0.2,fiber:0}},
            {id:'h2',type:'meal',date:addDays(today(),-4),kind:'Collation',name:'Chips',grams:45,kcal:240,protein:3,carbs:24,fat:15,fiber:2}]);
          await reloadMeals(); })()""")
        await page.click("button[data-view=nutrition]"); await page.wait_for_timeout(300)
        t = await ev("mealTotals(state.dayMeals)")
        rem = (await page.inner_text("#remaining-text")).replace("\u202f", " ")
        check("Il te reste : calories et protéines restantes", f"{round(2200 - t['kcal'])} kcal" in rem.replace(" ", "") or f"{2200 - round(t['kcal'])}" in rem.replace(" ", ""), (rem, t))
        ideas = await ev("remainingIdeas.map(f => f.name)")
        check("Idées : tes aliments protéinés d'abord (skyr), pas les chips ; pas d'œufs", ideas and ideas[0] == "Skyr nature" and "Chips" not in ideas and not any("œuf" in i.lower() for i in ideas), ideas)
        await page.click("[data-remaining='0']"); await page.wait_for_timeout(200)
        check("Un appui pré-remplit le formulaire (portion habituelle)", await page.input_value("#meal-form [name=name]") == "Skyr nature" and await page.input_value("#meal-form [name=grams]") == "200" and await page.input_value("#meal-form [name=kcal]") == "120")
        await ev("resetMealForm()")
        # Calories presque atteintes : portion réduite
        await ev("""(async () => { state.targets = { ...state.targets, kcal: Math.round(mealTotals(state.dayMeals).kcal) + 90 }; renderNutrition(); })()""")
        ideas = await ev("remainingIdeas.map(f => [f.name, Math.round(f.grams), Math.round(f.kcal)])")
        check("Peu de calories restantes : portion réduite pour rentrer (skyr 140 g ≤ 90 kcal)", ["Skyr nature", 140, 84] in ideas or ["Skyr nature", 150, 90] in ideas, ideas)
        await ev("setNutritionDate(addDays(today(), -1))"); await page.wait_for_timeout(200)
        check("« Il te reste » seulement pour aujourd'hui", not await page.is_visible("#remaining-panel"))
        await ev("setNutritionDate(today())"); await page.wait_for_timeout(200)

        # ================= Nutri-Score / NOVA (3.3) =================
        await page.click("#scan-open"); await page.wait_for_timeout(300)
        await page.fill("#scan-manual [name=code]", "3017620422003"); await page.click("#scan-manual button[type=submit]"); await page.wait_for_timeout(800)
        check("Scan : Nutri-Score et NOVA annoncés et affichés sous le formulaire",
              "Nutri-Score D · NOVA 4 (ultra-transformé)" in await page.inner_text("#toast") and await page.is_visible("#product-badges .ns-d") and await page.is_visible("#product-badges .nova-4"))
        await page.click("#meal-submit"); await page.wait_for_timeout(400)
        m = await ev("state.dayMeals.find(x => x.name.startsWith('Crème légère'))")
        check("Entrée enregistrée avec ses scores, badges dans le journal", m["nutriscore"] == "d" and m["nova"] == 4 and await page.locator("#meal-history .badge.ns-d").count() == 1)
        check("Formulaire vidé : plus de badges", not await page.is_visible("#product-badges"))
        await page.fill("#meal-form [name=name]", "creme leg"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(300)
        await page.click("#food-suggestions .food-chip.history")
        check("Reprise depuis tes aliments : les scores suivent", await page.is_visible("#product-badges .ns-d"))
        await page.fill("#meal-form [name=name]", "riz basmati"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(500)
        await page.click("#food-suggestions .food-chip.ciqual >> nth=0")
        check("Aliment Ciqual choisi ensuite : badges retirés", not await page.is_visible("#product-badges"))
        await ev("resetMealForm()")
        norm = await ev("normalizeRecord({type:'meal',date:today(),name:'X',kcal:10,nutriscore:'Z',nova:9}).record")
        check("Scores invalides ignorés à l'import", "nutriscore" not in norm and "nova" not in norm, norm)
        coach = await ev("""(async () => JSON.stringify(await buildPeriodExport(today(), today())))()""")
        check("Export coach : nutriscore et nova des aliments scannés", '"nutriscore":"d"' in coach and '"nova":4' in coach)

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
