# Greffon « inventaire » : le sac, les indices et le mode triche

Le sac à dos de la Feuille d'Aventure devient une **fenêtre de sac**, à la manière des jeux d'aventure : des
onglets, une grille de cases, et pour chaque objet sa **fiche** (grande icône, description, indice). Le livre
peut aussi **tenir la feuille** : le joueur ne s'ajoute plus d'objets lui-même, sauf s'il passe sa partie en
**mode triche**, un choix délibéré qui débloque tout mais ne compte plus.

Une aventure sans réglage garde son sac habituel : un seul onglet « Objets », et la feuille libre.

## Pour le joueur

- **Ouvrir le sac** : la touche **I**, la bande du sac dans la Feuille d'Aventure (les dix premiers objets en
  petites cases, puis « Ouvrir »), ou, sur téléphone, le bouton **Sac** à côté de « Feuille ».
- **Onglets** : les catégories d'objets (Objets, La quête…), puis les **collections**, puis les onglets
  ajoutés par d'autres greffons (la **Carte** du monde, le **Carnet** de notes de la partie).
- **Une collection** montre toutes ses cases, trouvées ou non (« ? » pour une case vide, avec son numéro), et
  le compte (« 8/33 »). Si elle porte un **message**, chaque objet trouvé dévoile une lettre.
- **La fiche** d'un objet : description, bouton **« Un indice : à quoi peut-il servir ? »** (l'indice dépend
  du mode de jeu : plus direct pour les petits, plus allusif pour les grands), et les actions de l'objet
  (Utiliser, Boire…).
- **Nouveau** : un objet reçu depuis la dernière ouverture du sac porte le mot « Nouveau » ; le bouton Sac et
  la bande de la feuille en donnent le nombre.
- Au clavier : flèches pour aller de case en case, Entrée pour la fiche, Échap pour fermer.

## La feuille tenue par le livre, et le mode triche

Avec `"sheet": { "locked": true }`, c'est l'aventure qui donne et qui prend : ni « Ajouter » ni « Retirer »
dans la feuille ou dans le sac. Avec `"cheat": true`, un volet **Mode triche** (replié, en bas du sac) propose
de passer la partie en triche, après confirmation :

- c'est **définitif pour la partie** ; un badge 🃏 l'indique dans la lecture et dans la feuille ;
- le joueur peut alors ajouter et retirer des objets, et **Tout débloquer** : tous les objets de l'aventure
  (un exemplaire), les marques et les compagnons transportés par la campagne, plus l'or et les compteurs
  prévus par `unlock` ;
- la partie compte comme une **partie de test** pour les succès : rien n'est enregistré ;
- dans une campagne qui déclare `cheatFlag`, le **passeport** porte cette marque : le livre suivant repart en
  mode triche (voir [campagne.md](campagne.md)).

Le mode test de l'auteur (`?test=1`) reste un outil d'auteur : il ne délivre pas de passeport.

## Pour l'auteur

- **Onglet Objets**, volet « Dans le sac » de chaque objet : *Onglet du sac* (catégorie), *Étiquette* (un
  texte très court affiché sur la case, par exemple une lettre), *Indice* (général) et un indice par mode.
- **Onglet Règles → Feuille et sac** : *Feuille tenue par le livre*, *Permettre le mode triche*, l'or donné
  par « Tout débloquer », et la liste des problèmes de réglage (message trop long ou trop court, catégorie
  inconnue).

Les catégories, les collections et les compteurs de « Tout débloquer » s'écrivent dans le fichier.

## Format JSON

```jsonc
{
  "items": {
    "lanterne": {
      "name": "Lanterne", "icon": "🏮", "description": "…",
      "category": "objets",                      // onglet du sac (absent : le premier)
      "hint": "Elle éclaire les grottes.",        // indice général
      "hints": { "petit": "…", "gardien": "…" }  // indice par mode (sinon l'indice général)
    },
    "piece-01": { "name": "Pièce n° 1", "icon": "🪙", "tag": "L" }   // tag : texte très court sur la case
  },
  "rules": {
    "inventory": {
      "categories": [
        { "id": "objets", "label": "Objets", "icon": "🎒" },
        { "id": "quete", "label": "La quête", "icon": "📜" }
      ],
      "collections": [
        { "id": "pieces", "label": "Pièces", "icon": "🪙",
          "items": ["piece-01", "piece-02", "piece-03"],
          "message": "LE…" }                      // une lettre par objet, dans l'ordre ; espaces et ponctuation libres
      ]
    },
    "sheet": {
      "locked": true,                             // pas d'ajout ni de retrait par le joueur
      "cheat": true,                              // mode triche proposé
      "unlock": { "gold": 50, "counters": { "memoire": 50 } }
    }
  }
}
```

- Un objet d'une collection n'apparaît que dans sa collection.
- Le message doit avoir **autant de lettres** que la collection a d'objets (les lettres accentuées comptent ;
  espaces, apostrophes et ponctuation ne comptent pas).
- État de la partie : `state.cheat = null | { turn, unlocked, passport? }`, `state.seenItems = { id: true }`.

## Pour les greffons

`js/ui/registry.js` :

- `registerInventory(Composant)` : la fenêtre du sac (celle de ce greffon) ;
  `Composant({ adv, source, state, update, tab, onClose })`.
- `registerInventoryTab({ id, order, label, icon, show?(adv, state), Tab({ adv, source, state, update }) })` :
  un onglet de plus dans le sac. Le greffon carte y met la carte du monde (`order: 80`), ce greffon le
  Carnet (`order: 90`).

Moteur pur (`core.js`, testé dans `tests/inventaire.test.mjs`) : `inventoryView`, `hintFor`, `canEditItems`,
`startCheat`, `unlockAll`, `newItems`, `markSeen`, `messageOf`, `inventoryProblems`.
