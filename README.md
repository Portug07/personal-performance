# Personal Performance — version 3.8

Application personnelle de suivi sportif et nutritionnel. Interface en français, pensée pour le téléphone, sans abonnement, sans API payante et sans serveur à payer. Les données restent sur l'appareil ; la synchronisation entre appareils est facultative et passe par ton propre projet Firebase gratuit.

## Nouveautés de la version 3.8 (retours de séance)

- **Pause RP réglable** : sur le minuteur en cours, −5 / +5 secondes (5 s minimum), pour les pauses comme pour les repos. Une pause RP ajustée est retenue pour cet exercice : la prochaine fois, elle démarre à ta valeur (dans le mode séance aussi).
- **Plusieurs pauses dans une série** (8 + 5 + 3) : dans le formulaire, dès que le complément est noté, « + pause RP » ouvre RP2 puis RP3 ; dans le mode séance, « Complément fait → encore une pause » relance la pause et attend le complément suivant. Affiché « 70 × 8+5+3 », compté dans le volume, envoyé au coach. Le 1RM estimé et la progression restent calculés sur les reps avant l'échec.
- **Mode séance sans verrouillage** : tant que le mode séance est ouvert, le téléphone ne se verrouille pas (ton délai de 30 s reste le même partout ailleurs). Après 15 s sans toucher l'écran, il passe au noir (très peu de batterie) avec le décompte en gris ; un appui le rallume, la fin du repos aussi. Option « Écran noir entre les séries : oui / non ».
- **Sonner écran verrouillé** : les bips de fin de repos sont programmés d'avance ; option « Sonner aussi écran verrouillé » (Séance → Minuteur) : un son continu presque inaudible pendant le décompte garde l'app éveillée (selon le téléphone, ta musique peut se mettre en pause).
- **Objectifs selon la journée** (Réglages → Objectifs selon la journée) : trois lignes complet / semi / sans sport (kcal, protéines, glucides, lipides). L'accueil, la nutrition, « Il te reste » et le menu de la journée prennent tout seuls le bon objectif : complet si ta séance du jour a le vélo d'échauffement et la marche du retour, semi pour une autre séance ou une course, sans sport sinon. Barre « Journée » sur l'accueil et en nutrition pour choisir à la main (ex. « Complet » le matin si tu vas à la salle le soir) ; « Auto » revient à la détection. Le choix se synchronise avec tes objectifs.

## Nouveautés de la version 3.7 (course)

Tout est dans Séance → « Reprise course / marche ».

