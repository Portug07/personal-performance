/* ==========================================================================
   Service worker : rend l'application disponible hors connexion.
   RÈGLE : à chaque livraison, augmenter VERSION. Sinon le téléphone garde l'ancienne version (audit C3).
   ========================================================================== */
const VERSION = "3.0.0";
const CACHE_NAME = `personal-performance-${VERSION}`;
const APP_SHELL = [
  "./", "./index.html", "./styles.css", "./manifest.json", "./icon.svg",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./utils.js", "./data.js", "./db.js", "./charts.js", "./training.js", "./nutrition.js",
  "./body.js", "./battery.js", "./wellbeing.js", "./dashboard.js", "./coach.js", "./backup.js", "./settings.js", "./app.js"
];

self.addEventListener("install", (event) => {
  /* « reload » : on télécharge les fichiers frais, sans passer par le cache HTTP. */
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" })))));
  /* Pas d'activation forcée : la page propose « Mettre à jour » pour ne pas couper une saisie en cours. */
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("personal-performance-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    /* Page d'accueil servie depuis le cache, même avec ?view=… : démarrage instantané et hors ligne. */
    event.respondWith(caches.match("./index.html").then((cached) => cached || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const client = clients.find((c) => "focus" in c);
    return client ? client.focus() : self.clients.openWindow("./?view=nutrition");
  }));
});
