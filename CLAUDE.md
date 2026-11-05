# Règles du projet Personal Performance

Application web progressive (PWA) personnelle, 100 % locale. Utilisateur débutant en programmation : expliquer simplement, faire des changements sûrs et testés.

## Contraintes impératives
- Aucun abonnement, aucune API payante, aucun serveur. Fonctionnement hors connexion prioritaire.
- HTML, CSS et JavaScript simples : pas de framework, pas d'étape de compilation, pas de dépendance externe (pas de CDN).
- Interface en français, tutoiement.

## Architecture
- Scripts classiques chargés dans l'ordre de `index.html` (utils → data → db → charts → training → nutrition → body → battery → wellbeing → dashboard → coach → backup → settings → app). Les fonctions sont globales : un nouveau nom ne doit pas déjà exister dans un autre fichier.
- État en mémoire : objet `state` (js/data.js), rechargé depuis IndexedDB après chaque écriture.
- IndexedDB (js/db.js) : magasins `records` (index `type` et `type_date`), `photos`, `settings`.
- Types d'entrées : `workout`, `meal` (dont alcool : `kind: "Alcool"`, `volumeMl`, `abv`), `measurement` (`moment` de la pesée), `wellbeing` (dont `sleepQuality`, `kneeBefore/kneeDuring/kneeNext`), `battery` (batterie de tests).
- Séries : `{ load, reps }` + en rest-pause `rpReps` (complément) et `rpPause` (s). `reps` = reps avant l'échec : c'est lui qui sert au 1RM estimé et au conseil de progression.
- Programme : `schema: 3` ; chaque exercice a `mode` (`restpause` ou `classic`), `target`, `upAt`, `rpPause`, `repMin`, `repMax`, `increment`, `loads`. `upgradeProgram` met à niveau les programmes plus anciens.
- Export pour l'agent coach (js/coach.js) : il suit `spec-export-personal-performance.md`. Toute évolution du format doit mettre à jour la spec et les tests.

## À chaque livraison
1. Augmenter `VERSION` dans `sw.js` ET `APP_VERSION` dans `js/data.js` (même numéro). Sans cela, les téléphones gardent l'ancienne version.
2. Ajouter tout nouveau fichier à `APP_SHELL` dans `sw.js`.
3. Lancer `python tests/test_app.py` : toutes les vérifications doivent être OK. Ajouter un test pour chaque nouvelle fonction.

## Données : ne jamais perdre l'historique
- Ne jamais changer le format d'une entrée sans migration : incrémenter `DB_VERSION` dans `js/db.js` et migrer dans `onupgradeneeded`, sans rien supprimer. Un champ facultatif ajouté (absent des anciennes entrées) ne demande pas de migration, à condition que tout le code accepte son absence.
- Tout import passe par `normalizeRecord` (js/data.js) : l'adapter quand un champ est ajouté. Garder la lecture des anciens formats (version 1 comprise).
- Une écriture n'est annoncée réussie qu'après la fin de la transaction (`txDone`).
- Les exercices sont reliés à leur historique par leur nom (sans accents ni majuscules, fonction `fold`).

## Sécurité
- Toute valeur insérée dans la page passe par `esc()`.
- La politique de sécurité (balise CSP dans index.html) interdit les scripts en ligne, les `onclick=` et les attributs `style=""` : passer par les fichiers JS/CSS, et par `element.style` en JavaScript si besoin.
- Les nombres saisis passent par `parseNumber` / `readNumber` (acceptent la virgule).
- Ne jamais committer de sauvegarde (`*.json` exportés) : ce sont des données de santé.