- **Plan de reprise course / marche** : 13 étapes, de 8 × (1 min de course + 2 min de marche) à 30 min de course continue, avec 5 min de marche avant et après. On avance si le genou suit : douleur la plus forte (pendant, juste après, le lendemain matin) de 0 à 2/10 → séance validée, 2 séances validées → étape suivante ; 3 à 5 → on répète l'étape ; plus de 5 → une étape plus bas. Un jour sans courir entre deux sorties ; plus de 14 jours d'arrêt → une étape plus bas. Le lendemain d'une sortie, l'app te demande « Ton genou ce matin ? » (un appui). C'est une proposition : tu choisis toujours l'étape, et la reprise est à valider avec ton médecin ou ton kiné.
- **Minuteur guidé** : écran noir (économise la batterie), « COURS » / « MARCHE » en très gros, temps restant, la suite annoncée. Bips dans tes écouteurs (Bluetooth compris) : 2 bips aigus = cours, 1 bip grave = marche, décompte 3-2-1, 3 notes = fini ; vibrations en plus. Les bips sont programmés d'avance : ils tombent juste même si le téléphone ralentit l'app. Pause, Passer, « J'ai mal : j'arrête », Terminer. App fermée par erreur → « Reprendre ». À la fin : bilan (durée, distance, genou, effort).
- **Écran allumé ou éteint** : par défaut l'écran reste allumé en noir et ta musique continue (les bips passent par-dessus). Option « Mode écran éteint » : un son continu presque inaudible garde l'app active téléphone verrouillé ; selon le téléphone, ta musique peut alors se mettre en pause. À tester une fois avant une vraie sortie.
- **Journal de course** : séances du minuteur, courses notées à la main, imports ; allure calculée ; modifier, supprimer. Dans l'export coach (`courses`), le récap du jour et la fiche « État actuel ».
- **Import GPX** : bouton « Importer un GPX », ou menu Partager d'une autre app Android → Personal Performance (app installée). Distance, temps en mouvement, dénivelé ; un fichier déjà importé est reconnu ; le même jour qu'une séance du minuteur, il la complète (distance, allure) au lieu de créer un doublon.
- **Import automatique Strava** (facultatif, gratuit) : Réglages → Strava. Tes sorties « Course » arrivent toutes seules (à l'ouverture, au plus toutes les 30 min). Voir « Connecter Strava » ci-dessous.

### Connecter Strava

1. Sur strava.com (plus simple sur ordinateur) : Paramètres → « Mon application API » (strava.com/settings/api).
2. Crée l'application : nom « Personal Performance », site web = l'adresse de l'app, « Domaine du rappel d'autorisation » = `portug07.github.io` (le domaine de ton site, sans https ni chemin).
3. Dans l'app, Réglages → Strava : colle l'« ID client » et le « Secret client », puis « Connecter Strava », et coche l'accès à tes activités. Un seul appareil suffit (ton téléphone) : les courses importées se synchronisent.

L'ID, le secret et les clés d'accès restent sur l'appareil (jamais synchronisés, jamais dans le code). Si Strava refuse l'appel direct depuis le navigateur (règle de sécurité de leur côté, qu'ils peuvent changer), l'app le dit et l'import GPX reste disponible : sur strava.com, une activité → « … » → « Exporter au format GPX ».

## Nouveautés de la version 3.6 (journée, sécurité, coach)

- **Génère la suite de ma journée** (Nutrition → « Il te reste » → bouton) : l'app propose les repas qui restent (petit-déjeuner jusqu'à 11 h, déjeuner jusqu'à 15 h, collation jusqu'à 19 h, dîner) pour tomber sur tes calories en couvrant tes protéines. Uniquement avec ce que tu manges vraiment : repas habituels, repas déjà notés (60 derniers jours), recettes, aliments fréquents ; portions ajustées de ± 25 % quand tout est pesé. « Autre idée » change un seul repas, « Je l'ai mangé : ajouter » le note (annulable). Le menu est gardé pour la journée.
- **Copies de sécurité dans ton Firebase** (Réglages → Synchronisation) : une fois par semaine, une copie complète (sans les photos, compressée) est rangée à part ; les 8 dernières sont gardées. Si une erreur passe par la synchro (suppression, mauvais import), « Voir les copies » → « Fusionner » (récupère ce qui manque) ou « Remplacer ». « Faire une copie maintenant » avant une grosse manipulation.
- **Fiche « État actuel » mise à jour par l'app** (Accueil → Coach → « Mettre à jour la fiche ») : tu colles ta fiche une fois ; ensuite un appui la remet à jour (date, poids de référence, tour de taille, cible calorique, tableau des charges d'après tes dernières séances, et lignes « (app) » : rythme réel, vélo, plateaux, genou, moyennes de 4 semaines, alcool, batterie de tests). Tous tes autres textes restent tels quels. Copier ou télécharger, puis remplacer la fiche dans le projet coach.

### Copies de sécurité : règles Firestore

Les copies sont rangées dans `users/{ton identifiant}/backups` et `backupIndex`, à côté de `records`. Si « Faire une copie maintenant » affiche « Firestore refuse les copies de sécurité », remplace les règles (console Firebase → Firestore → Règles → Publier) par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Nouveautés de la version 3.5 (musculation)

