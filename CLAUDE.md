# Règles du projet Personal Performance

Application web progressive (PWA) personnelle, 100 % locale. Utilisateur débutant en programmation : expliquer simplement, faire des changements sûrs et testés.

## Contraintes impératives
- Aucun abonnement, aucune API payante, aucun serveur payant. Fonctionnement hors connexion prioritaire.
- Seuls services en ligne autorisés (gratuits, facultatifs, listés dans la CSP `connect-src`) : Firebase Auth + Firestore du projet de l'utilisateur (sync.js) et Open Food Facts (scan.js). L'app doit rester entièrement utilisable sans eux.
- HTML, CSS et JavaScript simples : pas de framework, pas d'étape de compilation, pas de dépendance externe (pas de CDN).
- Interface en français, tutoiement.

## Architecture
- Tous les fichiers sont à la racine du dépôt (pas de sous-dossiers) : c'est plus simple à envoyer sur GitHub depuis le navigateur.
- Scripts classiques chargés dans l'ordre de `index.html` (utils → data → db → charts → training → session → nutrition → scan → quickmeals → recipes → body → battery → wellbeing → dashboard → coach → backup → settings → sync → app). Les fonctions sont globales : un nouveau nom ne doit pas déjà exister dans un autre fichier.
- État en mémoire : objet `state` (data.js), rechargé depuis IndexedDB après chaque écriture.
- IndexedDB (db.js) : magasins `records` (index `type` et `type_date`), `photos`, `settings`.
- Types d'entrées : `workout`, `meal` (dont alcool : `kind: "Alcool"`, `volumeMl`, `abv`), `measurement` (`moment` de la pesée), `wellbeing` (dont `sleepQuality`, `kneeBefore/kneeDuring/kneeNext`), `battery` (batterie de tests), `mealTemplate` (repas habituel : `name`, `kind`, `items` = champs de repas), `recipe` (`name`, `ingredients` [{ `name`, `grams` crus, `per100` }], `cookedGrams` facultatif ; valeurs pour 100 g calculées par `recipePer100`). Un nouveau type demande d'augmenter `SYNC_TYPES_VERSION` (sync.js) : les appareils relisent alors tout Firebase une fois.
- Mode séance (session.js) : n'a pas de données propres ; il lit et écrit les champs du formulaire de séance. Les réglages + / − restent en attente (`sm.pending`) jusqu'au bouton de validation.
- Séries : `{ load, reps }` + en rest-pause `rpReps` (complément) et `rpPause` (s). `reps` = reps avant l'échec : c'est lui qui sert au 1RM estimé et au conseil de progression.
- Poids du corps : exercice de séance `bodyweight: true` ; `load` = lest (null = sans lest). Détection par le nom (`isBodyweightName`) ou la dernière fois (`exerciseIsBodyweight`). `fmtSet(set, bodyweight)` : toujours passer le 2e argument explicitement (jamais `.map(fmtSet)`, l'index serait pris pour le drapeau).
- Repas scannés : `nutriscore` (a–e) et `nova` (1–4) facultatifs, venant d'Open Food Facts.
- Programme : `schema: 3` ; chaque exercice a `mode` (`restpause` ou `classic`), `target`, `upAt`, `rpPause`, `repMin`, `repMax`, `increment`, `loads`. `upgradeProgram` met à niveau les programmes plus anciens.
- Export pour l'agent coach (coach.js) : il suit `spec-export-personal-performance.md`. Toute évolution du format doit mettre à jour la spec et les tests.
- Synchronisation (sync.js) : chaque écriture de db.js marque l'entrée « à envoyer » (`syncDirty`, même transaction) quand la synchro est active. Envoi groupé (`commit` Firestore) puis réception par curseur (heure serveur + nom). La plus récente modification gagne (`updatedAt`) ; une suppression est envoyée comme fiche `deleted: true`. Les données reçues passent par `normalizeRecord`. Réglages synchronisés : `SYNCED_SETTINGS` (data.js). Jamais de mot de passe enregistré.
- Aliments : mini-base `FOODS` (data.js), table Ciqual `ciqual.json` (chargée à la première recherche, en cache hors ligne), produits scannés gardés dans le réglage `foodCache` (non synchronisé).

## À chaque livraison
1. Augmenter `VERSION` dans `sw.js` ET `APP_VERSION` dans `data.js` (même numéro). Sans cela, les téléphones gardent l'ancienne version.
2. Ajouter tout nouveau fichier à `APP_SHELL` dans `sw.js`.
3. Lancer `python test_app.py`, `python test_sync.py`, `python test_scan.py` et `python test_features.py` : toutes les vérifications doivent être OK. Ajouter un test pour chaque nouvelle fonction.

## Données : ne jamais perdre l'historique
- Ne jamais changer le format d'une entrée sans migration : incrémenter `DB_VERSION` dans `db.js` et migrer dans `onupgradeneeded`, sans rien supprimer. Un champ facultatif ajouté (absent des anciennes entrées) ne demande pas de migration, à condition que tout le code accepte son absence.
- Tout import passe par `normalizeRecord` (data.js) : l'adapter quand un champ est ajouté. Garder la lecture des anciens formats (version 1 comprise).
- Une écriture n'est annoncée réussie qu'après la fin de la transaction (`txDone`).
- Les exercices sont reliés à leur historique par leur nom (sans accents ni majuscules, fonction `fold`).

## Sécurité
- Toute valeur insérée dans la page passe par `esc()`.
- La politique de sécurité (balise CSP dans index.html) interdit les scripts en ligne, les `onclick=` et les attributs `style=""` : passer par les fichiers JS/CSS, et par `element.style` en JavaScript si besoin.
- Les nombres saisis passent par `parseNumber` / `readNumber` (acceptent la virgule).
- Ne jamais committer de sauvegarde (`*.json` exportés) : ce sont des données de santé.
