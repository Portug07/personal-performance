"""Tests de la version 3.4 (nutrition rapide) : aliments fréquents, portions sans balance, cru / cuit,
saisie express, repas habituel repéré tout seul, trous dans le journal ; version 3.6 : menu de la journée.

Usage (depuis le dossier de l'application) :
    python test_nutrition.py
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
  const recs = [];
  let k = 0;
  const meal = (date, kind, name, grams, kcal, protein, per100, extra = {}) => recs.push({ id: 'm' + (k++), type: 'meal', date, kind, name, grams, kcal, protein, carbs: 0, fat: 0, fiber: 0, per100, ...extra });
  const skyr = { kcal: 60, protein: 10.5, carbs: 3.8, fat: 0.2, fiber: 0 };
  const flocons = { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10 };
  for (let n = 2; n <= 12; n++) {
    meal(d(n), 'Déjeuner', 'Poulet riz', 400, 620, 48, null);
    meal(d(n), 'Dîner', 'Pâtes bolo', 450, 700, 35, null);
  }
  meal(d(2), 'Petit-déjeuner', 'Skyr nature', 200, 120, 21, skyr);
  meal(d(2), 'Petit-déjeuner', "Flocons d'avoine", 50, 186, 6.8, flocons);
  meal(d(3), 'Petit-déjeuner', 'Skyr nature', 200, 120, 21, skyr);
  meal(d(3), 'Petit-déjeuner', "Flocons d'avoine", 50, 186, 6.8, flocons);
  meal(d(4), 'Petit-déjeuner', 'Skyr nature', 150, 90, 15.8, skyr);
  meal(d(5), 'Collation', 'Barre protéinée', 60, 210, 20, null, { quantity: '1 pièce' });
  meal(d(6), 'Collation', 'Chips', 45, 240, 3, null);
  /* Hier : petit-déj et déjeuner, mais pas de dîner. */
  meal(d(1), 'Petit-déjeuner', 'Skyr nature', 200, 120, 21, skyr);
  meal(d(1), 'Déjeuner', 'Poulet riz', 400, 620, 48, null);
  await saveRecords(recs);
  await reloadAll();
})()"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        ev = page.evaluate
        await page.goto(BASE); await page.wait_for_timeout(1000)
        await ev(SEED)
        await page.click("button[data-view=nutrition]"); await page.wait_for_timeout(300)
        await ev("resetMealForm()")

        # ---------- Aliments fréquents ----------
        chips = await ev("[...document.querySelectorAll('#food-suggestions .food-chip.frequent')].map(b => b.textContent)")
        check("Champ vide : tes aliments fréquents avec leur portion", chips and any(c.startswith("Poulet riz · 400 g") for c in chips) and any(c.startswith("Skyr nature · 200 g") for c in chips) and not any("Chips" in c for c in chips), chips)
        await page.click("#food-suggestions .food-chip.frequent:has-text('Skyr nature')")
        check("Un appui : nom, grammes et valeurs remplis", await page.input_value("#meal-form [name=name]") == "Skyr nature" and await page.input_value("#meal-form [name=grams]") == "200" and await page.input_value("#meal-form [name=kcal]") == "120")
        await ev("resetMealForm()")

        # ---------- Portions sans balance ----------
        await page.fill("#meal-form [name=name]", "banane"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(300)
        await page.click("#food-suggestions .food-chip[data-food='Banane']")
        await page.fill("#portion-count", "2"); await page.select_option("#portion-unit", "piece"); await page.wait_for_timeout(100)
        check("2 pièces de banane = 240 g, calories calculées", await page.input_value("#meal-form [name=grams]") == "240" and await page.input_value("#meal-form [name=quantity]") == "2 pièces" and await page.input_value("#meal-form [name=kcal]") == "214")
        await ev("resetMealForm()")
        await page.fill("#meal-form [name=name]", "huile"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(300)
        await page.click("#food-suggestions .food-chip[data-food=\"Huile d'olive\"]")
        await page.select_option("#portion-unit", "cs"); await page.wait_for_timeout(100)
        check("1 c. à soupe d'huile = 10 g (poids propre à l'huile)", await page.input_value("#meal-form [name=grams]") == "10" and await page.input_value("#meal-form [name=kcal]") == "88")
        await ev("resetMealForm()")
        await page.fill("#meal-form [name=name]", "barre prot"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(300)
        await page.click("#food-suggestions .food-chip.history:has-text('Barre protéinée')")
        await page.fill("#portion-count", "2"); await page.select_option("#portion-unit", "piece"); await page.wait_for_timeout(100)
        check("Portion apprise de ton historique (1 pièce = 60 g → 2 pièces = 120 g)", await page.input_value("#meal-form [name=grams]") == "120")
        await ev("resetMealForm()")
        await page.fill("#meal-form [name=name]", "Truc maison"); await page.select_option("#portion-unit", "piece"); await page.wait_for_timeout(100)
        check("Pièce inconnue : explication, rien d'inventé", "Poids inconnu" in await page.inner_text("#portion-result") and await page.input_value("#meal-form [name=grams]") == "")
        await ev("resetMealForm()")

        # ---------- Cru / cuit ----------
        await page.fill("#meal-form [name=name]", "riz blanc cru"); await page.dispatch_event("#meal-form [name=name]", "input"); await page.wait_for_timeout(1200)
        await page.click("#food-suggestions .food-chip.ciqual >> nth=0")
        raw_kcal = await ev("mealPer100.kcal")
        check("Aliment cru choisi : « Pesé : cru / cuit » proposé", await page.is_visible("#cook-row") and await page.get_attribute("[data-cook=raw]", "aria-pressed") == "true", raw_kcal)
        await page.fill("#meal-form [name=grams]", "260"); await page.dispatch_event("#meal-form [name=grams]", "input")
        await page.click("[data-cook=cooked]"); await page.wait_for_timeout(100)
        kcal = int(await page.input_value("#meal-form [name=kcal]"))
        hint = await page.inner_text("#cook-hint")
        check("260 g pesés cuits ≈ 100 g de riz cru : calories converties", abs(kcal - raw_kcal) <= 2 and "100 g crus" in hint and "pesé cuit" in await page.input_value("#meal-form [name=quantity]"), (kcal, raw_kcal, hint))
        await page.click("[data-cook=raw]"); await page.wait_for_timeout(100)
        check("Retour à « cru » : valeurs d'origine", int(await page.input_value("#meal-form [name=kcal]")) == round(raw_kcal * 2.6) and "pesé" not in await page.input_value("#meal-form [name=quantity]"))
        await page.click("[data-cook=cooked]")
        await page.click("#meal-submit"); await page.wait_for_timeout(400)
        saved = await ev("state.dayMeals.find(m => m.name.startsWith('Riz'))")
        check("Enregistré avec les valeurs du poids cuit", saved and saved["grams"] == 260 and abs(saved["per100"]["kcal"] - raw_kcal / 2.6) < 0.5, saved and saved["per100"])
        check("Aliment sans cuisson (banane) : pas de choix cru / cuit", await ev("(() => { chooseFood(FOODS.find(f => f.name === 'Banane')); return document.getElementById('cook-row').hidden; })()"))
        check("« Chorizo » ne passe pas pour du riz", await ev("cookInfo('Chorizo, cru') === null && portionGrams('Chorizo', 'cs') === 15"))
        await ev("resetMealForm()")

        # ---------- Saisie express ----------
        parsed = await ev("""['200 g skyr', "50g de flocons d'avoine", '1 banane', "1 c. à soupe d'huile d'olive", 'riz basmati 150 g', 'deux tranches de pain complet', '1,5 kg de patates'].map(t => { const p = parseExpressItem(t); return [p.qty, p.unit, p.query.join(' ')]; })""")
        check("Lecture des quantités et unités", parsed == [[200, "g", "skyr"], [50, "g", "flocons avoine"], [1, None, "banane"], [1, "cs", "huile olive"], [150, "g", "riz basmati"], [2, "tranche", "pain complet"], [1.5, "kg", "patates"]], parsed)
        check("Découpage : virgules, « et », mais pas « 1,5 »", await ev("splitExpress('200 g skyr, 1,5 kg riz et 1 banane + 2 kiwis')") == ["200 g skyr", "1,5 kg riz", "1 banane", "2 kiwis"])
        await page.click("#express-open"); await page.wait_for_timeout(500)
        await page.fill("#express-text", "200 g skyr, 50 g flocons d'avoine, 1 banane, 1 c. à soupe d'huile d'olive, zzqx"); await page.dispatch_event("#express-text", "input")
        await page.wait_for_timeout(900)
        lines = await ev("expressLines.map(l => [l.candidates[l.choice] && l.candidates[l.choice].name, l.grams])")
        check("Aliments reconnus (tes aliments d'abord) et grammes proposés", lines[:4] == [["Skyr nature", 200], ["Flocons d'avoine", 50], ["Banane", 120], ["Huile d'olive", 10]] and lines[4] == [None, None], lines)
        btn = await page.inner_text("#express-add")
        check("Bouton : 4 aliments et total des calories", btn.startswith("Ajouter 4 aliments"), btn)
        await page.select_option("#express-kind", "Petit-déjeuner")
        n0 = await ev("state.dayMeals.length")
        await page.click("#express-add"); await page.wait_for_timeout(500)
        added = await ev(f"state.dayMeals.slice().sort((a,b)=>a.createdAt-b.createdAt).slice({n0}).map(m => [m.name, m.kind, m.grams, m.kcal])")
        check("Tout ajouté d'un coup, en petit-déjeuner ; ligne inconnue ignorée", len(added) == 4 and all(a[1] == "Petit-déjeuner" for a in added) and "1 ligne ignorée" in await page.inner_text("#toast"), added)
        await page.click(".toast-action"); await page.wait_for_timeout(400)
        check("Annuler retire les 4 entrées", await ev("state.dayMeals.length") == n0)
        # Choisir un autre aliment dans la liste
        await page.click("#express-open"); await page.wait_for_timeout(300)
        await page.fill("#express-text", "150 g riz"); await page.dispatch_event("#express-text", "input"); await page.wait_for_timeout(700)
        opts = await ev("[...document.querySelectorAll('[data-express-choice] option')].map(o => o.textContent)")
        await page.select_option("[data-express-choice]", "1"); await page.wait_for_timeout(100)
        check("Plusieurs aliments proposés, on peut changer", len(opts) >= 2 and await ev("expressLines[0].choice") == 1, opts)
        await page.click("#express-cancel")

        # ---------- Repas habituel repéré ----------
        await ev("""(async () => { await saveRecords([
          {id:'t1',type:'meal',date:today(),kind:'Petit-déjeuner',name:'Skyr nature',grams:200,kcal:120,protein:21,carbs:0,fat:0,fiber:0},
          {id:'t2',type:'meal',date:today(),kind:'Petit-déjeuner',name:"Flocons d'avoine",grams:50,kcal:186,protein:6.8,carbs:0,fat:0,fiber:0}]); await reloadMeals(); renderNutrition(); })()""")
        txt = await page.inner_text("#meal-history")
        check("3e fois le même petit-déjeuner : proposition d'en faire un repas habituel", "exactement ce petit-déjeuner 3 fois" in txt.replace(" ", " "), txt[:150])
        await page.click(".combo-hint [data-quick=save-template]"); await page.wait_for_timeout(300)
        check("« Oui » ouvre l'enregistrement du repas habituel", await ev("document.getElementById('template-dialog').open") and await page.locator(".template-item").count() == 2)
        await page.click("#template-cancel")
        await page.click(".combo-hint [data-quick=combo-dismiss]"); await page.wait_for_timeout(200)
        await ev("renderNutrition()")
        check("« Non merci » : plus proposé", await page.locator(".combo-hint").count() == 0)
        await ev("localRemove('pp-combo-dismissed'); (async () => { await saveRecord({id:'tpl',type:'mealTemplate',date:today(),name:'PDJ',kind:'Petit-déjeuner',items:[{name:'Skyr nature',kcal:120},{name:\"Flocons d'avoine\",kcal:186}]}); await reloadMeals(); renderNutrition(); })()")
        await page.wait_for_timeout(300)
        check("Déjà en repas habituel : plus proposé", await page.locator(".combo-hint").count() == 0)

        # ---------- Trous dans le journal ----------
        gaps = await ev("findGaps().map(g => [g.date === addDays(today(), -1), g.kind])")
        check("Hier sans dîner (que tu notes d'habitude) : signalé ; le petit-déj non habituel ne l'est pas", gaps == [[True, "Dîner"]], gaps)
        check("Panneau « Il manque » visible", await page.is_visible("#gaps-panel") and "Hier · pas de dîner noté" in (await page.inner_text("#gaps-list")).replace(" ", " "))
        await page.click("[data-gap=skipped]"); await page.wait_for_timeout(400)
        sk = await ev("getByTypeRange('meal', addDays(today(),-1), addDays(today(),-1)).then(l => l.filter(m => m.kind === 'Dîner').map(m => [m.name, m.kcal]))")
        check("« Pas mangé » : repas sauté noté (0 kcal), plus signalé", sk == [["Repas sauté", 0]] and not await page.is_visible("#gaps-panel"), sk)
        await page.click(".toast-action"); await page.wait_for_timeout(400)
        check("Annuler : le trou revient", await page.is_visible("#gaps-panel"))
        await page.click("[data-gap=enter]"); await page.wait_for_timeout(400)
        check("« Saisir » : jour d'hier affiché, repas Dîner prêt", await ev("state.nutritionDate === addDays(today(), -1)") and await page.input_value("#meal-form [name=kind]") == "Dîner")
        await ev("setNutritionDate(today())"); await page.wait_for_timeout(200)
        await page.click("[data-gap=dismiss]"); await page.wait_for_timeout(200)
        check("« Ignorer » : plus signalé", not await page.is_visible("#gaps-panel"))
        check("Aucun trou signalé avant ton premier jour de saisie", await ev("(() => { const keep = state.recentMeals; state.recentMeals = keep.filter(m => m.date >= addDays(today(), -1)); const g = findGaps(); state.recentMeals = keep; return g.length; })()") == 0)

        # ---------- Version 3.6 : menu de la journée généré ----------
        await ev("(async () => { state.nutritionDate = today(); await reloadMeals(); renderNutrition(); })()")
        await ev("(async () => { const t = { ...state.targets, kcal: 0, protein: 0 }; await setSetting('targets', t); state.targets = t; renderNutrition(); })()")
        check("Sans objectif de calories : pas de bouton menu", not await page.is_visible("#menu-open"))
        err = await ev("generateDayMenu().error")
        check("Sans objectif : message clair", "objectif de calories" in (err or ""), err)
        await ev("""(async () => { const t = { ...state.targets, kcal: 2200, protein: 160 }; await setSetting('targets', t); state.targets = t;
          await saveRecords([{ id: 'skip1', type: 'meal', date: addDays(today(), -2), kind: 'Dîner', name: 'Repas sauté', kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }]);
          await reloadAll(); renderNutrition(); })()""")
        opts = await ev("MENU_KINDS.map(k => menuOptions(k).map(o => o.label))")
        check("Idées tirées de ce que tu manges (repas notés, aliments fréquents), sans « Repas sauté »",
              any("Poulet riz" in l for l in opts[1]) and opts[3] == ["Pâtes bolo"] and len(opts[0]) == 2 and not any("sauté" in l for ls in opts for l in ls), opts)
        check("Collation : pas de plat de 600 kcal proposé", "Poulet riz" not in opts[2] and "Barre protéinée" in opts[2], opts[2])
        # Journée vierge, 9 h du matin : les 4 repas restent à faire.
        await ev("""(async () => { window.menuHour = () => 9; for (const m of state.dayMeals) await deleteRecord(m.id);
          localRemove(MENU_KEY); await reloadMeals(); renderNutrition(); })()""")
        tot = await ev("""(() => { const r = planMenu(MENU_KINDS, 2200, 160); const items = MENU_KINDS.flatMap(k => scaleItems(r.picks[k].option.items, r.picks[k].scale));
          const t = menuItemTotals(items); return [Math.round(t.kcal), Math.round(t.protein), MENU_KINDS.map(k => r.picks[k].option.label)]; })()""")
        check("Journée complète proposée près des 2200 kcal (± 10 %)", abs(tot[0] - 2200) <= 220, tot)
        other = await ev("""(() => { const first = planMenu(['Petit-déjeuner'], 400, 30).picks['Petit-déjeuner'].option;
          const r = planMenu(['Petit-déjeuner'], 400, 30, {}, { 'Petit-déjeuner': [comboSignature(first.items)] });
          return [first.label, r.picks['Petit-déjeuner'].option.label]; })()""")
        check("« Autre idée » : propose autre chose pour ce repas", other[0] != other[1], other)
        check("Bouton « Génère la suite de ma journée » dans « Il te reste »", await page.is_visible("#menu-open"),
              await ev("[state.targets.kcal, mealTotals(state.dayMeals).kcal, remainingKinds()]"))
        await page.click("#menu-open"); await page.wait_for_timeout(300)
        kinds = await ev("remainingKinds()")
        shown = await page.locator("#menu-result .menu-meal").count()
        check("Menu affiché pour chaque repas qui reste aujourd'hui", await page.is_visible("#menu-dialog") and len(kinds) == 4 and shown == 4 and "Total proposé" in await page.inner_text("#menu-result"), (kinds, shown))
        await ev("window.menuHour = () => 16")
        check("À 16 h : plus de petit-déjeuner ni de déjeuner proposés", await ev("remainingKinds()") == ["Collation", "Dîner"])
        await ev("window.menuHour = () => 9")
        first_label = await page.inner_text("#menu-result .menu-meal >> nth=0")
        await page.click("#menu-close"); await page.click("#menu-open"); await page.wait_for_timeout(300)
        check("Rouvert : le même menu (gardé pour la journée)", await page.inner_text("#menu-result .menu-meal >> nth=0") == first_label)
        n_before = await ev("state.dayMeals.length")
        k0 = kinds[0]
        await page.click("#menu-result [data-menu-add] >> nth=0"); await page.wait_for_timeout(600)
        added = await ev(f"state.dayMeals.filter(m => m.kind === {k0!r}).length")
        check("« Je l'ai mangé » : repas ajouté au journal et retiré du menu",
              added >= 1 and await ev("state.dayMeals.length") > n_before and await page.locator("#menu-result .menu-meal").count() == shown - 1 and "Annuler" in await page.inner_text("#toast"), (k0, added))
        await page.click("#toast button"); await page.wait_for_timeout(600)
        check("Annuler : le repas ajouté est retiré", await ev("state.dayMeals.length") == n_before)
        await page.click("#menu-close")

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
