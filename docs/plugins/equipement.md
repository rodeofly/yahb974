# Greffon « Équipement » : objets portés et sac à dos

Dans *Sorcellerie !* ou *Loup Solitaire*, le héros ne se bat pas avec tout son sac : il **porte** une arme,
une armure, un bouclier… et son sac à dos ne contient qu'un nombre limité d'objets. Ce greffon ajoute ces deux règles :

- **des emplacements** (Arme, Armure, Bouclier, Bijou par défaut, modifiables) : chaque objet peut se porter
  dans un emplacement et donner des bonus de combat ;
- **une capacité de sac** : au-delà, le joueur doit abandonner un objet avant de continuer ;
- **un malus sans arme** (règle de *Sorcellerie !* : −4 à la Force d'Attaque quand on se bat à mains nues).

Tant que l'équipement n'est pas activé dans les Règles, rien ne change : une aventure existante se joue exactement comme avant.

## Dans l'éditeur

### Onglet Règles → « Équipement et sac à dos »

1. Cochez **Activer l'équipement porté et la capacité du sac**.
2. **Emplacements** : renommez-les, réordonnez-les, supprimez-les ou ajoutez-en (Ceinture, Casque, Monture…).
   L'identifiant (`arme`, `ceinture`…) est fixé à la création : c'est lui que retiennent les objets et les conditions.
3. **Capacité du sac** : nombre d'objets que le sac peut contenir (`0` = illimité). Les objets portés et les
   *petits objets* ne comptent pas ; les quantités comptent (3 pierres = 3 places).
4. **Emplacement de l'arme** et **Malus de Force d'Attaque sans arme** : si cet emplacement est vide pendant un
   combat, le héros perd ce nombre de points de Force d'Attaque (mettez `4` pour la règle de *Sorcellerie !*).

### Onglet Objets → encadré « Équipement »

| Champ | Effet |
|---|---|
| Se porte à l'emplacement | l'objet peut être porté (sinon il reste un simple objet du sac) |
| Force d'Attaque (+/−) | ajouté à la Force d'Attaque du héros à chaque assaut (négatif possible : armure lourde) |
| Dégâts infligés (+/−) | ajouté aux dégâts que le héros inflige (jamais moins de 1) |
| Armure | retiré des dégâts que le héros subit (jamais moins de 1) |
| Petit objet | ne prend pas de place dans le sac (clé, bague, pièce…) |

Les bonus ne comptent **que si l'objet est porté**.

### Effets (listes « Effets » des paragraphes, des choix et des objets)

- **Équiper un objet** : le héros porte cet objet s'il l'a dans son sac ; l'objet qui occupait l'emplacement retourne dans le sac.
- **Ranger ou perdre l'objet porté** : vide un emplacement. Cochez *Le héros perd l'objet* pour le retirer de
  l'inventaire (« Le garde confisque votre arme », « Votre bouclier se brise ») : vous n'avez pas besoin de savoir
  *quelle* arme le héros portait.

### Conditions (« Le héros… »)

- **porte l'objet** / **ne porte pas l'objet** : l'objet est dans un emplacement (l'avoir dans le sac ne suffit pas) ;
- **porte quelque chose à l'emplacement** / **n'a rien à l'emplacement** : « Si vous êtes sans arme, rendez-vous au 212 ».

L'onglet **Vérifier** signale un objet sans emplacement utilisé dans « Équiper », un emplacement inconnu,
ou ces effets et conditions quand l'équipement est désactivé.

## Pendant la partie

- **Création du héros** : une ligne indique l'équipement de départ et la taille du sac.
- **Équipement automatique** : un objet reçu (effet, boutique, objet utilisé, objets de départ) va de lui-même dans
  son emplacement **s'il est libre** ; un message l'annonce (« Vous vous équipez : Épée fine (Arme) »).
  Un objet que le joueur a rangé n'est jamais rééquipé tout seul.
- **Feuille d'Aventure** : le panneau *Équipement* montre chaque emplacement (objet porté ou « — », cadre en tirets
  s'il est vide), les bonus en toutes lettres, le total en combat et la place dans le sac (« 4 / 6 places »,
  une case par place, les cases en trop hachurées).
