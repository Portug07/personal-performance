# Spec export — Personal Performance

Objectif : que l'agent coach (projet Claude « Personal Performance ») puisse lire les données de l'app, sans API, sans serveur et sans abonnement. L'export est manuel, depuis le panneau « Coach » de l'accueil.

Les valeurs des exemples sont fictives.

## Les deux boutons

1. **« Copier le récap du jour »** : génère le texte ci-dessous pour le jour choisi et le copie dans le presse-papiers. Il se colle dans la conversation de la semaine du projet coach.
2. **« Exporter la période (JSON) »** : télécharge (ou partage, sur Android) un fichier `personal-performance_AAAA-MM-JJ_AAAA-MM-JJ.json`. Périodes : semaine en cours, semaine dernière (lundi → dimanche), 7 derniers jours, mois en cours, mois dernier.

Règles communes :

- Une donnée absente est omise, jamais remplacée par zéro : « non renseigné » n'est pas « zéro ». Un jour sans aucune saisie n'apparaît pas dans `jours`.
- Une série en rest-pause est notée en deux nombres : reps avant l'échec, puis complément après la pause (ex. 8 + 7). Une série classique n'a pas de complément.
- Les calories d'alcool sont comptées dans le total du jour, et données aussi à part.
- Échelles : ressenti (fatigue, stress, motivation) de 1 à 10 ; qualité du sommeil de 1 à 5 ; douleurs de 0 à 10.

## Récap du jour (texte)

Chaque ligne n'apparaît que si la donnée existe.

```text
JOUR 12/11
Poids : 80,5 kg (soir, avant séance)
Sommeil : 7 h · qualité 3/5
Fatigue 4/10 · Stress 3/10 · Motivation 7/10
Eau : 2,5 L
Repas : Déjeuner — Riz basmati 80 g (280 kcal), Poulet 150 g (248 kcal) ; Dîner — Skyr (1 pot) (90 kcal)
Alcool : Bière triple, 500 ml, 8,5 % (3,4 verres std, 330 kcal)
Totaux : 2 450 kcal (dont alcool 330) · P 180 g · G 230 g · L 70 g · fibres 28 g
Objectif du jour : journée complet · 2 500 kcal · P 180 g · G 290 g · L 75 g
Séance : Push (90 min)
- Chest press : 60 × 8+7+3, 60 × 7+8, 65 × 7+8, 65 × 6+9 (rest-pause, pause 20 s)
Cardio : vélo 5 km en 8:15 (difficulté 25) · marche 4,8 km
Course : étape 3 du plan (7 × (2 min de course + 2 min de marche)) terminée · 38:00 · 4,9 km · 7:45/km · effort 6/10 · genou pendant 1/10, après 2/10
Mesures : tour de taille 90 cm
Tests : Vélo 5 km (effort max) 8:10 · Chest press 8 RM 62,5 kg · Pompes (max) 25
Douleur genou : avant 3/10 · pendant 3/10 · lendemain 2,5/10
Remarques : bonne séance, sommeil court
```

Un jour sans saisie donne : `Aucune donnée saisie ce jour.`

## Export d'une période (JSON, schéma version 2)

```json
{
  "export": {
    "genere_le": "2026-11-16T21:00",
    "periode": { "debut": "2026-11-10", "fin": "2026-11-16" },
    "version_schema": 2,
    "application": "Personal Performance 3.0.0",
    "jours_periode": 7,
    "jours_renseignes": 6,
    "echelles": { "ressenti": "1 à 10", "sommeil_qualite": "1 à 5", "douleur": "0 à 10" }
  },
  "objectifs": { "kcal": 2500, "proteines_g": 180, "glucides_g": 275, "lipides_g": 75, "fibres_g": 30 },
  "jours": [
    {
      "date": "2026-11-12",
      "pesee": { "poids_kg": 80.5, "moment": "soir, avant séance" },
      "sommeil": { "heures": 7, "qualite_5": 3 },
      "ressenti_10": { "fatigue": 4, "stress": 3, "motivation": 7 },
      "eau_l": 2.5,
      "repas": [
        { "nom": "Déjeuner", "aliments": [
          { "nom": "Riz basmati", "quantite_g": 80, "kcal": 280, "proteines_g": 6, "glucides_g": 62, "lipides_g": 1, "fibres_g": 1 }
        ] }
      ],
      "alcool": [ { "type": "Bière triple", "volume_ml": 500, "degre": 8.5, "verres_standard": 3.4, "kcal": 330 } ],
      "totaux": { "kcal": 2450, "kcal_alcool": 330, "proteines_g": 180, "glucides_g": 230, "lipides_g": 70, "fibres_g": 28 },
      "seances": [
        {
          "type": "Push",
          "duree_min": 90,
          "exercices": [
            { "nom": "Chest press", "series": [
              { "charge_kg": 60, "reps": 8, "reps_rest_pause": 7, "pause_s": 20 },
              { "charge_kg": 65, "reps": 12 }
            ] }
          ],
          "notes": "bonne séance"
        }
      ],
      "cardio": [
        { "type": "velo", "distance_km": 5, "duree_s": 495, "niveau": 25 },
        { "type": "marche", "distance_km": 4.8 },
        { "type": "autre", "description": "Rameur 10 min" }
      ],
      "mesures": { "tour_de_taille_cm": 90 },
      "tests": {
        "velo_5km_s": 490,
        "chest_press_8rm_kg": 62.5,
        "tirage_horizontal_8rm_kg": 65,
        "pompes_max": 25,
        "planche_s": 60,
        "back_scratch_cm": { "droite": -5, "gauche": -10 }
      },
      "douleurs": [
        { "zone": "genou gauche", "avant": 3, "pendant": 3, "lendemain": 2.5 },
        { "zone": "autre", "niveau": 2 }
      ],
      "notes": "sommeil court"
    }
  ]
}
```