- **Génère ma séance** (Séance → « Génère ma séance ») : tu choisis ton temps (30 min à 1 h 30), l'app construit la séance complète. Type automatique (Push après un Pull, Pull après un Push, haut du corps complet si rien de récent), exercices de ton programme d'abord puis des équivalents, charges de ta dernière fois (+ palier si le seuil est atteint), cible, repos, pause rest-pause. Pas de jambes. Muscles travaillés la veille : 2 séries maximum. Cardio : échauffement vélo 5 min et/ou 10–15 min en fin de séance (vélo, elliptique, rameur, marche inclinée, ergomètre à bras). « Autre proposition » pour en tirer une autre, « Remplacer » sur chaque exercice. « Lancer » ouvre le mode séance ; elle s'enregistre en « Séance générée · Pull ».
- **Remplacer un exercice** (machine prise) : sur chaque exercice et dans le mode séance. Équivalents pour les mêmes muscles (ton historique + une bibliothèque haut du corps), avec ta dernière fois. Charges et historique suivent le nouvel exercice.
- **Plateaux** : pas de progrès depuis 3 séances (1RM estimé, ou reps au poids du corps) → signalé sur l'exercice avec des pistes ; le générateur propose une variante à la place.
- **Progression automatique** : seuil atteint la dernière fois → les charges arrivent déjà augmentées du palier. « Garder les charges d'avant » pour annuler.
- **Renommer / fusionner** (Progrès → exercice) : nouveau nom appliqué à toutes les séances et au programme ; nom existant = historiques réunis.
- **Programme du coach** (Réglages → Programme) : colle la réponse de ton agent, aperçu des changements, installation en un appui (annulable). Gabarit à donner à l'agent : « Gabarit-programme-pour-app.md ».

## Nouveautés de la version 3.4 (nutrition rapide)