- À côté des objets du sac : **Équiper**, **Ranger** (l'objet porté retourne dans le sac) et, si le sac est limité,
  **Abandonner**. Un objet abandonné peut être **repris** tant que le héros n'a pas quitté le paragraphe.
- **Sac trop plein** : tous les choix du paragraphe sont bloqués avec la raison
  « Votre sac est trop plein : abandonnez un objet depuis votre Feuille d'Aventure. ».
- **Combat** : un encadré détaille les bonus (« Épée fine : +1 Force d'Attaque, +1 dégât infligé »,
  « Sans arme : −4 Force d'Attaque »). Changer d'arme pendant un combat compte dès l'assaut suivant.
- Un objet porté qui disparaît de l'inventaire (effet « retirer », objet utilisé…) libère son emplacement.

## Version imprimable

- **Règles** : un chapitre « L'équipement » explique les cases, les bonus, le malus sans arme et la capacité du sac,
  suivi du tableau des objets à porter (case et effet).
- **Feuille d'Aventure** : une case par emplacement (« OBJETS PORTÉS ») et, si le sac est limité, autant de lignes numérotées que de places.
- Les effets et conditions sont réécrits en phrases de livre : « Si vous possédez : Épée fine, portez cet objet : inscrivez-le
  dans la case « Arme » de votre Feuille d'Aventure… », « Si la case « Arme » de votre Feuille d'Aventure est vide… ».

## Format JSON

```jsonc
{
  "rules": {
    "equipment": {
      "enabled": true,
      "slots": [ { "id": "arme", "label": "Arme" }, { "id": "armure", "label": "Armure" },
                 { "id": "bouclier", "label": "Bouclier" }, { "id": "bijou", "label": "Bijou" } ],
      "capacity": 6,          // 0 = illimité
      "unarmedPenalty": 4,    // points de Force d'Attaque retirés sans arme (0 = aucun)
      "weaponSlot": "arme"    // emplacement vérifié pour le malus sans arme ("" = aucun)
    },
    "startItems": ["epee", "cotte"]
  },
  "items": {
    "epee":   { "name": "Épée fine", "slot": "arme", "attack": 1, "damage": 1 },
    "cotte":  { "name": "Cotte de mailles", "slot": "armure", "armor": 1, "attack": -1 },
    "anneau": { "name": "Anneau de vision", "slot": "bijou", "small": true },
    "cle":    { "name": "Clé de bronze", "small": true }
  }
}
```

Tous ces champs sont facultatifs : à l'ouverture, une aventure reçoit `rules.equipment` avec les valeurs par défaut
(`enabled: false`, les quatre emplacements ci-dessus, `capacity: 0`, `unarmedPenalty: 0`, `weaponSlot: "arme"`),
sans écraser ce qui existe.

**Effets**

```jsonc
{ "op": "equip", "item": "epee" }                     // porter l'objet (s'il est dans le sac)
{ "op": "unequip", "slot": "arme" }                   // ranger l'objet porté dans le sac
{ "op": "unequip", "slot": "arme", "take": true }     // le héros perd l'objet porté
```

**Conditions** (combinables avec `all`, `any`, `not` comme les autres)

```jsonc
{ "equipped": "epee" }                                // porte l'Épée fine
{ "equipped": "epee", "negate": true }                // ne la porte pas
{ "equippedSlot": "arme" }                            // porte quelque chose en Arme
{ "equippedSlot": "arme", "negate": true }            // n'a pas d'arme en main
```

### Exemple : l'armurerie

```jsonc
"12": {
  "text": "Le vieux Hadrien vous tend une épée fine. « Laissez-moi ce bout de ferraille », dit-il en montrant votre dague.",
  "choices": [
    { "text": "Échanger votre dague contre l'épée", "to": "45",
      "effects": [ { "op": "give", "item": "epee" }, { "op": "equip", "item": "epee" }, { "op": "take", "item": "dague" } ] },
    { "text": "Refuser poliment", "to": "45" },
    { "text": "Lui montrer que vous n'avez pas d'arme", "to": "88", "if": { "equippedSlot": "arme", "negate": true } }
  ]
}
```

### État d'une partie (pour les autres greffons)

- `state.equipped = { "arme": "epee", "armure": "cotte" }` : objets portés (ils restent aussi dans `state.inventory`) ;
- `state.equipement = { "seen": { … }, "dropped": { … } }` : inventaire lors de la dernière synchronisation
  (sert à repérer les objets nouvellement reçus) et objets abandonnés dans le paragraphe en cours.

Le moteur (`js/plugins/equipement/core.js`) exporte des fonctions pures qui renvoient `{ state, messages }` :
`equip(state, adv, itemId)`, `unequip(state, adv, slotId)`, `drop(state, adv, itemId)`, `pickUp(state, adv, itemId)`,
ainsi que `equippedOf(state, adv)`, `bagOf(state, adv)` (`{ load, capacity, over }`) et `bonuses(state, adv)`.

## Comment fonctionne l'équipement automatique

L'effet `give` du moteur n'est pas modifié. Le greffon calcule une **vue** de l'équipement : les emplacements
enregistrés dont l'objet est toujours dans le sac, plus les objets reçus depuis la dernière synchronisation
(comparaison avec `state.equipement.seen`) quand leur emplacement est libre. Combat, conditions, capacité et
Feuille d'Aventure lisent cette vue : elle est juste même juste après un achat en boutique. L'état est ensuite
écrit (« synchronisé ») à chaque entrée dans un paragraphe, par les effets `equip` / `unequip` et par les actions
du joueur. Ainsi un objet rangé volontairement n'est jamais rééquipé, et un objet perdu libère sa case partout.

**Limite connue** : comme tous les blocages de choix, un sac trop plein bloque les **choix** du paragraphe,
pas les boutons « Continuer » qui suivent un test, une table de dés ou un combat.
