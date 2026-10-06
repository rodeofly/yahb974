# Greffon « objets »

Un bloc **Objets et effets (un clic)** : des boutons avec un emoji que le joueur presse au moment où le texte
le dit (« vous pouvez prendre la clé », « payez 3 Pièces d'Or », « vous perdez 2 points d'ENDURANCE »). Chaque
bouton applique des effets ordinaires (donner ou retirer un objet, or, repas, caractéristique, marque, note)
et se grise une fois fait. Les objets peuvent porter un **emoji** (onglet Objets, champ Emoji), affiché dans le
sac à dos et dans les boutons.

## Dans l'éditeur

- Bloc **Objets et effets** : un titre facultatif, puis des actions : emoji, libellé, effets (mêmes choix que les
  effets d'un choix), condition facultative (le bouton reste visible mais verrouillé, avec la raison), et
  « Une seule fois » (décoché pour un bouton réutilisable, par exemple boire à une source).
- Objets : le champ **Emoji** d'un objet apparaît dans le sac à dos du joueur.

## Dans le fichier

```json
{ "type": "actions", "label": "Sur la table", "actions": [
  { "label": "Prendre la clé", "icon": "🗝️", "effects": [ { "op": "give", "item": "cle" } ] },
  { "label": "Payer 3 pièces d’or", "icon": "💰", "effects": [ { "op": "gold", "add": -3 } ], "if": { "gold": true, "gte": 3 } },
  { "label": "Boire à la source", "icon": "💧", "effects": [ { "op": "stat", "stat": "endurance", "add": 2 } ], "once": false }
] }
```

Objet : `{ "name": "Clé", "icon": "🗝️", "description": "…" }`.

État pendant la visite du paragraphe : `state.blocks[i].done = { "0": true }` (remis à zéro en changeant de paragraphe,
comme les autres blocs). Le bloc n'a aucun renvoi : il n'apparaît pas dans le graphe.
