"""Tests de la version 3.7 (course) : plan de reprise, minuteur guidé, journal, GPX, partage Android,
import Strava (Strava simulé), export pour le coach. Données fictives.

Usage (depuis le dossier de l'application) :
    python test_run.py
"""
import asyncio, json, os, socket, subprocess, sys, time, urllib.parse
from datetime import date, timedelta
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

def gpx(start="2026-11-10T07:30:00Z", n=61, step_s=10, dlat=0.0003, name="Sortie du matin"):
    from datetime import datetime
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
    pts = "".join(f'<trkpt lat="{48.85 + i * dlat:.6f}" lon="2.35"><ele>{35 + (i % 5)}</ele><time>{(t0 + timedelta(seconds=i * step_s)).strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>' for i in range(n))
    return f'<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>{name}</name><type>running</type><trkseg>{pts}</trkseg></trk></gpx>'

class FakeStrava:
    def __init__(self):
        self.calls = []
        self.activities = []
        self.fail = None          # None, "401", "network"
    async def handle(self, route):
        req = route.request
        url = urllib.parse.urlparse(req.url)
        self.calls.append((req.method, url.path))
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST"}
        if req.method == "OPTIONS":
            return await route.fulfill(status=204, headers=cors)
        if self.fail == "network" and url.path.startswith("/api/"):
            return await route.abort()
        if url.path.endswith("/authorize"):
            q = urllib.parse.parse_qs(url.query)
            self.authorize_query = q
            back = BASE + "?" + urllib.parse.urlencode({"state": q["state"][0], "code": "code-ok", "scope": "read,activity:read_all"})
            return await route.fulfill(status=302, headers={"location": back})
        if url.path == "/oauth/token":
            form = urllib.parse.parse_qs(req.post_data or "")
            self.last_token_form = form
            if form.get("client_secret", [""])[0] != "f" * 40:
                return await route.fulfill(status=401, content_type="application/json", headers=cors, body=json.dumps({"message": "Bad Request"}))
            gt = form.get("grant_type", [""])[0]
            if gt == "authorization_code" and form.get("code", [""])[0] != "code-ok":
                return await route.fulfill(status=400, content_type="application/json", headers=cors, body=json.dumps({"message": "Bad Request"}))
            tok = "tok-refreshed" if gt == "refresh_token" else "tok-1"
            body = {"token_type": "Bearer", "access_token": tok, "refresh_token": "rt-1", "expires_at": int(time.time()) + 21600}
            if gt == "authorization_code":
                body["athlete"] = {"firstname": "Alex", "lastname": "Test"}
            return await route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(body))
        if url.path == "/oauth/deauthorize":
            return await route.fulfill(status=200, content_type="application/json", headers=cors, body="{}")
        if url.path == "/api/v3/athlete/activities":
            if self.fail == "401" or not req.headers.get("authorization", "").startswith("Bearer tok-"):
                return await route.fulfill(status=401, content_type="application/json", headers=cors, body=json.dumps({"message": "Authorization Error"}))
            q = urllib.parse.parse_qs(url.query)
            self.last_after = int(q["after"][0])
            page = int(q.get("page", ["1"])[0])
            return await route.fulfill(status=200, content_type="application/json", headers=cors, body=json.dumps(self.activities if page == 1 else []))
        return await route.fulfill(status=404, headers=cors, body="")

