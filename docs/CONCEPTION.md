# Livre-Héros : moteur d'aventures dont vous êtes le héros

Application web installable (PWA) pour **écrire**, **tester** et **jouer** des livres-jeux dans l'esprit
de *Défis Fantastiques* / *Sorcellerie !*. Aucun serveur applicatif, aucune base de données :
tout tourne dans le navigateur, fonctionne hors ligne, et une aventure se partage sous forme de fichier.

## 1. Tout ce qui peut devenir interactif

Légende : ✅ présent dans cette première version · 🔜 prévu, l'architecture le permet déjà.

### Côté joueur

| Domaine | Fonction | État |
|---|---|---|
| Création du héros | Tirage animé des caractéristiques (HABILETÉ, ENDURANCE, CHANCE, or…) selon les règles de l'aventure | ✅ |
| | Choix d'une classe (Guerrier / Sorcier) qui modifie les formules de tirage et l'équipement | ✅ |
| | Relancer le tirage, nommer son héros | ✅ |
| Lecture | Paragraphe avec illustration, texte mis en forme, numéro du paragraphe | ✅ |
| | Choix conditionnels : grisés avec la raison (« il vous faut la Clé d'argent »), ou cachés | ✅ |
| | Effets automatiques à l'entrée d'un paragraphe (perte d'ENDURANCE, objet trouvé, or…) avec notification | ✅ |
| | Effets déclenchés par un choix (payer 3 pièces d'or pour passer) | ✅ |
| Dés | Lanceur de dés animé (1d6, 2d6, formules « 2d6+3 ») toujours disponible | ✅ |
| | Tester sa Chance / son Habileté (la Chance baisse après chaque test) | ✅ |
| | Table de dés : « 1-2 → 245, 3-4 → 69, 5-6 → 99 » | ✅ |
| Combat | Simulation d'assauts : Force d'Attaque = 2d6 + HABILETÉ, 2 points de dégâts | ✅ |
| | Utiliser sa Chance pour augmenter / réduire les dégâts | ✅ |
| | Plusieurs adversaires, l'un après l'autre ou ensemble | ✅ |
| | Fuite (avec dégâts), modificateurs (arme, bonus/malus de Force d'Attaque), journal du combat | ✅ |
| | Mode automatique « jusqu'à la fin » ou assaut par assaut | ✅ |
| Feuille d'aventure | Caractéristiques actuelles / initiales, or, repas, objets, notes libres, mis à jour en direct | ✅ |
| | Manger un repas (+ENDURANCE, plafonné au niveau initial) | ✅ |
| | Utiliser un objet (potion : effet défini par l'auteur) | ✅ |
| Boutique | Acheter / vendre des objets contre de l'or | ✅ |
| Sauvegarde | Sauvegarde automatique, emplacements multiples, reprise | ✅ |
| | « Doigt dans la page » : revenir en arrière (optionnel, désactivable par l'auteur) | ✅ |
| Fins | Écran de mort / de victoire, statistiques de la partie, recommencer | ✅ |
| Carte | Carte des paragraphes visités, fins découvertes | ✅ |
| Magie | Formules à codes (ZAP, HOR…), coût, objet requis, classes autorisées, fausses formules, saisie de mémoire, livre des formules consultable | ✅ |
| Temps | Jours, obligation de manger chaque jour (pénalité le lendemain), repas offerts | ✅ |
| Ambiance | Effets sonores synthétisés, musique par paragraphe ou pour toute l'aventure, lecture à voix haute | ✅ |
| Accessibilité | Thème clair/sombre, taille du texte, texte justifié, formes plutôt que couleurs | ✅ |
| Succès | Trophées (toutes les fins, sans mourir…) | 🔜 |

### Côté auteur

| Domaine | Fonction | État |
|---|---|---|
| Écriture | Liste des paragraphes, éditeur de texte (Markdown léger), titre, lieu | ✅ |
| | Choix avec conditions et effets, sans code : listes déroulantes | ✅ |
| | Blocs interactifs : test, table de dés, combat, boutique | ✅ |
| | Fin de partie (mort / victoire) | ✅ |
| Images | Import d'une image par paragraphe, redimensionnée et compressée dans le navigateur (WebP) | ✅ |
| | Illustrations d'adversaires et d'objets | ✅ |
| Structure | Graphe de l'aventure : ressorts ou frise, par lieu ou par jour, chemin le plus court, passages obligés, épinglage | ✅ |
| | Vérification : liens cassés, paragraphes orphelins, impasses non marquées comme fin | ✅ |
| | Renumérotation aléatoire des paragraphes (comme dans les livres) | ✅ |
| Règles | Caractéristiques, formules de tirage, dégâts, classes, objets : tout est paramétrable | ✅ |
| Test | Jouer à partir de n'importe quel paragraphe, avec un héros de test | ✅ |
| Partage | Export / import d'un fichier `.lhz` (zip : `adventure.json` + images) | ✅ |
| | Publication : déposer le dossier de l'aventure dans `adventures/` du site | ✅ |
| | Impression / PDF façon livre (A4 ou A5, règles, Feuille d'Aventure, Livre des formules), numéros mélangés | ✅ |
| | Co-écriture : fusion de deux exports | 🔜 |

## 2. Architecture

```
Navigateur (hors ligne après la 1re visite)
├── index.html + service worker (sw.js)   ← cache de l'application et des aventures publiées
├── js/core/     moteur PUR (aucun accès au DOM) : dés, règles, effets, combat, validation
├── js/store/    persistance : IndexedDB (aventures, images, sauvegardes) + import/export zip
└── js/ui/       interface Preact + htm (sans étape de compilation)
                 bibliothèque · création du héros · lecture · combat · feuille · éditeur · graphe
```

### Pourquoi ces choix

- **Site statique, sans compilation.** Modules ES natifs, bibliothèques copiées dans `js/lib/`.
  On l'héberge n'importe où (GitHub Pages, Netlify, un NAS, une clé USB avec un petit serveur local).
  Pas de `npm install` pour contribuer : on édite un fichier, on recharge.
- **Pas de base de données.** Chaque navigateur garde ses données dans **IndexedDB** :
  - `adventures` : les aventures en cours d'écriture (JSON) ;
  - `assets` : les images, stockées en `Blob` (pas en base64, donc légères) ;
  - `saves` : les parties sauvegardées.
  On échange une aventure en exportant un fichier `.lhz` (un zip). C'est aussi la sauvegarde de sécurité.
- **PWA.** Le `manifest` rend l'application installable (téléphone, tablette, ordinateur).
  Le service worker met en cache l'application (stratégie « cache d'abord, mise à jour en arrière-plan »)
  et les aventures publiées au moment où on les ouvre.
- **Moteur séparé de l'interface.** `js/core` est testé en Node (`node --test tests/`).
  Le même moteur pourra servir plus tard à une version imprimable, un bot, ou une application mobile.
- **Dés reproductibles.** Le générateur aléatoire est « à graine » : une partie sauvegardée garde son état
  aléatoire, ce qui empêche de recharger pour relancer un dé (optionnel, choisi par l'auteur).

### Format d'une aventure (`adventure.json`)

```jsonc
{
  "format": "livre-heros/1",
  "id": "la-tour-de-brume",
  "meta": { "title": "La Tour de Brume", "author": "…", "cover": "images/cover.webp", "description": "…" },
  "rules": {
    "stats": [
      { "id": "habilete",  "label": "Habileté",  "roll": "1d6+6" },
      { "id": "endurance", "label": "Endurance", "roll": "2d6+12" },
      { "id": "chance",    "label": "Chance",    "roll": "1d6+6" }
    ],
    "classes": [ { "id": "guerrier", "label": "Guerrier", "rolls": {} },
                 { "id": "sorcier",  "label": "Sorcier",  "rolls": { "habilete": "1d6+4" } } ],
    "gold": "2d6", "provisions": 2, "meal": { "stat": "endurance", "heal": 4 },
    "combat": { "skill": "habilete", "health": "endurance", "damage": 2, "luck": "chance", "fleeDamage": 2 },
    "allowBack": true
  },
  "items": { "cle-argent": { "name": "Clé d'argent", "description": "Un 111 est gravé dessus." } },
  "start": "1",
  "sections": {
    "1": {
      "text": "Vous vous éveillez à l'aube…",
      "image": "images/1.webp",
      "onEnter": [ { "op": "stat", "stat": "endurance", "add": -2 } ],
      "blocks":  [ { "type": "combat", "enemies": [ { "name": "Gobelin", "skill": 7, "health": 6 } ], "win": "186", "flee": "120" } ],
      "choices": [ { "text": "Ouvrir la porte", "to": "44", "if": { "has": "cle-argent" }, "effects": [] } ],
      "ending": null
    }
  }
}
```

**Conditions** : `{has}`, `{flag}`, `{stat, gte|lte|eq}`, `{gold, gte}`, `{visited}`, `{class}`, combinées par `{all:[…]}`, `{any:[…]}`, `{not:…}`.
**Effets** : `stat` (add / set / `"initial"` / addInitial), `gold`, `provisions`, `give`, `take`, `flag`, `note`, `newDay`, `meal`.
**Conditions supplémentaires** : `{caster}`, `{ate}`, `{day, gte}`.
**Blocs** : `test` (caractéristique contre 2d6), `roll` (table de dés), `combat`, `shop`, `spells` (options `{code, to, cost?}`).
**Règles** : `spells: {enabled, stat, casters, typeCode, unknownCost, book: [{code, name, cost, requires, description}]}`, `time: {enabled, mealRequired, stat, penalty}`.
**Son** : `meta.sound` (ambiance générale), `sections[n].sound` + `soundLoop`.

### Publication d'une aventure

1. Dans l'éditeur : **Exporter** → `mon-aventure.lhz`.
2. Pour la partager à des joueurs : l'envoyer (ils font **Importer**), ou la publier sur le site :
   dézipper dans `adventures/mon-aventure/` et ajouter une ligne dans `adventures/index.json`.
