"""Tests de la version 3.5 (musculation) : générateur de séance, remplacement d'exercice, plateaux,
progression automatique, renommer / fusionner, import du programme du coach.

Usage (depuis le dossier de l'application) :
    python test_training.py
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

SEED = """(async () => {
  const d = (n) => addDays(today(), -n);
  const W = [];
  const rp = (load, reps, rpReps) => ({ load, reps, rpReps, rpPause: 20 });
  const push = (date, id, cp) => W.push({id, type:'workout', date, sessionId:'push', sessionType:'Push', exercises:[
    {exerciseId:'chest-press',name:'Chest press',sets:[rp(70, cp, 6), rp(70, 8, 5), rp(75, 6, 4), rp(75, 6, 3)]},
    {exerciseId:'butterfly',name:'Butterfly',sets:[rp(65, 9, 6), rp(65, 9, 5)]},
    {exerciseId:'elevations-laterales',name:'Élévations latérales',sets:[rp(14, 11, 5)]},
    {exerciseId:'extension-triceps',name:'Extension triceps',sets:[rp(70, 9, 5)]}]});
  const pull = (date, id, row) => W.push({id, type:'workout', date, sessionId:'pull', sessionType:'Pull', exercises:[
    {exerciseId:'rowing-machine',name:'Rowing machine',sets:[rp(65, 10, 5), rp(65, 9, 4)]},
    {exerciseId:'tirage-vertical',name:'Tirage vertical',sets:[rp(70, row, 5), rp(70, 8, 4)]},
    {exerciseId:'curl-biceps-machine',name:'Curl biceps machine',sets:[rp(40, 10, 5)]}]});
  /* Rowing machine : toujours 65 × 10 → plateau. Tirage vertical : progresse. Chest press : 12 reps la dernière fois → +palier. */
  pull(d(9),'p1',7); push(d(8),'u1',9); pull(d(7),'p2',8); push(d(6),'u2',10); pull(d(4),'p3',9); push(d(3),'u3',11); pull(d(2),'p4',10); push(d(1),'u4',12);
  await saveRecords(W); await reloadAll(); renderSessionOptions(); resetWorkoutForm();
})()"""

COACH_TEXT = """Voici ton nouveau programme. Copie le bloc ci-dessous dans l'app :
```json
{"programme": {"seances": [
  {"nom": "Push", "exercices": [
    {"nom": "Chest press", "methode": "rest-pause", "series": 4, "cible_reps": 15, "monter_a": 12, "pause_s": 20, "palier_kg": 5, "charges_kg": [75, 75, 80, 80]},
    {"nom": "Développé incliné haltères", "methode": "classique", "series": 3, "reps_min": 8, "reps_max": 12, "palier_kg": 2, "charges_kg": [24, 24, 24]}
  ]},
  {"nom": "Pull", "exercices": [
    {"nom": "Tirage vertical", "methode": "rest-pause", "series": 4, "cible_reps": 15, "monter_a": 12, "pause_s": 20, "palier_kg": 5}
  ]}
]}}
```
Bonne séance !"""

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
        await page.click("button[data-view=training]"); await page.wait_for_timeout(300)

        # ---------- Plateaux ----------
        check("Plateau repéré (Rowing machine : 4 séances sans progrès), pas sur un exercice qui progresse",
              await ev("[Boolean(plateauInfo('Rowing machine')), Boolean(plateauInfo('Tirage vertical')), Boolean(plateauInfo('Chest press'))]") == [True, False, False])

        await ev("resetWorkoutForm(); workoutForm().elements.session.value = 'pull'; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        rm = await page.inner_text(".exercise-block:first-child .exercise-meta")
        check("Carte « Rowing machine » : plateau signalé avec pistes et « Remplacer »", "Pas de progrès depuis" in rm and "remplacer l'exercice" in rm and await page.locator(".exercise-block:first-child .advice-plateau [data-action=replace-exercise]").count() == 1, rm[-200:])
        auto = await ev("(() => { const s = initialSets(findExerciseDef('Chest press'), 'Chest press', 4); return [s.autoIncrement, s.map(x => x.load)]; })()")
        check("Progression automatique : Chest press à 12 reps → +2,5 kg sur chaque série", auto == [2.5, [72.5, 72.5, 77.5, 77.5]], auto)

        # ---------- Générateur ----------
        await page.click("#gen-open"); await page.wait_for_timeout(400)
        plan = await ev("JSON.parse(JSON.stringify({kind: genPlan.kind, notes: genPlan.notes, est: genPlan.estimate, ex: genPlan.exercises.map(e => ({name: e.name, group: e.group, n: e.sets.length, loads: e.sets.map(s => s.load), why: e.why}))}))")
        names = [e["name"] for e in plan["ex"]]
        check("Push hier → Pull proposé automatiquement", plan["kind"] == "pull" and "Push hier → Pull" in plan["notes"], plan["notes"])
        check("50 min : la séance tient dans le temps", 30 <= plan["est"] <= 53, plan["est"])
        check("Que du haut du corps adapté au Pull (dos, biceps, arrière d'épaule), pas de jambes", plan["ex"] and all(e["group"] in ("dos", "biceps", "arriere") for e in plan["ex"]), [(e["name"], e["group"]) for e in plan["ex"]])
        check("Exercice en plateau (Rowing machine) jamais proposé tant qu'il y a une variante", "Rowing machine" not in names, names)
        tv = next((e for e in plan["ex"] if e["name"] == "Tirage vertical"), None)
        check("Charges reprises de ta dernière fois", tv is None or tv["loads"][0] == 70, tv)
        seeds = set()
        for _ in range(6):
            await page.click("#gen-again"); await page.wait_for_timeout(100)
            seeds.add(tuple(await ev("genPlan.exercises.map(e => e.name)")))
        check("« Autre proposition » change la séance", len(seeds) >= 2, len(seeds))
        await page.select_option("#gen-form [name=type]", "push"); await page.wait_for_timeout(150)
        pplan = await ev("JSON.parse(JSON.stringify(genPlan.exercises.map(e => ({name: e.name, group: e.group, n: e.sets.length, inc: e.autoIncrement}))))")
        groups_yesterday = {"pecs", "epaules", "triceps"}
        check("Push choisi alors que fait hier : 2 séries max par muscle, un exercice par muscle", all(e["n"] <= 2 for e in pplan if e["group"] in groups_yesterday) and len({e["group"] for e in pplan}) == len(pplan), pplan)
        await page.select_option("#gen-form [name=type]", "auto")
        await page.select_option("#gen-form [name=minutes]", "75"); await page.select_option("#gen-form [name=cardio]", "both"); await page.wait_for_timeout(150)
        big = await ev("JSON.parse(JSON.stringify({est: genPlan.estimate, n: genPlan.exercises.length, cardio: genPlan.cardio}))")
        check("1 h 15 avec cardio au début et à la fin : plus d'exercices, cardio prévu", big["n"] >= len(plan["ex"]) and big["cardio"]["warmup"]["minutes"] == 5 and big["cardio"]["end"]["minutes"] == 15 and big["est"] <= 78, big)
        check("Affichage : cardio et explications visibles", "Échauffement : Vélo 5 min" in await page.inner_text("#gen-result") and "Cardio : Elliptique 15 min" in await page.inner_text("#gen-result"))
        before = await ev("genPlan.exercises[0].name")
        await page.click("[data-gen-replace='0']")
        check("« Remplacer » dans la proposition : autre exercice des mêmes muscles", await ev("genPlan.exercises[0].name") != before and await ev(f"exerciseGroup(genPlan.exercises[0].name) === exerciseGroup({json.dumps(before)})"))
        await page.select_option("#gen-form [name=minutes]", "30"); await page.select_option("#gen-form [name=cardio]", "none"); await page.wait_for_timeout(150)
        gen_names = await ev("genPlan.exercises.map(e => e.name)")
        await page.click("#gen-start"); await page.wait_for_timeout(500)
        check("Lancer : formulaire rempli et mode séance ouvert", await ev("sessionModeOpen()") and await ev("readEditor().map(e => e.name)") == gen_names, gen_names)
        await page.click("#sm-close")
        await ev("document.querySelectorAll('[data-field=reps]').forEach(i => i.value = '10'); saveWorkoutDraft()")
        await page.wait_for_timeout(400)
        await page.reload(); await page.wait_for_timeout(1200)
        await page.click("button[data-view=training]")
        await page.click("#workout-submit"); await page.wait_for_timeout(500)
        check("Enregistrée sous « Séance générée · Pull » (même après fermeture de l'app)", await ev("state.workouts[0].sessionType") == "Séance générée · Pull", await ev("state.workouts[0].sessionType"))
        await ev("""(async () => { for (const w of state.workouts.filter(w => w.date >= addDays(today(), -4))) await deleteRecord(w.id); await reloadWorkouts(); })()""")
        await page.wait_for_timeout(300)
        check("Rien ces 3 derniers jours → haut du corps complet", await ev("autoSessionType().type") == "upper")

        # ---------- Remplacer dans le formulaire ----------
        await ev("resetWorkoutForm(); workoutForm().elements.session.value = 'pull'; workoutForm().elements.session.dispatchEvent(new Event('change'))")
        await page.wait_for_timeout(200)
        await page.click(".exercise-block:first-child [data-action=replace-exercise]"); await page.wait_for_timeout(200)
        opts = await ev("[...document.querySelectorAll('#replace-list [data-replace]')].map(b => b.dataset.replace)")
        check("Remplacer : équivalents du même groupe, sans ceux déjà dans la séance", opts and "Tirage vertical" not in opts and "Tractions" in opts and all(o not in ("Chest press", "Butterfly") for o in opts), opts)
        await page.click("#replace-list [data-replace='Tractions']"); await page.wait_for_timeout(200)
        blk = await ev("(() => { const b = document.querySelector('.exercise-block'); return {name: b.querySelector('.exercise-name').value, bw: b.classList.contains('is-bw'), n: b.querySelectorAll('.set-row').length, ro: b.querySelector('.exercise-name').readOnly}; })()")
        check("Remplacé par Tractions : même nombre de séries, poids du corps reconnu", blk == {"name": "Tractions", "bw": True, "n": 4, "ro": False}, blk)

        # ---------- Renommer / fusionner ----------
        await page.click("button[data-view=progress]"); await page.wait_for_timeout(200)
        await page.select_option("#progress-exercise", "Curl biceps machine"); await page.wait_for_timeout(100)
        await page.click("#rename-open"); await page.wait_for_timeout(200)
        await page.fill("#rename-form [name=name]", "Curl pupitre machine"); await page.dispatch_event("#rename-form [name=name]", "input")
        await page.click("#rename-form button[type=submit]"); await page.wait_for_timeout(500)
        counts = await ev("[state.workouts.filter(w => w.exercises.some(e => e.name === 'Curl pupitre machine')).length, state.workouts.filter(w => w.exercises.some(e => e.name === 'Curl biceps machine')).length, Boolean(findExerciseDef('Curl pupitre machine'))]")
        check("Renommer : toutes les séances et le programme suivent", counts[0] >= 2 and counts[1] == 0 and counts[2], counts)
        await page.select_option("#progress-exercise", "Tirage vertical"); await page.wait_for_timeout(100)
        await page.click("#rename-open"); await page.fill("#rename-form [name=name]", "Rowing machine"); await page.dispatch_event("#rename-form [name=name]", "input")
        check("Nom existant : fusion annoncée", "seront fusionnés" in await page.inner_text("#rename-hint"))
        n_before = await ev("exerciseHistory('Rowing machine').length")
        await page.click("#rename-form button[type=submit]"); await page.wait_for_timeout(500)
        check("Fusion : historiques réunis", await ev("exerciseHistory('Rowing machine').length") > n_before and await ev("exerciseHistory('Tirage vertical').length") == 0)

        # ---------- Programme du coach ----------
        await page.click("button[data-view=settings]"); await page.wait_for_timeout(200)
        await page.click("#coach-program-open"); await page.wait_for_timeout(200)
        await page.fill("#coach-program-text", "pas de programme ici"); await page.dispatch_event("#coach-program-text", "input")
        check("Texte sans programme : explication, bouton bloqué", "Aucun programme trouvé" in await page.inner_text("#coach-program-preview") and await page.is_disabled("#coach-program-apply"))
        await page.fill("#coach-program-text", COACH_TEXT); await page.dispatch_event("#coach-program-text", "input")
        prev = await page.inner_text("#coach-program-preview")
        check("Aperçu : séances, exercices, nouveaux et retirés", "Développé incliné haltères" in prev and "Nouveaux : Développé incliné haltères" in prev and "Retirés" in prev, prev[:300])
        old_prog = await ev("JSON.stringify(state.program)")
        await page.click("#coach-program-apply"); await page.wait_for_timeout(400)
        prog = await ev("state.program.sessions.map(s => [s.name, s.exercises.map(e => [e.name, e.mode, e.sets, e.increment, e.loads])])")
        check("Programme installé (méthode, séries, palier, charges)", prog[0] == ["Push", [["Chest press", "restpause", 4, 5, [75, 75, 80, 80]], ["Développé incliné haltères", "classic", 3, 2, [24, 24, 24]]]] and prog[1][0] == "Pull", prog)
        check("Enregistré (et donc synchronisé)", await ev("getSetting('program').then(p => p.sessions[0].exercises.length)") == 2)
        await page.click(".toast-action"); await page.wait_for_timeout(400)
        check("Annuler remet l'ancien programme", await ev("JSON.stringify(state.program)") == old_prog)

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