- **Aliments fréquents** : champ « Aliment » vide = tes 8 aliments les plus notés (60 jours) avec ta dernière portion. Un appui remplit tout.
- **Saisie express** : « 200 g skyr, 50 g flocons d'avoine, 1 banane, 1 c. à soupe d'huile » (tapé ou dicté au micro du clavier). Chaque aliment est reconnu (tes aliments d'abord, puis recettes, mini-base, Ciqual), les grammes sont proposés, tu vérifies et tout est ajouté d'un coup (annulable).
- **Portions sans balance** : « 2 pièces », « 1 c. à soupe », « 1 bol »… converties en grammes (poids propre à l'aliment quand il est connu : 1 c. à soupe d'huile = 10 g, 1 banane = 120 g). Si tu as déjà noté « 1 pièce = 60 g » pour un aliment, c'est ce poids qui sert.
- **Cru / cuit** : riz, pâtes, semoule, légumineuses, viandes, poissons. Aliment cru mais pesé cuit (ou l'inverse) ? « Pesé : cuit » et les valeurs sont converties (riz × 2,6, pâtes × 2,3, viande × 0,75…).
- **Scan express** : un produit déjà mangé est ajouté directement avec ta portion habituelle (annulable).
- **Repas habituel repéré** : même combinaison 3 fois en 30 jours au même repas → « En faire un repas habituel ? ».
- **Il manque…** : hier ou avant-hier, un repas que tu notes d'habitude manque → compléter en un appui (repas habituel, saisir, « pas mangé » = repas sauté à 0 kcal) ou ignorer.

## Nouveautés de la version 3.3

- **Exercices au poids du corps** : pompes, tractions, dips, gainage… sont reconnus à leur nom (bouton « Poids du corps » sur chaque exercice pour corriger). La case de charge devient « lest », facultative : vide = poids du corps. Affichage « PDC × 20 » ou « PDC+10 × 8 ». Records et courbe de progression en reps. Le mode séance suit (« Lest (facultatif) »).
- **Il te reste…** (Nutrition, jour en cours, si tes objectifs sont réglés) : calories et protéines restantes, avec 4 idées parmi tes aliments les plus protéinés qui rentrent dans les calories restantes (portion réduite si besoin). Si tu n'as encore rien noté de protéiné : classiques de la mini-base (skyr, poulet, dinde, thon…). Un appui pré-remplit le formulaire.
- **Nutri-Score et NOVA** au scan d'un produit (Open Food Facts) : affichés sous le formulaire, gardés sur l'entrée (badges dans le journal) et dans l'export pour le coach.

## Nouveautés de la version 3.2

**En salle**
- **Mode séance plein écran** (bouton dans « Nouvelle séance ») : un exercice à la fois, gros boutons + / −, charge et reps de la dernière fois proposées en gris. En rest-pause : « Échec → pause 20 s », puis « Complément fait → repos ». Sans rien toucher, deux appuis notent une série identique à la dernière fois. Passage tout seul à l'exercice suivant. Tout arrive dans le formulaire (brouillon compris) : on enregistre comme d'habitude. Si le téléphone ferme l'app, le mode séance revient au même exercice.
- **Minuteur** : boutons « Pause RP » (durée du programme, 20 s par défaut) et « Repos » sur chaque exercice, +15 s, barre de progression. L'écran reste allumé pendant le décompte ; fin = vibration + 3 bips. Le décompte continue si l'app est fermée puis rouverte. Option automatique : pause RP après les reps avant l'échec, repos après le complément.

**Nutrition**
- **Repas habituels** : « ★ Habituel » à côté d'un repas du jour l'enregistre (nom, moment, aliments) ; ensuite un appui dans « Ajout rapide » l'ajoute au jour affiché. « Gérer » pour renommer, retirer un aliment ou supprimer.
- **Comme hier** : copie en un appui le petit-déjeuner, le déjeuner… ou toute la journée de la veille. Chaque ajout rapide peut être annulé depuis le message.
- **Recettes maison** : ingrédients pesés crus (Ciqual, tes aliments, code-barres ou saisie à la main) + poids du plat cuit → valeurs pour 100 g. La recette sort ensuite en premier dans la recherche d'aliments : tu pèses ta portion, les calories suivent.
- Repas habituels et recettes sont sauvegardés et synchronisés comme le reste.

## Nouveautés de la version 3.1

**Synchronisation automatique téléphone ↔ PC (gratuite, facultative)**
- Passe par ton propre projet Firebase (offre gratuite « Spark », sans carte bancaire). Personne d'autre n'y a accès.
- Chaque saisie part toute seule quelques secondes après (et dès que le réseau revient). L'autre appareil la reçoit à l'ouverture, au retour sur l'app, ou avec « Synchroniser maintenant ».
- Hors connexion, tout fonctionne comme avant : les changements attendent le réseau.
- Deux modifications de la même entrée : la plus récente gagne. Une suppression est transmise.
- Synchronisés : séances, repas, mesures, check-ins, batteries de tests, programme, objectifs. Non synchronisés : les photos (elles restent sur l'appareil où tu les prends).
- Le mot de passe n'est jamais enregistré ; seule une clé de session l'est. « Déconnecter » n'efface rien.
- Réglages → Synchronisation : coller le bloc `firebaseConfig`, l'e-mail et le mot de passe du compte, sur chaque appareil.

**Base d'aliments**
- Table Ciqual 2025 de l'Anses : 3 341 aliments génériques (valeurs pour 100 g), cherchés en tapant le nom, même hors connexion. Chaque mot tapé doit commencer un mot de l'aliment : « riz cuit », « poulet roti », « yaourt nature ».
- Scan du code-barres des produits emballés : nom, calories et macros pour 100 g remplis depuis Open Food Facts (base collaborative gratuite, réseau nécessaire). Portion indiquée sur l'emballage reprise quand elle existe. Produits déjà scannés retrouvés hors connexion.
- La caméra est lue sur l'appareil, aucune image n'est envoyée ; seul le numéro du code part vers Open Food Facts. Sans caméra (ou si tu la refuses), tu peux taper le numéro.

## Nouveautés de la version 3 (alignement avec l'agent coach)

**Séances en rest-pause**
- Chaque série se note en deux nombres : reps avant l'échec, puis complément après la pause (case « RP »). Exemple : 70 × 8+7.
- Conseil de progression : quand la 1re série atteint 12 reps avant l'échec, l'app propose d'ajouter le palier. Seuil, reps visées (15) et pause (20 s) réglables par exercice dans Réglages ; méthode « Classique » toujours disponible.
- Reverse butterfly machine ajouté à la séance Pull ; charges de départ alignées sur la fiche du coach.
- Dans la séance : pesée avant l'entraînement (enregistrée comme mesure « Soir, avant séance »), vélo d'échauffement chronométré (temps, distance, difficulté) et marche du retour.

**Nouvelles saisies**
- Alcool (type « Alcool » dans Nutrition) : volume, degré, verres standard calculés, calories comptées dans le total du jour. Boissons prédéfinies : triple, blonde, vin, spiritueux.
- Batterie de tests (onglet Progrès) : les 6 tests du coach, comparés à la référence et au test précédent.
- Check-in : qualité du sommeil (1 à 5) et douleur au genou gauche avant / pendant / le lendemain.

**Envoi vers l'agent coach (accueil, panneau « Coach »)**
- « Copier le récap du jour » : texte au format de la saisie rapide, à coller chaque soir dans la conversation de la semaine.
- « Exporter la période » : fichier JSON (schéma 2) pour la semaine ou le mois, à joindre à la conversation. Une donnée absente est omise, jamais remplacée par zéro.

Tes données de la version 2 sont reprises telles quelles ; ton programme passe en rest-pause et reçoit le Reverse butterfly une seule fois.

## Version 2

**Entraînement**
- Les charges de ta dernière séance sont reprises automatiquement ; la série précédente est rappelée sur chaque ligne (« préc. 70 × 10 »).
- Conseil de progression : quand toutes tes séries atteignent les reps max, l'app propose d'ajouter le palier (bouton « Appliquer »).
- Records détectés (meilleur 1RM estimé ou charge la plus lourde) et signalés dans l'historique.
- Historique détaillé : chaque exercice avec charges × répétitions, volume, durée, notes. Modification possible.
- Programme modifiable dans Réglages (séances, exercices, séries, fourchette de reps, palier, charges de départ). Séance libre avec exercices personnalisés.
- Brouillon automatique : une séance en cours survit à la fermeture de l'application.
- Minuteur de repos (avec vibration), lancement automatique possible après chaque série.
- Courbe de progression par exercice (onglet Progrès).

**Nutrition**
- Objectifs (kcal, protéines, glucides, lipides, fibres) et « reste à manger » du jour.
- Navigation par jour : tous les repas passés sont visibles, modifiables et supprimables.
- Calcul automatique selon les grammes ; aliments déjà mangés proposés en premier ; bouton « Répéter ».
- Recherche sans accents ; mini-base de 40 aliments courants (valeurs indicatives).
- Photos réduites à environ 200 à 400 Ko, sans données de localisation, rangées à part.

**Poids et forme**
- Moyenne sur 7 jours, rythme par semaine, poids cible, courbe sur 30 j / 90 j / 1 an / tout.
- Évolution des mensurations, moyennes de récupération sur 7 jours.

**Bilan et Claude**
- Bilan sur 7, 14 ou 30 jours à l'accueil, et bouton « Copier pour Claude » : un résumé complet à coller dans un projet Claude « Coach », sans API ni frais.

**Fiabilité (corrections de l'audit)**
- Import vérifié entrée par entrée ; mode « Fusionner » ; copie de sécurité téléchargée avant un remplacement.
- Mises à jour : un bandeau « Nouvelle version disponible » apparaît, un clic suffit.
- Rappel de sauvegarde après 7 jours ; partage de la sauvegarde vers Google Drive (Android) ; sauvegarde automatique dans un dossier (PC).
- Rappel du soir compatible Android ; stockage protégé demandé au navigateur ; politique de sécurité qui bloque tout script étranger.

## Passer à la version 3 (depuis la version 1 ou 2)

1. Dans ta version actuelle, fais d'abord un export JSON (par précaution).
2. Remplace les fichiers de l'application **à la même adresse** par ceux de ce dossier.
3. Ferme complètement l'application (y compris depuis les applications récentes), puis rouvre-la.
4. Tes données sont reprises automatiquement (les photos sont déplacées, rien n'est supprimé).

Si tu changes d'adresse (autre hébergeur, autre port), les données ne suivent pas : exporte depuis l'ancienne adresse puis importe sur la nouvelle.

## Essayer sur Windows

- **Le plus simple :** double-clic sur `index.html`. L'application fonctionne, mais sans mode hors ligne, et ses données sont séparées de la version hébergée.
- **Avec Python :** ouvrir PowerShell dans ce dossier, lancer `py -m http.server 8000`, puis ouvrir `http://localhost:8000` dans Edge ou Chrome.

## Installer sur Android (gratuit)

L'installation exige une adresse HTTPS. Deux hébergements gratuits conviennent :
- **GitHub Pages** (dépôt public obligatoire en compte gratuit : le code est public, tes données non) ;
- **Cloudflare Pages** (dépôt public ou privé).

Ensuite : ouvrir l'adresse dans Chrome Android → menu ⋮ → « Installer l'application ». Un appui long sur l'icône donne des raccourcis (Séance, Repas, Poids).

**Ne mets jamais un fichier de sauvegarde dans le dépôt** : il contient tes données de santé en clair (le fichier `.gitignore` les exclut).

## Sauvegardes

- **Android :** Réglages → « Partager la sauvegarde » → Google Drive.
- **PC (Chrome, Edge) :** Réglages → « Sauvegarde automatique dans un dossier » → choisir un dossier OneDrive ou Google Drive. La copie est refaite à chaque ouverture (au plus une fois par jour) tant que le navigateur garde l'autorisation.
- **Restaurer / transférer :** Réglages → Importer, mode « Fusionner » (recommandé) ou « Remplacer ».

## Structure des fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Les écrans |
| `styles.css` | L'apparence |
| `sw.js` | Le mode hors ligne et les mises à jour |
| `utils.js` | Outils : dates, nombres, messages |
| `daytargets.js` | Objectifs selon la journée (complet / semi / sans sport) |
| `data.js` | Programme et aliments par défaut, contrôle des imports |
| `db.js` | La base de données locale et sa migration |
| `charts.js` | Les graphiques |
| `session.js` | Mode séance plein écran |
| `exercises.js` | Bibliothèque d'exercices du haut du corps et cardio |
| `generator.js` | Générateur de séance, remplacement, plateaux, renommer/fusionner, programme du coach |
| `training.js` | Séances, progression, records, minuteur |
| `nutrition.js` | Repas, objectifs, photos, recherche d'aliments |
| `scan.js` | Scan du code-barres et recherche Open Food Facts |
| `quickmeals.js` | « Il te reste… », repas habituels, « Comme hier », repas repérés, « Il manque… » |
| `foodtools.js` | Portions sans balance, cru / cuit, lecture de la saisie express |
| `express.js` | Fenêtre de saisie express |
| `recipes.js` | Recettes maison |
| `ciqual.json` | Table Ciqual 2025 (Anses), version compacte pour la recherche hors connexion |
| `body.js` | Poids et mensurations |
| `battery.js` | Batterie de tests (toutes les 4 semaines) |
| `wellbeing.js` | Récupération |
| `dashboard.js` | Accueil, bilan, « Copier pour Claude » |
| `coach.js` | Récap du jour et export JSON pour l'agent coach |
| `backup.js` | Exports, imports, stockage |
| `settings.js` | Objectifs, programme, rappel |
| `sync.js` | Synchronisation entre appareils (Firebase) |
| `cloudbackup.js` | Copies de sécurité hebdomadaires dans Firebase (8 gardées) |
| `menu.js` | Menu de la suite de la journée |
| `run.js` | Course : plan de reprise, journal, import GPX |
| `runtimer.js` | Minuteur de course guidé (écran noir, bips, vibrations) |
| `strava.js` | Import automatique des courses depuis Strava |
| `coachsheet.js` | Fiche « État actuel » du projet coach, mise à jour avec tes chiffres |
| `app.js` | Démarrage et navigation |
| `test_app.py` | Tests automatiques de l'application (79 vérifications) |
| `test_sync.py` | Tests de la synchronisation et des copies de sécurité, avec un faux Firebase (39 vérifications) |
| `test_coach_sheet.py` | Tests de la version 3.6 : fiche « État actuel » (23 vérifications) |
| `test_seance_objectifs.py` | Tests de la version 3.8 : pauses RP multiples, écran noir, bips, objectifs selon la journée (44 vérifications) |
| `test_run.py` | Tests de la version 3.7 : plan de reprise, minuteur, journal, GPX, partage, Strava simulé, export (63 vérifications) |
| `test_scan.py` | Tests de la base d'aliments et du scan, caméra simulée (40 vérifications, nécessite ffmpeg) |
| `test_training.py` | Tests de la version 3.5 : générateur, remplacement, plateaux, progression auto, fusion, programme du coach (27 vérifications) |
| `test_nutrition.py` | Tests des versions 3.4 et 3.6 : fréquents, portions, cru / cuit, saisie express, repas repérés, trous, menu de la journée (43 vérifications) |
| `test_features.py` | Tests des versions 3.2 et 3.3 : minuteur, mode séance, repas habituels, recettes, poids du corps, « Il te reste », Nutri-Score (75 vérifications) |
| `CLAUDE.md` | Règles à suivre pour faire évoluer l'application avec Claude Code |

## Limites

- La synchronisation demande un projet Firebase (gratuit) ; sans lui, export puis import « Fusionner ». Les photos ne sont pas synchronisées.
- Le scan du code-barres a besoin du réseau la première fois pour chaque produit ; un produit absent d'Open Food Facts se saisit à la main.
- Firebase gratuit : 50 000 lectures et 20 000 écritures par jour, très au-dessus d'un usage personnel. Au-delà, la synchro s'arrête jusqu'au lendemain (jamais de facture : l'offre Spark n'a pas de carte bancaire).
- Le rappel du soir n'est vérifié que si l'application est ouverte ; une alarme du téléphone est plus sûre.
- Course, écran verrouillé : sans le « Mode écran éteint », Android peut couper les bips quand l'écran s'éteint ; avec lui, ta musique peut se mettre en pause (selon le téléphone). La vibration ne marche qu'écran allumé.
- Strava : l'app appelle Strava directement depuis le téléphone ; si Strava bloque ce type d'appel, passe par l'export GPX.
- Ciqual et la mini-base donnent des valeurs moyennes ; l'étiquette du produit fait foi.

## Sources des données d'aliments

- **Table Ciqual** : Anses, Table de composition nutritionnelle des aliments Ciqual 2025 (version du 03/11/2025), données publiques ouvertes. Fichier converti à partir de la copie publiée dans le dépôt d'Open Food Facts ; seuls l'énergie (kcal, règlement UE 1169/2011), les protéines, glucides, lipides et fibres sont gardés. « traces » = 0, « < x » = x/2.
- **Open Food Facts** : base collaborative libre (licence ODbL), interrogée produit par produit.
- Pas de conseil médical ni de diagnostic.
