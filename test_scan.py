"""Tests de la base d'aliments : table Ciqual (hors connexion) et scan de code-barres (scan.js)
avec décodeur intégré, caméra simulée et Open Food Facts simulé.

Usage (depuis le dossier de l'application) :
    python test_scan.py

Les codes-barres sont dessinés par le script (flou, bruit, petite taille, à l'envers, de travers…).
Open Food Facts est remplacé par une simulation : aucun accès réseau réel.
"""
import asyncio, base64, io, json, os, shutil, socket, subprocess, sys, tempfile, time
from PIL import Image, ImageDraw, ImageFilter
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix="pp-scan-")
def free_port():
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0)); return so.getsockname()[1]
PORT = free_port()
BASE = f"http://localhost:{PORT}/"
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("OK   " if cond else "ÉCHEC"), name, ("— " + str(detail)) if detail != "" else "")

# ---------- Dessin de codes-barres EAN ----------
L = ["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112"]
FIRST = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]
def widths_bits(w, start_bar):
    out, bar = "", start_bar
    for c in w:
        out += ("1" if bar else "0") * int(c); bar = not bar
    return out
def ean_modules(code):
    if len(code) == 13:
        par = FIRST[int(code[0])]
        left = "".join(widths_bits(L[int(d)] if p == "L" else L[int(d)][::-1], False) for d, p in zip(code[1:7], par))
        right = "".join(widths_bits(L[int(d)], True) for d in code[7:])
    else:
        left = "".join(widths_bits(L[int(d)], False) for d in code[:4])
        right = "".join(widths_bits(L[int(d)], True) for d in code[4:])
    return "101" + left + "01010" + right + "101"
def barcode_image(code, module=3, height=120):
    bits = "0" * 11 + ean_modules(code) + "0" * 11
    img = Image.new("L", (len(bits), 1), 255)
    for i, b in enumerate(bits):
        if b == "1": img.putpixel((i, 0), 20)
    return img.resize((round(len(bits) * module), height), Image.BILINEAR)
