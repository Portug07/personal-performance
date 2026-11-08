"""Tests de la synchronisation entre appareils (sync.js), avec un faux Firebase.

Usage (depuis le dossier de l'application) :
    python test_sync.py

Deux navigateurs indépendants jouent le téléphone et le PC. Les API Google (connexion, jeton, Firestore)
sont remplacées par une simulation en mémoire : aucun vrai compte n'est nécessaire.
"""
import asyncio, json, sys, os, socket, subprocess, time, urllib.parse
from datetime import datetime, timedelta, timezone
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

API_KEY = "AIzaSyTEST_KEY_1234567890abcdefghijk"
PROJECT = "pp-test"
CONFIG = f"""const firebaseConfig = {{
  apiKey: "{API_KEY}",
  authDomain: "{PROJECT}.firebaseapp.com",
  projectId: "{PROJECT}",
  storageBucket: "{PROJECT}.appspot.com",
  messagingSenderId: "123",
  appId: "1:123:web:abc"
}};"""
EMAIL, PASSWORD = "tristan@example.com", "motdepasse-app"

class FakeFirebase:
    """Simule Firebase Authentication (REST), le renouvellement de jeton et Firestore (commit, runQuery)."""
    def __init__(self):
        self.users = {EMAIL: {"password": PASSWORD, "uid": "uidTristan"}}
        self.docs = {}            # nom complet -> {"fields": {...}}
        self.clock = datetime(2026, 11, 5, 18, 0, 0, tzinfo=timezone.utc)
        self.revoked = set()
        self.calls = {"commit": 0, "query": 0, "writes": 0}
    def now(self):
        self.clock += timedelta(microseconds=137)
        return self.clock.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    def uid_from(self, headers):
        auth = headers.get("authorization", "")
        return auth[len("Bearer id-"):] if auth.startswith("Bearer id-") else None

    async def handle(self, route):
        req = route.request
        url = urllib.parse.urlparse(req.url)
        qs = urllib.parse.parse_qs(url.query)
        def reply(status, body):
            return route.fulfill(status=status, content_type="application/json", body=json.dumps(body),
                                 headers={"access-control-allow-origin": "*"})
        if req.method == "OPTIONS":
            return await route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST"})
        if url.netloc == "identitytoolkit.googleapis.com":
            if qs.get("key", [""])[0] != API_KEY:
                return await reply(400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT"}})
            body = json.loads(req.post_data or "{}")
            user = self.users.get(body.get("email"))
            if not user or user["password"] != body.get("password"):
                return await reply(400, {"error": {"code": 400, "message": "INVALID_LOGIN_CREDENTIALS"}})
            self.revoked.discard(user["uid"])
            return await reply(200, {"idToken": f"id-{user['uid']}", "refreshToken": f"rt-{user['uid']}", "localId": user["uid"], "expiresIn": "3600", "email": body["email"]})
        if url.netloc == "securetoken.googleapis.com":
            form = urllib.parse.parse_qs(req.post_data or "")
            rt = form.get("refresh_token", [""])[0]
            uid = rt[3:] if rt.startswith("rt-") else None
            if not uid or uid in self.revoked:
                return await reply(400, {"error": {"code": 400, "message": "TOKEN_EXPIRED"}})
            return await reply(200, {"id_token": f"id-{uid}", "refresh_token": rt, "expires_in": "3600", "user_id": uid})
        if url.netloc == "firestore.googleapis.com":
            uid = self.uid_from(req.headers)
            if not uid or uid in self.revoked:
                return await reply(401, {"error": {"code": 401, "message": "Request had invalid authentication credentials.", "status": "UNAUTHENTICATED"}})
            path = urllib.parse.unquote(url.path)
            body = json.loads(req.post_data or "{}")
            root = f"/v1/projects/{PROJECT}/databases/(default)/documents"
            if path == root + ":commit":
                t = self.now()
                for w in body.get("writes", []):
                    name = w["update"]["name"]
                    if f"/users/{uid}/" not in name:
                        return await reply(403, {"error": {"code": 403, "message": "Missing or insufficient permissions.", "status": "PERMISSION_DENIED"}})
                    fields = dict(w["update"]["fields"])
                    for tr in w.get("updateTransforms", []):
                        if tr.get("setToServerValue") == "REQUEST_TIME":
                            fields[tr["fieldPath"]] = {"timestampValue": t}
                    self.docs[name] = {"fields": fields}
                    self.calls["writes"] += 1
                self.calls["commit"] += 1
                return await reply(200, {"writeResults": [{"updateTime": t} for _ in body.get("writes", [])], "commitTime": t})
            if path == f"{root}/users/{uid}:runQuery":
                self.calls["query"] += 1
                q = body["structuredQuery"]
                prefix = f"projects/{PROJECT}/databases/(default)/documents/users/{uid}/records/"
                rows = [(n, d) for n, d in self.docs.items() if n.startswith(prefix)]
                rows.sort(key=lambda x: (x[1]["fields"]["serverTime"]["timestampValue"], x[0]))
                start = q.get("startAt")
                if start:
                    def ts(v):  # horodatage RFC 3339 → nombre comparable (les fractions de seconde varient)
                        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
                    vals = start["values"]
                    def pos(r):
                        k = (ts(r[1]["fields"]["serverTime"]["timestampValue"]),)
                        return k + ((r[0],) if len(vals) > 1 else ())
                    key = (ts(vals[0]["timestampValue"]),) + ((vals[1]["referenceValue"],) if len(vals) > 1 else ())
                    rows = [r for r in rows if (pos(r) >= key if start.get("before") else pos(r) > key)]
                rows = rows[: q.get("limit", 1000)]
                rt = self.now()
                out = [{"document": {"name": n, "fields": d["fields"], "createTime": rt, "updateTime": rt}, "readTime": rt} for n, d in rows]
                return await reply(200, out or [{"readTime": rt}])
            return await reply(404, {"error": {"code": 404, "message": "not found", "status": "NOT_FOUND"}})
        return await route.continue_()

    def records(self, uid="uidTristan"):
        prefix = f"projects/{PROJECT}/databases/(default)/documents/users/{uid}/records/"
        return {n[len(prefix):]: d["fields"] for n, d in self.docs.items() if n.startswith(prefix)}

async def new_device(browser, fake, errors, label):
    ctx = await browser.new_context(viewport={"width": 390, "height": 860})
    for host in ["identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com"]:
        await ctx.route(f"https://{host}/**", fake.handle)
    page = await ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"{label}: {e}"))
    page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
    await page.goto(BASE); await page.wait_for_timeout(1200)
    return ctx, page