def activity(aid, day, sport="Run", km=5.0, moving=1800, hour="18:30"):
    return {"id": aid, "name": f"Sortie {aid}", "type": sport, "sport_type": sport, "distance": km * 1000, "moving_time": moving, "elapsed_time": moving + 60,
            "total_elevation_gain": 42.4, "average_heartrate": 151.6, "start_date": f"{day}T{hour}:00Z", "start_date_local": f"{day}T{hour}:00Z"}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, timezone_id="Europe/Paris")
        fake = FakeStrava()
        await ctx.route("https://www.strava.com/**", fake.handle)
        await ctx.add_init_script("window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; };")
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text and "strava" not in m.text.lower() else None)
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        ev = page.evaluate
        await page.goto(BASE); await page.wait_for_timeout(1000)

        # ================= Plan de reprise =================
        info = await ev("[runStepText(1), phasesTotal(runPhases(RUN_PLAN[0])), runStepText(11), RUN_PLAN.length, runPhases(RUN_PLAN[0]).map(p => p.kind[0]).join('')]")
        check("Étape 1 : 8 × (1 min course + 2 min marche), 32 min avec échauffement et retour au calme",
              info[0] == "8 × (1 min de course + 2 min de marche)" and info[1] == 1920 and info[4] == "w" + "rw" * 7 + "rw", info)
        check("Fin du plan : course continue (étape 11 = 20 min), 13 étapes", info[2] == "20 min de course continue" and info[3] == 13, info)
        plan = await ev("""(() => {
          const d = (n) => addDays(today(), -n);
          const R = (date, planStep, extra) => ({ id: Math.random().toString(36).slice(2), type: 'run', date, planStep, completed: true, durationS: 1900, source: 'app', createdAt: 1, ...extra });
          const st = (runs) => { const s = runPlanState(runs); return [s.step, s.ok, s.verdict, s.suggested, s.pauseBack]; };
          const a = [R(d(9), 1, { painDuring: 1, painAfter: 0 })];
          const b = [...a, R(d(7), 1, { painDuring: 2, painNext: 1 })];
          const c = [...b, R(d(5), 2, { painDuring: 4 })];
          const e = [...c, R(d(3), 2, { painDuring: 1, painNext: 7 })];
          const f = [R(d(3), 1, { painDuring: 0, completed: false })];
          const g = [R(d(3), 1, {})];
          const h = [R(d(40), 3, { painDuring: 0 }), R(d(38), 3, { painDuring: 0 })];
          return { vide: st([]), une: st(a), deux: st(b), douleur4: st(c), douleur7: st(e), interrompue: st(f), sansNote: st(g), pause: st(h) };
        })()""")
        check("Aucune course : étape 1", plan["vide"][:2] == [1, 0] and plan["vide"][3] == 1, plan["vide"])
        check("1 séance sans douleur : validée, encore 1 avant de monter", plan["une"][:3] == [1, 1, "ok"], plan["une"])
        check("2 séances validées (0 à 2/10) : étape suivante", plan["deux"][:3] == [2, 0, "up"], plan["deux"])
        check("Douleur 4/10 : on répète l'étape", plan["douleur4"][:3] == [2, 0, "repeat"], plan["douleur4"])
        check("Douleur 7/10 le lendemain : on recule d'une étape", plan["douleur7"][:3] == [1, 0, "back"], plan["douleur7"])
        check("Séance interrompue : on répète", plan["interrompue"][:3] == [1, 0, "repeat"], plan["interrompue"])
        check("Douleur non notée : ne compte pas pour avancer", plan["sansNote"][:3] == [1, 0, "unknown"], plan["sansNote"])
        check("Plus de 14 jours sans courir : on conseille une étape plus bas", plan["pause"][0] == 4 and plan["pause"][3] == 3 and plan["pause"][4], plan["pause"])

        # ================= Panneau Course =================
        await page.click("button[data-view=training]"); await page.wait_for_timeout(300)
        status = await page.inner_text("#run-status")
        opts = await page.locator("#run-launch [name=step] option").count()
        check("Panneau Course : étape proposée et liste des 13 étapes + personnalisée", "Étape 1 sur 13" in status and opts == 14, (status, opts))

        # ================= Minuteur guidé =================
        await page.click("#run-launch button[type=submit]"); await page.wait_for_timeout(400)
        t1 = [await page.is_visible("#run-timer"), await page.inner_text("#rt-phase"), await page.inner_text("#rt-time"), await page.inner_text("#rt-next")]
        check("Lancer : écran de course plein écran, marche d'échauffement 5:00, la suite annoncée", t1[0] and t1[1] == "MARCHE" and t1[2] in ("5:00", "4:59") and "course 1:00" in t1[3], t1)
        sounds = await ev("rt.nodes.length")
        check("Bips programmés d'avance pour toute la séance (changements + décomptes + fin)", sounds >= 60, sounds)
        await ev("rt.startWall -= 301000; rtTick()")
        t2 = [await page.inner_text("#rt-phase"), await page.inner_text("#rt-label"), await ev("window.__vib.slice(-1)[0]"), await ev("document.getElementById('run-timer').classList.contains('rt-is-run')")]
        check("5 min plus tard : COURS (course 1/8), vibration double", t2[0] == "COURS" and t2[1] == "Course 1/8" and t2[2] == [350, 150, 350] and t2[3], t2)
        await page.click("#rt-pause"); await page.wait_for_timeout(600)
        e1 = await ev("rtElapsed()")
        await page.wait_for_timeout(700)
        e2 = await ev("rtElapsed()")
        check("Pause : chrono arrêté, bips annulés", await page.inner_text("#rt-phase") == "PAUSE" and e1 == e2 and await ev("rt.nodes.length") == 0, (e1, e2))
        await page.click("#rt-pause"); await page.wait_for_timeout(300)
        check("Reprendre : bips reprogrammés", await page.inner_text("#rt-phase") == "COURS" and await ev("rt.nodes.length") > 30)
        await page.click("#rt-skip"); await page.wait_for_timeout(300)
        check("Passer : phase suivante (marche)", await page.inner_text("#rt-phase") == "MARCHE" and await page.inner_text("#rt-label") == "Marche" and await ev("window.__vib.slice(-1)[0]") == [800])
        saved = await ev("localGet(RT_KEY)")
        check("Séance gardée en cas de fermeture de l'app", saved and saved["planStep"] == 1 and len(saved["phases"]) == 17, saved and saved.get("label"))
        # L'app se ferme pendant la course, puis on revient.
        await page.reload(); await page.wait_for_timeout(1000)
        await page.click("button[data-view=training]"); await page.wait_for_timeout(300)
        check("Retour dans l'app : « Course en cours » proposée", await page.is_visible("#run-resume") and "Étape 1" in await page.inner_text("#run-resume"))
        await page.click("#run-resume-go"); await page.wait_for_timeout(300)
        check("Reprendre : chrono reparti où il en était", await page.is_visible("#run-timer") and await ev("rtElapsed()") > 359)
        # Fin de séance (on avance le temps jusqu'au bout).
        await ev("rt.startWall -= 2000000; rtTick()"); await page.wait_for_timeout(300)
        form_state = await ev("""(() => { const f = document.getElementById('run-form'); return [document.getElementById('run-dialog').open, document.getElementById('run-form-title').textContent,
          f.elements.duration.value, f.elements.planStep.value, f.elements.completed.checked]; })()""")
        check("Séance finie : bilan ouvert (32:00, étape 1, terminée)", form_state == [True, "Bravo ! Bilan de la séance", "32:00", "1", True], form_state)
        await page.click("#run-form button[type=submit]"); await page.wait_for_timeout(300)
        check("Bilan sans douleur notée : refusé (c'est elle qui décide de la suite)", "douleur du genou" in await page.inner_text("#toast") and await ev("state.runs.length") == 0)
        await page.fill("#run-form [name=painDuring]", "1"); await page.fill("#run-form [name=painAfter]", "0"); await page.fill("#run-form [name=effort]", "6")
        await page.click("#run-form button[type=submit]"); await page.wait_for_timeout(400)
        r = await ev("state.runs[0]")
        check("Course enregistrée : source app, 8 min courues, heure de départ, douleur", r and r["source"] == "app" and r["runS"] == 480 and r["durationS"] == 1920 and r["completed"] and r["painDuring"] == 1 and len(r.get("startTime", "")) == 5 and r["effort"] == 6, r)
        check("Après la séance : repos conseillé et 1 séance validée sur 2", "Repos" in await page.inner_text("#run-status") and "encore 1" in await page.inner_text("#run-status"), await page.inner_text("#run-status"))
        check("Journal de course : la séance apparaît", "Étape 1 du plan" in await page.inner_text("#run-list") and "terminée" in await page.inner_text("#run-list"))
        check("Arrêt complet du minuteur (plus rien en mémoire)", await ev("rt === null && localGet(RT_KEY) === null"))

        # « J'ai mal : j'arrête »
        await page.click("#run-launch button[type=submit]"); await page.wait_for_timeout(300)
        await ev("rt.startWall -= 400000; rtTick()")
        await page.click("#rt-pain"); await page.wait_for_timeout(300)
        pain_form = await ev("[document.getElementById('run-form-title').textContent, document.querySelector('#run-form [name=completed]').checked, document.activeElement.name]")
        check("« J'ai mal » : bilan d'arrêt, séance non terminée, curseur sur la douleur", pain_form == ["Bilan : arrêt pour douleur", False, "painDuring"], pain_form)
        await page.click("#run-form-cancel"); await page.wait_for_timeout(300)
        check("Annuler le bilan (confirmé) : rien d'enregistré", not await ev("document.getElementById('run-dialog').open") and await ev("state.runs.length") == 1)

        # ================= Genou le lendemain =================
        await ev("""(async () => { const r = { ...state.runs[0], date: addDays(today(), -1) }; await saveRecord(r); await reloadRuns(); renderRunPanel(); })()""")
        check("Le lendemain : « Ton genou ce matin ? » demandé", await page.is_visible("#run-next-day"))
        await page.click("#run-next-day [data-run-next='1']"); await page.wait_for_timeout(400)
        check("Réponse 1/10 : notée, question retirée", await ev("state.runs[0].painNext") == 1 and not await page.is_visible("#run-next-day") and "genou OK" in await page.inner_text("#toast"))

        # ================= Saisie à la main, modification, suppression =================
        await page.click("#run-add"); await page.wait_for_timeout(200)
        await page.fill("#run-form [name=duration]", "45:00"); await page.fill("#run-form [name=distanceKm]", "6,2")
        await page.click("#run-form button[type=submit]"); await page.wait_for_timeout(400)
        manual = await ev("state.runs.find(r => r.source === 'manuel')")
        check("Course notée à la main : allure calculée (7:15/km)", manual and manual["distanceKm"] == 6.2 and "7:15/km" in await page.inner_text("#run-list"), manual)
        await page.click(f"[data-run-edit='{manual['id']}']"); await page.wait_for_timeout(200)
        check("Modifier : formulaire prérempli", await page.input_value("#run-form [name=duration]") == "45:00" and await page.input_value("#run-form [name=distanceKm]") == "6,2")
        await page.fill("#run-form [name=distanceKm]", "6,5"); await page.click("#run-form button[type=submit]"); await page.wait_for_timeout(400)
        check("Modification enregistrée (même course)", await ev(f"state.runs.filter(r => r.source === 'manuel').map(r => [r.id, r.distanceKm])") == [[manual["id"], 6.5]])
        await page.click(f"[data-run-delete='{manual['id']}']"); await page.wait_for_timeout(400)
        check("Supprimer", await ev("state.runs.every(r => r.source !== 'manuel')"))
        check("Durées acceptées : 32:30, 45 (min), 1:05:00", await ev("[parseRunDuration('32:30'), parseRunDuration('45'), parseRunDuration('1:05:00'), Number.isNaN(parseRunDuration('abc'))]") == [1950, 2700, 3900, True])
        check("Entrée de course vide refusée à l'import", await ev("normalizeRecord({ type: 'run', date: today() })") is None)

        # ================= Import GPX =================
        g = gpx()
        res = await ev("(t) => importGpxText(t)", g)
        rec = await ev("state.runs.find(r => r.source === 'gpx')")
        check("GPX : distance, temps en mouvement, date et heure locales", res == "new" and rec and abs(rec["distanceKm"] - 2.0) < 0.02 and rec["durationS"] == 600 and rec["date"] == "2026-11-10" and rec["startTime"] == "08:30" and rec["name"] == "Sortie du matin", rec)
        res2 = await ev("(t) => importGpxText(t)", g)
        check("Même GPX réimporté : reconnu, pas de doublon", res2 == "known" and "Déjà dans ton journal" in await page.inner_text("#toast") and await ev("state.runs.filter(r => r.source === 'gpx').length") == 1)
        # Séance chronométrée sans distance + GPX du même jour → on complète la séance.
        await ev("saveRun({ id: 'app-x', source: 'app', date: '2026-11-08', planStep: 2, completed: true, durationS: 2040, painDuring: 1, startTime: '18:00' })")
        res3 = await ev("(t) => importGpxText(t)", gpx(start="2026-11-08T17:02:00Z", n=91))
        merged = await ev("state.runs.find(r => r.id === 'app-x')")
        check("GPX du même jour qu'une séance du plan : distance ajoutée à la séance (pas de doublon)", res3 == "merged" and merged["distanceKm"] > 2.9 and merged["importedFrom"] == "gpx" and merged["planStep"] == 2, merged)
        check("Fichier sans tracé : message clair", "Aucun tracé" in await ev("(async () => { try { parseGpx('<gpx></gpx>'); return ''; } catch (e) { return e.message; } })()"))
        # Partage Android : le service worker range le fichier, l'app l'importe au démarrage.
        await ev("(t) => caches.open('pp-shared').then(c => c.put('./shared-gpx', new Response(t)))", gpx(start="2026-11-05T06:00:00Z", n=31))
        await page.goto(BASE + "?view=training&shared-gpx=1"); await page.wait_for_timeout(1500)
        check("Fichier GPX partagé depuis une autre app : importé à l'ouverture", await ev("state.runs.some(r => r.date === '2026-11-05' && r.source === 'gpx')") and "shared-gpx" not in page.url, page.url)
        manifest = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))
        check("Manifeste : l'app apparaît dans « Partager » pour les fichiers GPX", manifest["share_target"]["action"] == "./share-gpx" and manifest["share_target"]["params"]["files"][0]["name"] == "gpx")

        # ================= Strava (simulé) =================
        d1 = (date.today() - timedelta(days=3)).isoformat()
        d2 = (date.today() - timedelta(days=2)).isoformat()
        fake.activities = [activity(101, d1), activity(102, d1, sport="Ride", km=30), activity(103, d2, sport="TrailRun", km=7.5, moving=3000, hour="07:10")]
        await ev(f"saveRun({{ id: 'app-y', source: 'app', date: '{d2}', planStep: 2, completed: true, durationS: 2040, painDuring: 0, startTime: '07:12' }})")
        await page.click("button[data-view=settings]"); await page.wait_for_timeout(300)
        check("Réglages Strava : étapes et domaine à indiquer", await page.is_visible("#strava-setup") and await page.inner_text("#strava-domain") == "localhost")
        await page.fill("#strava-form [name=clientId]", "abc")
        await page.click("#strava-form button[type=submit]"); await page.wait_for_timeout(300)
        check("ID client invalide : refusé", "ID client" in await page.inner_text("#toast"))
        await page.fill("#strava-form [name=clientId]", "12345"); await page.fill("#strava-form [name=clientSecret]", "f" * 40)
        await page.click("#strava-form button[type=submit]")
        await page.wait_for_timeout(3000)
        aq = getattr(fake, "authorize_query", {})
        check("Connexion : page Strava avec accès aux activités, retour vers l'app", aq.get("client_id") == ["12345"] and "activity:read_all" in aq.get("scope", [""])[0] and aq.get("redirect_uri") == [BASE], aq)
        tf = getattr(fake, "last_token_form", {})
        check("Code échangé contre une clé (secret envoyé à Strava uniquement)", tf.get("grant_type") == ["authorization_code"] and tf.get("code") == ["code-ok"])
        runs = await ev("state.runs.filter(r => r.source === 'strava' || r.importedFrom === 'strava').map(r => [r.id, r.date, r.distanceKm, r.avgHr, r.stravaId])")
        check("Import : courses seulement (pas le vélo), données de Strava", sorted(x[4] for x in runs) == ["101", "103"] and any(x[0] == "strava-101" and x[2] == 5 and x[3] == 152 for x in runs), runs)
        check("Sortie Strava du même jour qu'une séance du plan : fusionnée avec elle", any(x[0] == "app-y" and x[2] == 7.5 for x in runs), runs)
        check("Après connexion : adresse nettoyée, Réglages « Connecté (Alex Test) »", "code=" not in page.url and "Connecté (Alex Test)" in await page.inner_text("#strava-status"), page.url)
        stored = await ev("getSetting('strava')")
        check("Clés gardées sur l'appareil, jamais synchronisées", stored["refreshToken"] == "rt-1" and "strava" not in await ev("SYNCED_SETTINGS"))
        await page.click("#strava-import"); await page.wait_for_timeout(1200)
        check("Import suivant : rien de nouveau (pas de doublon), recouvrement de 2 jours", "rien de nouveau" in await page.inner_text("#toast") and await ev("state.runs.filter(r => r.source === 'strava').length") == 1, await page.inner_text("#toast"))
        await ev("(async () => { strava.expiresAt = 1; await saveStrava(); })()")
        await page.click("#strava-import"); await page.wait_for_timeout(1200)
        check("Clé expirée : renouvelée toute seule", getattr(fake, "last_token_form", {}).get("grant_type") == ["refresh_token"] and await ev("strava.accessToken") == "tok-refreshed")
        calls_before = len(fake.calls)
        await ev("maybeStravaImport()"); await page.wait_for_timeout(500)
        check("Import automatique : pas plus d'une fois toutes les 30 min", len(fake.calls) == calls_before)
        fake.fail = "network"
        await page.click("#strava-import"); await page.wait_for_timeout(1200)
        check("Strava injoignable : message clair avec l'alternative GPX", "GPX" in await page.inner_text("#toast"), await page.inner_text("#toast"))
        fake.fail = "401"
        await page.click("#strava-import"); await page.wait_for_timeout(1200)
        check("Accès retiré sur Strava : reconnexion demandée", "reconnecter" in await page.inner_text("#toast") and await ev("strava.needsLogin") and await page.is_visible("#strava-setup"))
        fake.fail = None
        await page.click("#strava-disconnect"); await page.wait_for_timeout(600)
        check("Déconnecter : clés effacées, courses gardées", not await ev("stravaConnected()") and await ev("state.runs.some(r => r.source === 'strava')") and not await page.is_visible("#strava-connected"))

        # ================= Coach =================
        exp = await ev(f"buildPeriodExport('{d2}', '{d2}')")
        c = next(x for x in exp["jours"][0]["courses"] if x.get("etape_plan"))
        check("Export coach : course avec étape, douleur, distance, allure, FC", c["etape_plan"] == 2 and c["douleur_genou"]["pendant"] == 0 and c["distance_km"] == 7.5 and c["allure_min_km"] == "4:32" and c["fc_moyenne"] == 152 and c["source"] == "app", c)
        recap = await ev(f"buildDayRecap('{d2}')")
        check("Récap du jour : ligne « Course »", "Course : étape 2 du plan" in recap and "7,5 km" in recap and "genou pendant 0/10" in recap, recap)
        sheet = await ev("buildCoachSheet('')")
        check("Fiche « État actuel » : où en est le plan de reprise", "- Course (app) : plan de reprise à l'étape" in sheet, [l for l in sheet.split("\n") if "Course" in l])
        await page.click("button[data-view=dashboard]"); await page.wait_for_timeout(300)
        check("Accueil : courses dans les dernières activités", "Course ·" in await page.inner_text("#recent-activity"))

        # ================= Sécurité =================
        await ev("""saveRun({ id: 'evil', source: 'manuel', date: today(), durationS: 600, name: '<img src=x onerror="window.pwned=1">', notes: '<b>x</b>' })""")
        await page.click("button[data-view=training]"); await page.wait_for_timeout(400)
        check("Nom ou note piégés : affichés comme du texte", not await ev("window.pwned === 1") and "<b>x</b>" in await page.inner_text("#run-list"))
        csp = await ev("document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
        check("Sécurité : seul www.strava.com est ajouté aux services autorisés", "https://www.strava.com" in csp and "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://world.openfoodfacts.org https://www.strava.com;" in csp)

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