def scene(code, module=3, blur=0, noise=0, angle=0, shear=0, size=(960, 540), dark_bg=False, gradient=False):
    bg = Image.new("L", size, 90 if dark_bg else 200)
    if gradient:
        d = ImageDraw.Draw(bg)
        for x in range(size[0]):
            d.line([(x, 0), (x, size[1])], fill=int(120 + 120 * x / size[0]))
    d = ImageDraw.Draw(bg)
    d.text((20, 20), "Pâte à tartiner — 400 g — à consommer de préférence avant", fill=30)
    bc = barcode_image(code, module)
    label = Image.new("L", (bc.width + 30, bc.height + 30), 245)
    label.paste(bc, (15, 15))
    if shear:
        label = label.transform(label.size, Image.AFFINE, (1, shear, -shear * label.height / 2, 0, 1, 0), resample=Image.BILINEAR, fillcolor=245)
    if angle:
        label = label.rotate(angle, expand=True, fillcolor=200)
    bg.paste(label, ((size[0] - label.width) // 2, (size[1] - label.height) // 2))
    if blur:
        bg = bg.filter(ImageFilter.GaussianBlur(blur))
    if noise:
        bg = Image.blend(bg, Image.effect_noise(size, 60), noise)
    return bg.convert("RGB")
def data_url(img):
    buf = io.BytesIO(); img.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

OFF_PRODUCTS = {
    "3017620422003": {"code": "3017620422003", "status": 1, "product": {
        "product_name_fr": "Pâte à tartiner test", "brands": "MarqueTest,Autre", "serving_quantity": 15,
        "nutriments": {"energy-kcal_100g": 539, "proteins_100g": 6.3, "carbohydrates_100g": 57.5, "fat_100g": 30.9, "fiber_100g": 0}}},
    "5449000000996": {"code": "5449000000996", "status": 1, "product": {
        "product_name": "Soda test", "brands": "", "nutriments": {"energy_100g": 180, "carbohydrates_100g": 10.6}}},
    "96385074": {"code": "96385074", "status": 1, "product": {
        "product_name_fr": "<img src=x onerror=window.__pwned=1>", "nutriments": {}}},
}
off_calls = []
async def off_route(route):
    code = route.request.url.split("/product/")[1].split(".json")[0]
    off_calls.append(code)
    if code in OFF_PRODUCTS:
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(OFF_PRODUCTS[code]), headers={"access-control-allow-origin": "*"})
    else:
        await route.fulfill(status=404, content_type="application/json", body=json.dumps({"code": code, "status": 0, "status_verbose": "product not found"}), headers={"access-control-allow-origin": "*"})

async def wait_closed(page, timeout=15):
    """Attend la fermeture de la fenêtre de scan (la CSP de l'app interdit wait_for_function)."""
    end = time.time() + timeout
    while time.time() < end:
        if not await page.evaluate("document.getElementById('scan-dialog').open"): return True
        await page.wait_for_timeout(200)
    return False

async def decode(page, img):
    return await page.evaluate("""async (url) => {
        const im = new Image(); im.src = url; await im.decode();
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
        const r = scanImageData(ctx.getImageData(0, 0, c.width, c.height));
        return r ? r.code : null;
    }""", data_url(img))

async def main():
    errors = []
    # Vidéo de la caméra simulée : un emballage avec son code-barres, filmé un peu flou.
    frame = scene("3017620422003", module=3.2, blur=0.8, noise=0.12, shear=0.04, size=(960, 540), gradient=True)
    frame_path = os.path.join(TMP, "frame.png"); frame.save(frame_path)
    y4m = os.path.join(TMP, "camera.y4m")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-i", frame_path, "-t", "1", "-r", "10", "-pix_fmt", "yuv420p", y4m], check=True)

    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-video-capture={y4m}"])
        ctx = await b.new_context(viewport={"width": 390, "height": 860}, permissions=["camera"])
        await ctx.route("https://world.openfoodfacts.org/**", off_route)
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        # Le 404 d'un produit inconnu est la réponse normale d'Open Food Facts : le navigateur le note, ce n'est pas une erreur de l'app.
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text else None)
        await page.goto(BASE); await page.wait_for_timeout(1000)

        # ---------- Décodeur intégré ----------
        cases = [
            ("net, gros", "3017620422003", dict(module=4)),
            ("petit (2 px par barre)", "3017620422003", dict(module=2)),
            ("très petit (1,6 px)", "5449000000996", dict(module=1.6, size=(640, 360))),
            ("flou", "3017620422003", dict(module=3, blur=1.3)),
            ("bruit", "5449000000996", dict(module=3, noise=0.3)),
            ("flou + bruit + lumière inégale", "3274080005003", dict(module=2.6, blur=1, noise=0.2, gradient=True)),
            ("à l'envers", "3017620422003", dict(module=3, angle=180)),
            ("vertical", "5449000000996", dict(module=2.5, angle=90, size=(540, 960))),
            ("de travers (perspective)", "3017620422003", dict(module=3, shear=0.12)),
            ("légèrement penché (5°)", "3017620422003", dict(module=3, angle=5)),
            ("fond sombre", "7613035676497", dict(module=3, dark_bg=True)),
            ("EAN-8", "96385074", dict(module=3)),
            ("UPC-A (0 en tête)", "0036000291452", dict(module=3)),
        ]
        for label, code, kw in cases:
            got = await decode(page, scene(code, **kw))
            check(f"Décodeur : {label}", got == code, got)
        blank = scene("3017620422003", module=3)
        ImageDraw.Draw(blank).rectangle([0, 0, 960, 540], fill=200)
        ImageDraw.Draw(blank).text((50, 250), "||| Ceci n'est pas un code-barres 1234567890123 |||", fill=20)
        check("Décodeur : rien d'inventé sans code-barres", await decode(page, blank.filter(ImageFilter.GaussianBlur(0.5))) is None)
        check("Décodeur : bruit pur ignoré", await decode(page, Image.effect_noise((960, 540), 80).convert("RGB")) is None)
        check("Somme de contrôle", await page.evaluate("[eanChecksumOk('3017620422003'), eanChecksumOk('3017620422004'), eanChecksumOk('96385074'), normalizeBarcode('036000291452'), normalizeBarcode('12 34')]")
              == [True, False, True, "0036000291452", None])

        # ---------- Table Ciqual : recherche hors connexion ----------
        await page.click("button[data-view=nutrition]"); await page.wait_for_timeout(300)
        async def suggest(text):
            await page.fill("#meal-form [name=name]", text); await page.dispatch_event("#meal-form [name=name]", "input")
            await page.wait_for_timeout(700)
            return await page.evaluate("[...document.querySelectorAll('#food-suggestions .food-chip')].map(b => ({t: b.textContent, c: b.className}))")
        chips = await suggest("riz")
        ciq = [c["t"] for c in chips if "ciqual" in c["c"]]
        check("Ciqual : « riz » propose des riz, pas du chorizo", ciq and all(t.lower().startswith("riz") for t in ciq[:3]) and not any("Chorizo" in t for t in ciq), ciq[:4])
        chips = await suggest("poulet roti")
        ciq = [c["t"] for c in chips if "ciqual" in c["c"]]
        check("Ciqual : plusieurs mots, accents ignorés (« poulet roti » → rôti)", ciq and all("poulet" in t.lower() and "rôti" in t.lower() for t in ciq), ciq[:3])
        chips = await suggest("oeuf dur")
        check("Ciqual : « oeuf » trouve les œufs, pas le bœuf", any("ciqual" in c["c"] and "dur" in c["t"].lower() for c in chips) and not any("boeuf" in c["t"].lower() for c in chips), [c["t"] for c in chips][:4])
        chips = await suggest("sky")
        check("Mini-base toujours proposée (skyr absent de Ciqual)", any("Skyr" in c["t"] and "ciqual" not in c["c"] for c in chips))
        await suggest("banane chair crue")
        await page.click("#food-suggestions .food-chip.ciqual")
        vals = await page.evaluate("[mealForm().elements.name.value, mealForm().elements.grams.value, mealForm().elements.kcal.value, mealPer100 && mealPer100.kcal]")
        check("Aliment Ciqual choisi : 100 g par défaut, calories calculées", vals[0].startswith("Banane") and vals[1] == "100" and vals[2] == str(vals[3]), vals)
        await page.fill("#meal-form [name=grams]", "120"); await page.dispatch_event("#meal-form [name=grams]", "input")
        check("Ciqual : grammes modifiés, calories recalculées", await page.input_value("#meal-form [name=kcal]") == str(round(vals[3] * 1.2)))
        chips = await suggest("zzqx")
        check("Rien trouvé : conseil affiché", "Rien trouvé" in await page.inner_text("#food-suggestions"))
        await page.evaluate("resetMealForm()")
        await page.evaluate("navigator.serviceWorker.ready")
        await page.wait_for_timeout(800)
        await ctx.set_offline(True)
        await page.reload(); await page.wait_for_timeout(1200)
        await page.click("button[data-view=nutrition]")
        chips = await suggest("lentille")
        check("Ciqual hors connexion (application installée)", any("ciqual" in c["c"] for c in chips), len(chips))
        await ctx.set_offline(False)
        await page.evaluate("resetMealForm()")

        # ---------- Parcours complet avec la caméra (simulée) ----------
        await page.select_option("#meal-form [name=kind]", "Petit-déjeuner")
        await page.click("#scan-open")
        closed = await wait_closed(page)
        form = await page.evaluate("""(() => { const f = document.getElementById('meal-form').elements;
            return {name: f.name.value, grams: f.grams.value, quantity: f.quantity.value, kcal: f.kcal.value, protein: f.protein.value, carbs: f.carbs.value, fat: f.fat.value, fiber: f.fiber.value}; })()""")
        check("Caméra : code lu, produit trouvé, formulaire rempli (portion de 15 g)",
              closed and form == {"name": "Pâte à tartiner test (MarqueTest)", "grams": "15", "quantity": "1 portion", "kcal": "81", "protein": "0,9", "carbs": "8,6", "fat": "4,6", "fiber": "0"}, form)
        check("Caméra éteinte après la lecture", await page.evaluate("scanStream === null && !document.getElementById('scan-video').srcObject"))
        check("Message : produit et calories pour 100 g", "539 kcal pour 100 g" in await page.inner_text("#toast"))
        await page.fill("#meal-form [name=grams]", "30"); await page.dispatch_event("#meal-form [name=grams]", "input")
        check("Grammes modifiés : valeurs recalculées", await page.input_value("#meal-form [name=kcal]") == "162")
        await page.click("#meal-submit"); await page.wait_for_timeout(500)
        meal = await page.evaluate("state.recentMeals.find(m => m.name.startsWith('Pâte à tartiner test'))")
        check("Repas enregistré avec ses valeurs pour 100 g", meal and meal["kcal"] == 162 and meal["per100"]["kcal"] == 539 and meal["grams"] == 30, meal)

        # ---------- Saisie manuelle du numéro (la caméra simulée filme toujours le même code : lecture suspendue) ----------
        await page.evaluate("() => { window.__scan = scanImageData; scanImageData = () => null; }")
        async def manual(code):
            if await page.evaluate("document.getElementById('scan-dialog').open"): await page.click("#scan-close")
            await page.click("#scan-open"); await page.wait_for_timeout(400)
            await page.fill("#scan-manual [name=code]", code)
            await page.click("#scan-manual button[type=submit]"); await page.wait_for_timeout(600)
            return await page.inner_text("#scan-status")
        status = await manual("5449000000997")
        check("Numéro mal recopié : signalé, pas de recherche", "mal recopié" in status and "5449000000997" not in off_calls, status)
        status = await manual("3274080005003")
        check("Produit inconnu : message clair, dialogue ouvert", "absent d'Open Food Facts" in status and await page.evaluate("document.getElementById('scan-dialog').open"), status)
        check("Caméra coupée pendant la saisie manuelle", await page.evaluate("scanStream === null"))
        await page.click("#scan-close")
        await page.evaluate("resetMealForm()")
        await manual("5449 0000 00996")
        vals = await page.evaluate("[mealForm().elements.name.value, mealForm().elements.grams.value, mealForm().elements.kcal.value, mealForm().elements.carbs.value]")
        check("Énergie en kJ seulement : convertie en kcal (180 kJ → 43 kcal / 100 g)", vals == ["Soda test", "100", "43", "10,6"], vals)
        await page.evaluate("resetMealForm()")
        await manual("96385074")
        check("Produit sans valeurs : nom repris, valeurs à saisir, rien d'exécuté",
              await page.evaluate("!window.__pwned && mealForm().elements.name.value.includes('<img') && mealForm().elements.kcal.value === '' && mealPer100 === null"))
        check("Fenêtre fermée par le bouton : caméra éteinte", await page.evaluate("document.getElementById('scan-dialog').open === false && scanStream === null"))

        # ---------- Hors connexion ----------
        await ctx.set_offline(True)
        await page.evaluate("resetMealForm()")
        n_calls = len(off_calls)
        await manual("3017620422003")
        check("Hors connexion : produit déjà scanné retrouvé sur l'appareil",
              len(off_calls) == n_calls and await page.evaluate("mealForm().elements.name.value") == "Pâte à tartiner test (MarqueTest)")
        status = await manual("7613035676497")
        check("Hors connexion, produit jamais scanné : message clair", "Pas de réseau" in status, status)
        await page.click("#scan-close")
        await ctx.set_offline(False)

        # ---------- Caméra refusée ----------
        ctx2 = await b.new_context(viewport={"width": 390, "height": 860})
        page2 = await ctx2.new_page()
        await page2.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('refus'), {name: 'NotAllowedError'}));")
        await page2.goto(BASE); await page2.wait_for_timeout(800)
        await page2.click("button[data-view=nutrition]"); await page2.click("#scan-open"); await page2.wait_for_timeout(500)
        check("Caméra refusée : explication + saisie du numéro proposée", "refusé" in await page2.inner_text("#scan-status") and await page2.is_visible("#scan-manual [name=code]"))
        await ctx2.close()

        # Capture d'écran pour contrôle visuel (fenêtre de scan sur téléphone, lecture suspendue).
        await page.click("#scan-open"); await page.wait_for_timeout(1500)
        await page.screenshot(path=os.path.join(TMP, "scan-dialog.png"))
        print("Capture :", os.path.join(TMP, "scan-dialog.png"))
        await page.evaluate("() => { scanImageData = window.__scan; }")
        check("Caméra : la lecture reprend après la pause", await wait_closed(page))

        check("Aucune erreur JavaScript", not errors, errors[:5])
        await b.close()
    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} vérifications réussies")
    return passed == len(results)

if __name__ == "__main__":
    if not shutil.which("ffmpeg"):
        print("ffmpeg est nécessaire pour simuler la caméra."); sys.exit(1)
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        ok = asyncio.run(main())
    finally:
        server.terminate()
    sys.exit(0 if ok else 1)
