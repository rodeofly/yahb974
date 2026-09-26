# Greffon « compagnons » : des alliés aux côtés du héros

Un compagnon est un personnage qui **voyage avec le héros** pendant une partie de l'aventure : une archère
rencontrée à l'auberge, un chien fidèle, un mercenaire payé pour trois jours… Il a sa propre HABILETÉ, sa propre
ENDURANCE et ses dégâts. Pendant les combats, **il frappe à son tour après chaque assaut du héros**, et il peut
être blessé, voire mourir.

Ce que voit le joueur :

- **Feuille d'Aventure** : une section « Compagnons » avec le portrait, le nom, l'HABILETÉ, l'ENDURANCE
  (en chiffres « 6 / 8 » et en barre), les dégâts, la description et un état écrit en toutes lettres
  (« Indemne », « Blessures légères », « Blessures graves »). Rien ne repose sur la couleur.
- **Messages** à l'arrivée sur un paragraphe : « Kaya se joint à vous. », « Kaya vous quitte. »,
  « Kaya récupère 3 points d'Endurance (8 / 8). », « Kaya succombe à ses blessures. ».
- **Combat** : sous l'assaut du héros, une ligne par compagnon (« Kaya frappe Gobelin : −2 (17 contre 12). »),
  puis un encadré « À vos côtés » avec l'état de chacun, le résultat de son dernier assaut et sa cible.
  Un compagnon tombé apparaît barré, en pointillés, avec la mention « Hors de combat ».
- **Fin de partie** : « À vos côtés jusqu'au bout : Kaya (6 / 8). »
- **Version imprimable** : un paragraphe « Vos compagnons » dans les règles, une case « Compagnons » dans la
  Feuille d'Aventure, et les effets écrits en phrases de livre (« Kaya se joint à vous : notez ce compagnon
  dans la case Compagnons de votre Feuille d'Aventure (HABILETÉ 9, ENDURANCE 8, dégâts 2). »).

Une aventure sans compagnons s'ouvre et se joue exactement comme avant.

## Dans l'éditeur

1. **Onglet « Compagnons »** : tapez un nom puis **Ajouter**. Pour chaque compagnon, réglez :
   - **Nom**, **Habileté**, **Endurance de départ** (son maximum : les soins ne le dépassent jamais),
     **Dégâts infligés** (par défaut ceux de la règle de combat, 2) ;
   - **Description** : une ou deux phrases, affichées sur la Feuille d'Aventure du joueur ;
   - **Portrait** : image redimensionnée et compressée automatiquement ; sans image, l'initiale du nom s'affiche.

   En bas de chaque fiche, « Utilisé dans l'aventure » liste les paragraphes où le compagnon arrive, part,
   est soigné, est blessé ou sert de condition ; un clic ouvre le paragraphe. Un avertissement apparaît si aucun
   paragraphe ne le fait arriver. Supprimer un compagnon encore cité est possible (après confirmation) :
   l'onglet **Vérifier** signale alors les effets et conditions orphelins.

2. **Faire arriver ou partir un compagnon** : dans un paragraphe, section « À l'arrivée sur ce paragraphe »
   (ou « Effets en choisissant » sous un choix), ajoutez un **Effet**, type **Compagnon**, puis choisissez :

   | Action | Effet | Nombre |
   |---|---|---|
   | se joint au héros | le compagnon rejoint le groupe | ENDURANCE à l'arrivée (vide = pleine) |
   | quitte le héros | il s'en va | — |
   | regagne de l'Endurance | soins, sans dépasser son maximum | points rendus (vide = tous) |
   | perd de l'Endurance | blessure hors combat ; à zéro, il meurt | points perdus (2 par défaut) |

   Un compagnon déjà présent ne se dédouble pas ; soigner, blesser ou renvoyer un compagnon absent ne fait rien.
   L'effet peut porter sa propre condition comme tous les effets (ex. « seulement si le héros est Rôdeur »).