async def connect(page, password=PASSWORD, config=CONFIG):
    await page.click("button[data-view=settings]"); await page.wait_for_timeout(200)
    if config is not None:
        await page.fill("#sync-connect-form [name=config]", config)
    await page.fill("#sync-connect-form [name=email]", EMAIL)
    await page.fill("#sync-connect-form [name=password]", password)
    await page.click("#sync-connect-form button[type=submit]")
    await page.wait_for_timeout(1500)

async def add_meal(page, name, kcal):
    await page.click("button[data-view=nutrition]"); await page.wait_for_timeout(200)
    await page.fill("#meal-form [name=name]", name)
    await page.fill("#meal-form [name=kcal]", str(kcal))
    await page.click("#meal-submit"); await page.wait_for_timeout(400)

async def main():
    fake = FakeFirebase()
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---------- Téléphone : données existantes, puis connexion ----------
        ctxA, A = await new_device(b, fake, errors, "téléphone")
        await add_meal(A, "Poulet riz", 650)
        await A.evaluate("""saveRecord({id:'wo-1',type:'workout',date:today(),sessionId:'push',sessionType:'Push',duration:80,cardio:'',notes:'note A',
          exercises:[{exerciseId:'chest-press',name:'Chest press',sets:[{load:70,reps:8,rpReps:7,rpPause:20}]}]}).then(()=>reloadAll())""")
        await connect(A, password="mauvais")
        t = await A.inner_text("#toast")
        check("Mot de passe incorrect : message clair, pas de connexion", "incorrect" in t and not await A.evaluate("syncTracking"), t)
        await connect(A, config="pas une config")
        check("Configuration absente ou invalide refusée", "firebaseConfig" in await A.inner_text("#toast"))
        await connect(A)
        recs = fake.records()
        check("Connexion : première synchro envoie toutes les entrées + programme + objectifs",
              await A.evaluate("syncTracking") and "wo-1" in recs and "setting-program" in recs and "setting-targets" in recs and len(recs) == 4, sorted(recs))
        check("Le mot de passe n'est pas enregistré sur l'appareil", PASSWORD not in json.dumps(await A.evaluate("getSetting('syncAccount')")))
        check("Statut affiché : à jour", "À jour" in await A.inner_text("#sync-status"))
        wo = json.loads(recs["wo-1"]["data"]["stringValue"])
        check("Séance envoyée avec son rest-pause", wo["exercises"][0]["sets"][0] == {"load": 70, "reps": 8, "rpReps": 7, "rpPause": 20})

        # ---------- PC : connexion, réception de tout ----------
        ctxB, B = await new_device(b, fake, errors, "PC")
        await connect(B)
        nb = await B.evaluate("({w: state.workouts.length, m: state.recentMeals.length, prog: state.program.sessions.length})")
        check("PC : reçoit les séances et repas du téléphone", nb["w"] == 1 and nb["m"] == 1, nb)
        check("PC : conserve la date de modification d'origine (pas de renvoi en boucle)",
              await B.evaluate("getRecord('wo-1').then(r=>r.updatedAt)") == await A.evaluate("getRecord('wo-1').then(r=>r.updatedAt)"))
        dirtyB = await B.evaluate("getSetting('syncDirty', {})")
        check("PC : rien en attente d'envoi après la synchro", dirtyB == {}, dirtyB)

        # ---------- Ajout sur le téléphone → automatique ----------
        writes_before = fake.calls["writes"]
        await add_meal(A, "Skyr", 90)
        await A.wait_for_timeout(3500)
        check("Ajout sur le téléphone envoyé automatiquement (sans bouton)", fake.calls["writes"] == writes_before + 1, fake.calls)
        await B.click("button[data-view=settings]")
        await B.click("#sync-now"); await B.wait_for_timeout(1200)
        check("PC : nouvel ajout reçu", await B.evaluate("state.recentMeals.some(m=>m.name==='Skyr')"))

        # ---------- Suppression sur le PC → transmise ----------
        skyr_id = await B.evaluate("state.recentMeals.find(m=>m.name==='Skyr').id")
        await B.evaluate(f"deleteRecord('{skyr_id}').then(()=>reloadAll())")
        await B.wait_for_timeout(3500)
        check("Suppression envoyée comme telle", fake.records().get(skyr_id, {}).get("deleted", {}).get("booleanValue") is True, (skyr_id, fake.records().get(skyr_id), await B.evaluate("getSetting('syncDirty',{})"), await B.evaluate("({...syncStatus})")))
        await A.evaluate("syncNow({manual:true})"); await A.wait_for_timeout(800)
        check("Téléphone : l'entrée supprimée sur le PC disparaît", not await A.evaluate(f"getRecord('{skyr_id}').then(Boolean)"))

        # ---------- Conflit : la modification la plus récente gagne ----------
        await A.evaluate("getRecord('wo-1').then(r=>{r.notes='modif téléphone';return saveRecord(r);})")
        await A.wait_for_timeout(50)
        await B.evaluate("getRecord('wo-1').then(r=>{r.notes='modif PC (plus récente)';return saveRecord(r);})")
        await A.wait_for_timeout(3500)
        await A.evaluate("syncNow({manual:true})"); await A.wait_for_timeout(800)
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(800)
        notes = (await A.evaluate("getRecord('wo-1').then(r=>r.notes)"), await B.evaluate("getRecord('wo-1').then(r=>r.notes)"))
        check("Conflit : la version la plus récente gagne sur les deux appareils", notes == ("modif PC (plus récente)",) * 2, notes)

        # ---------- Programme modifié sur le PC ----------
        await B.click("button[data-view=settings]"); await B.wait_for_timeout(200)
        await B.fill(".program-session:first-child .program-ex:first-child .pe-upat", "13")
        await B.click("#program-save"); await B.wait_for_timeout(3500)
        await A.click("button[data-view=dashboard]")
        await A.evaluate("syncNow({manual:true})"); await A.wait_for_timeout(800)
        check("Programme modifié sur le PC reçu par le téléphone", await A.evaluate("state.program.sessions[0].exercises[0].upAt") == 13)

        # ---------- Hors connexion puis retour du réseau ----------
        await ctxA.set_offline(True)
        await add_meal(A, "Banane hors ligne", 105)
        await A.wait_for_timeout(3000)
        check("Hors connexion : la saisie fonctionne, rien n'est perdu", await A.evaluate("getSetting('syncDirty',{}).then(d=>Object.keys(d).length)") >= 1)
        await ctxA.set_offline(False)
        await A.evaluate("window.dispatchEvent(new Event('online'))"); await A.wait_for_timeout(2500)
        check("Retour du réseau : envoi automatique", any(json.loads(f["data"]["stringValue"] or "{}").get("name") == "Banane hors ligne" for f in fake.records().values() if not f["deleted"]["booleanValue"]))

        # ---------- Données reçues contrôlées ----------
        evil = {"id": "evil1", "type": "meal", "date": "2026-11-05", "kind": "Déjeuner", "name": "<img src=x onerror=window.__pwned=1>", "kcal": 100, "updatedAt": 9999999999999}
        prefix = f"projects/{PROJECT}/databases/(default)/documents/users/uidTristan/records/"
        fake.docs[prefix + "evil1"] = {"fields": {"data": {"stringValue": json.dumps(evil)}, "updatedAt": {"integerValue": "9999999999999"}, "deleted": {"booleanValue": False}, "serverTime": {"timestampValue": fake.now()}}}
        fake.docs[prefix + "broken"] = {"fields": {"data": {"stringValue": "{pas du json"}, "updatedAt": {"integerValue": "1"}, "deleted": {"booleanValue": False}, "serverTime": {"timestampValue": fake.now()}}}
        await B.click("button[data-view=nutrition]")
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(1000)
        check("Fiche abîmée ignorée, fiche piégée affichée sans exécuter de script",
              await B.evaluate("!window.__pwned") and await B.evaluate("state.recentMeals.some(m=>m.id==='evil1')") and not await B.evaluate("getRecord('broken').then(Boolean)"))

        # ---------- Session expirée ----------
        fake.revoked.add("uidTristan")
        await A.evaluate("syncIdToken=null; syncNow()"); await A.wait_for_timeout(800)
        await A.click("button[data-view=settings]"); await A.wait_for_timeout(200)
        check("Session expirée : reconnexion demandée clairement", "Reconnexion nécessaire" in await A.inner_text("#sync-status") and await A.is_visible("#sync-relogin"))
        banana = await A.evaluate("getAllRecords().then(rs => rs.find(r => r.name === 'Banane hors ligne').id)")
        await A.evaluate(f"deleteRecord('{banana}').then(() => reloadAll())"); await A.wait_for_timeout(3000)
        await A.click("#sync-relogin"); await A.wait_for_timeout(200)
        check("Reconnexion : configuration gardée, mot de passe seul à retaper", await A.input_value("#sync-connect-form [name=email]") == EMAIL)
        await connect(A, config=None)
        check("Reconnecté : la synchro reprend", await A.evaluate("syncTracking") and "À jour" in await A.inner_text("#sync-status"))
        check("Suppression faite pendant la session expirée : transmise après reconnexion", fake.records()[banana]["deleted"]["booleanValue"] is True)

        # ---------- Gros volume : envoi groupé (même heure serveur) et réception page par page ----------
        await A.evaluate("""(async()=>{const list=[];for(let i=0;i<650;i++)list.push({id:'bulk-'+i,type:'meal',date:today(),kind:'Collation',name:'Import '+i,kcal:10});
          await saveRecords(list); await syncNow({manual:true});})()""")
        await A.wait_for_timeout(1500)
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(2500)
        nbulk = await B.evaluate("getAllRecords().then(rs=>rs.filter(r=>r.id.startsWith('bulk-')).length)")
        check("650 entrées d'un coup : toutes reçues sur l'autre appareil", nbulk == 650, nbulk)
        q_before = fake.calls["query"]
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(1500)
        check("Synchro juste après : les 2 dernières minutes sont relues sans rien changer", "à jour" in await B.inner_text("#toast") and fake.calls["query"] - q_before <= 3, (await B.inner_text("#toast"), fake.calls["query"] - q_before))
        fake.clock += timedelta(minutes=3)
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(1500)
        q_before = fake.calls["query"]
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(800)
        check("Synchro plus tard : rien n'est relu inutilement", fake.calls["query"] - q_before == 1 and "à jour" in await B.inner_text("#toast"), await B.inner_text("#toast"))
        await A.evaluate("(async()=>{for(let i=0;i<650;i++) await deleteRecord('bulk-'+i);})()"); await A.wait_for_timeout(4000)
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(2500)
        check("650 suppressions transmises", await B.evaluate("getAllRecords().then(rs=>rs.filter(r=>r.id.startsWith('bulk-')).length)") == 0)

        # ---------- Écriture d'un autre appareil devenue visible juste après une réception ----------
        await add_meal(A, "Dernier repas", 400); await A.wait_for_timeout(3500)
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(1000)
        cur = (await B.evaluate("getSetting('syncAccount')"))["lastPull"]["time"]
        t_before = (datetime.fromisoformat(cur.replace("Z", "+00:00")) - timedelta(seconds=1)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        late = {"id": "late1", "type": "meal", "date": "2026-11-05", "kind": "Dîner", "name": "Arrivée en retard", "kcal": 300, "updatedAt": 1893456000000}
        fake.docs[prefix + "late1"] = {"fields": {"data": {"stringValue": json.dumps(late)}, "updatedAt": {"integerValue": "1893456000000"}, "deleted": {"booleanValue": False}, "serverTime": {"timestampValue": t_before}}}
        await B.evaluate("syncNow({manual:true})"); await B.wait_for_timeout(1000)
        check("Écriture horodatée juste avant la dernière réception : quand même reçue", await B.evaluate("getRecord('late1').then(Boolean)"))

        # ---------- Effacer tout sur le PC : Firebase intact ----------
        before = {k: v["deleted"]["booleanValue"] for k, v in fake.records().items()}
        await B.click("button[data-view=settings]"); await B.wait_for_timeout(200)
        async with B.expect_download():
            await B.click("#clear-data")
        await B.wait_for_timeout(3000)
        after = {k: v["deleted"]["booleanValue"] for k, v in fake.records().items()}
        check("Effacer tout sur un appareil : synchro déconnectée, rien supprimé dans Firebase",
              not await B.evaluate("syncTracking") and before == after and await B.evaluate("countRecords()") == 0)
        await connect(B)
        check("Reconnexion du PC : tout revient depuis Firebase", await B.evaluate("state.workouts.length") == 1 and await B.evaluate("state.recentMeals.length") >= 2)

        check("Aucune erreur JavaScript", not errors, errors[:5])
        print("Appels simulés :", fake.calls)
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
