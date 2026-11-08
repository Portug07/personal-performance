# Personal Performance — version 3.3

Application personnelle de suivi sportif et nutritionnel. Interface en français, pensée pour le téléphone, sans abonnement, sans API payante et sans serveur à payer. Les données restent sur l'appareil ; la synchronisation entre appareils est facultative et passe par ton propre projet Firebase gratuit.

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
| `data.js` | Programme et aliments par défaut, contrôle des imports |
| `db.js` | La base de données locale et sa migration |
| `charts.js` | Les graphiques |
| `session.js` | Mode séance plein écran |
| `training.js` | Séances, progression, records, minuteur |
| `nutrition.js` | Repas, objectifs, photos, recherche d'aliments |
| `scan.js` | Scan du code-barres et recherche Open Food Facts |
| `quickmeals.js` | « Il te reste… », repas habituels et « Comme hier » |
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
| `app.js` | Démarrage et navigation |
| `test_app.py` | Tests automatiques de l'application (77 vérifications) |
| `test_sync.py` | Tests de la synchronisation, avec un faux Firebase (32 vérifications) |
| `test_scan.py` | Tests de la base d'aliments et du scan, caméra simulée (40 vérifications, nécessite ffmpeg) |
| `test_features.py` | Tests des versions 3.2 et 3.3 : minuteur, mode séance, repas habituels, recettes, poids du corps, « Il te reste », Nutri-Score (72 vérifications) |
| `CLAUDE.md` | Règles à suivre pour faire évoluer l'application avec Claude Code |

## Limites

- La synchronisation demande un projet Firebase (gratuit) ; sans lui, export puis import « Fusionner ». Les photos ne sont pas synchronisées.
- Le scan du code-barres a besoin du réseau la première fois pour chaque produit ; un produit absent d'Open Food Facts se saisit à la main.
- Firebase gratuit : 50 000 lectures et 20 000 écritures par jour, très au-dessus d'un usage personnel. Au-delà, la synchro s'arrête jusqu'au lendemain (jamais de facture : l'offre Spark n'a pas de carte bancaire).
- Le rappel du soir n'est vérifié que si l'application est ouverte ; une alarme du téléphone est plus sûre.
- Ciqual et la mini-base donnent des valeurs moyennes ; l'étiquette du produit fait foi.

## Sources des données d'aliments

- **Table Ciqual** : Anses, Table de composition nutritionnelle des aliments Ciqual 2025 (version du 03/11/2025), données publiques ouvertes. Fichier converti à partir de la copie publiée dans le dépôt d'Open Food Facts ; seuls l'énergie (kcal, règlement UE 1169/2011), les protéines, glucides, lipides et fibres sont gardés. « traces » = 0, « < x » = x/2.
- **Open Food Facts** : base collaborative libre (licence ODbL), interrogée produit par produit.
- Pas de conseil médical ni de diagnostic.