3. **Conditions** (liste « Le héros… » d'un choix) :
   - **est accompagné de** Kaya : Kaya est présente et vivante ;
   - **n'est pas accompagné de** Kaya : elle n'est jamais venue, elle est partie ou elle est morte ;
   - **nombre de compagnons ≥** 2.

   Un choix indisponible est grisé avec sa raison (« Il faut être accompagné de Kaya. ») ou caché si vous
   cochez « Cacher ce choix ».

## Les combats

À chaque assaut, après l'échange du héros contre son adversaire, **chaque compagnon vivant attaque** :

1. sa cible est l'adversaire du héros s'il est encore debout, sinon le premier adversaire encore debout ;
2. Force d'Attaque du compagnon = 2 dés + son HABILETÉ ; celle de l'adversaire = 2 dés + son HABILETÉ
   (+ son bonus d'attaque éventuel) ;
3. si le compagnon l'emporte, l'adversaire perd les **dégâts du compagnon** ; si l'adversaire l'emporte,
   le compagnon perd les **dégâts de l'adversaire** ; en cas d'égalité, personne n'est touché ;
4. un compagnon qui tombe à 0 est **mort** : il quitte le groupe (« Brak tombe au combat. »).

Un adversaire vaincu par un compagnon compte comme une victoire du héros (renvoi « Si victoire »).
Si le héros tombe, ses compagnons ne frappent plus : le combat est perdu. La Chance du héros ne s'applique
qu'à ses propres assauts. Les dés passent par la graine de la partie : recharger ne change pas le résultat.
Le bouton « Estimer la difficulté » de l'éditeur calcule les chances du héros **seul**.

## Format JSON

```jsonc
{
  "companions": {
    "kaya": {
      "name": "Kaya",
      "skill": 9,          // HABILETÉ
      "health": 8,         // ENDURANCE de départ (maximum)
      "damage": 2,         // facultatif : dégâts infligés (défaut : rules.combat.damage, soit 2)
      "image": "images/compagnon-kaya-lx3.webp",   // facultatif : portrait
      "description": "Archère silencieuse de la forêt de Bébour."  // facultatif
    }
  }
}
```

**Effet** : `{ "op": "companion", "companion": "kaya", "action": "join" | "leave" | "heal" | "hurt", "amount": 3 }`
(`amount` facultatif : ENDURANCE à l'arrivée pour `join`, points rendus pour `heal` — absent = tout —,
points perdus pour `hurt` — absent = 2).

**Conditions** :
- `{ "companion": "kaya" }` — Kaya est présente et vivante ;
- `{ "not": { "companion": "kaya" } }` — elle ne l'est pas ;
- `{ "companions": true, "gte": 2 }` — au moins deux compagnons (aussi `lte`, `eq`) ; `{ "companions": 2 }`
  seul veut dire « au moins 2 ».

**État d'une partie** (sauvegardes) : `state.companions = [{ "id": "kaya", "health": 6, "max": 8 }]`, qui ne
contient que les compagnons présents et vivants. Pendant un combat, `state.combat.fallen` liste ceux qui
sont tombés et `state.combat.last.allies` détaille leur dernier assaut.

## Exemple

```json
{
  "companions": {
    "kaya": { "name": "Kaya", "skill": 9, "health": 8, "damage": 2, "description": "Archère silencieuse de la forêt de Bébour." }
  },
  "sections": {
    "12": {
      "text": "Au pied des tamarins, une archère vous observe. « La forêt est dangereuse seul. Je viens avec vous. »",
      "onEnter": [ { "op": "companion", "companion": "kaya", "action": "join" } ],
      "choices": [ { "text": "Entrer dans la forêt", "to": "13" } ]
    },
    "13": {
      "text": "Un gobelin surgit d'un fourré !",
      "blocks": [ { "type": "combat", "enemies": [ { "name": "Gobelin", "skill": 6, "health": 7 } ], "win": "14" } ]
    },
    "14": {
      "text": "Le chemin se divise.",
      "choices": [
        { "text": "Laisser Kaya vous guider par le sentier des crêtes", "to": "20", "if": { "companion": "kaya" } },
        { "text": "Prendre la route de la vallée", "to": "30" }
      ]
    },
    "20": {
      "text": "Au bout du sentier, Kaya vous salue : sa mission s'arrête ici.",
      "onEnter": [ { "op": "companion", "companion": "kaya", "action": "leave" } ],
      "choices": [ { "text": "Continuer seul", "to": "30" } ]
    }
  }
}
```