Champs possibles en plus :

- `alcool_declare_verres` : verres déclarés au check-in, seulement les jours sans entrée « Alcool » dans Nutrition.
- `seances[].exercices[].poids_du_corps: true` : exercice au poids du corps (pompes, tractions…). `charge_kg` y est alors le lest ajouté (absent = sans lest).
- `repas[].aliments[].nutriscore` (`"a"` à `"e"`) et `nova` (1 à 4) : produits scannés, d'après Open Food Facts.
- `mesures` : aussi `tour_de_ventre_cm`, `tour_de_poitrine_cm`, `tour_de_bras_cm`, `tour_de_cuisse_cm`.
- `tests.notes` : machine et réglages utilisés.
- `objectifs.poids_cible_kg`.
- Version 3.8, plusieurs pauses dans une série : `series[].reps_pauses_suivantes` (ex. `[3]` pour 8 + 7 + 3) ; `reps_rest_pause` reste le complément après la 1re pause.
- Version 3.8, objectifs selon la journée (quand ils sont réglés dans l'app) : `objectifs` devient `{ "fibres_g", "poids_cible_kg", "par_journee": { "complet": {kcal, proteines_g, glucides_g, lipides_g}, "semi": {…}, "sans_sport": {…} } }` et chaque jour porte `"type_journee": { "type": "complet" | "semi" | "sans_sport", "choisi": true (si choisi à la main, sinon absent = détecté), "objectif_kcal": 2500 }`. Détection : complet = musculation + vélo d'échauffement + marche du retour ; semi = autre séance ou course ; sans sport = rien. La ligne « Objectif du jour » du récap n'apparaît que dans ce cas.
- Un moment de la journée sans aliment n'apparaît pas dans `repas`, et un jour sans aucune saisie n'est pas dans `jours`.
- `courses` (version 3.7) : sorties de course du jour, de la plus ancienne à la plus récente :

```json
"courses": [
  {
    "heure": "18:05", "duree_min": 38, "temps_course_min": 14, "distance_km": 4.9, "allure_min_km": "7:45",
    "etape_plan": 3, "seance_plan": "7 × (2 min de course + 2 min de marche)", "terminee": true,
    "douleur_genou": { "pendant": 1, "apres": 2, "lendemain": 1 },
    "effort_10": 6, "denivele_m": 25, "fc_moyenne": 148, "source": "app", "notes": "sol souple"
  }
]
```

  `source` : `app` (minuteur guidé), `manuel`, `strava` ou `gpx`. `etape_plan`, `seance_plan` et `terminee` seulement pour les séances du plan de reprise (13 étapes, de 8 × (1 min + 2 min de marche) à 30 min continues). Règle de l'app : douleur la plus forte (pendant, après, lendemain) 0 à 2 → séance validée (2 validées = étape suivante) ; 3 à 5 → étape répétée ; plus de 5 → une étape plus bas. `nom` : titre de la sortie (Strava, GPX) quand ce n'est pas une séance du plan.


## Programme importé depuis le coach (version 3.5)

L'app sait installer un programme proposé par l'agent : Réglages → Programme → « Importer le programme du coach ». Le format attendu est décrit dans le gabarit « Gabarit-programme-pour-app.md » (bloc JSON `{"programme": {"seances": [{"nom", "exercices": [{"nom", "methode", "series", "cible_reps", "monter_a", "pause_s", "reps_min", "reps_max", "palier_kg", "charges_kg"}]}]}}`). L'ancien programme peut être remis en un appui juste après l'installation.

Séances générées par l'app : `type_seance` vaut « Séance générée · Push », « Séance générée · Pull » ou « Séance générée · Haut du corps ».
