# Personal Performance — version 3

Application personnelle de suivi sportif et nutritionnel. Interface en français, pensée pour le téléphone, sans compte, sans API et sans serveur. Les données restent sur l'appareil.

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
| `js/utils.js` | Outils : dates, nombres, messages |
| `js/data.js` | Programme et aliments par défaut, contrôle des imports |
| `js/db.js` | La base de données locale et sa migration |
| `js/charts.js` | Les graphiques |
| `js/training.js` | Séances, progression, records, minuteur |
| `js/nutrition.js` | Repas, objectifs, photos |
| `js/body.js` | Poids et mensurations |
| `js/battery.js` | Batterie de tests (toutes les 4 semaines) |
| `js/wellbeing.js` | Récupération |
| `js/dashboard.js` | Accueil, bilan, « Copier pour Claude » |
| `js/coach.js` | Récap du jour et export JSON pour l'agent coach |
| `js/backup.js` | Exports, imports, stockage |
| `js/settings.js` | Objectifs, programme, rappel |
| `js/app.js` | Démarrage et navigation |
| `tests/test_app.py` | Tests automatiques (77 vérifications) |
| `CLAUDE.md` | Règles à suivre pour faire évoluer l'application avec Claude Code |

## Limites

- Pas de synchronisation automatique entre téléphone et PC (export puis import « Fusionner »).
- Le rappel du soir n'est vérifié que si l'application est ouverte ; une alarme du téléphone est plus sûre.
- La mini-base alimentaire est indicative ; l'étiquette du produit fait foi.
- Pas de conseil médical ni de diagnostic.
