# Greffon « campagne » : un héros qui passe d'un livre à l'autre

Une **campagne** enchaîne plusieurs aventures, comme les quatre livres de *Sorcellerie !* : le héros
gagne de l'or, des objets, des amis dans le livre 1, et les retrouve au livre 2. À la fin d'un livre, le
joueur reçoit un **passeport** : un code court (et son QR code) qu'il donne au début du livre suivant.

Une aventure sans campagne se joue exactement comme avant.

## Pour le joueur

- **À la victoire** d'un livre de campagne, l'écran de fin montre le passeport : le code
  (`LB1-7KQ2-H9TF-…`), un QR code et « Copier le code ». Il est aussi **enregistré sur l'appareil**.
- **Au début du livre suivant**, la création du héros propose :
  - **Nouveau voyageur** : on part sans passeport ; l'aventure donne l'équipement prévu par l'auteur ;
  - les **passeports enregistrés sur cet appareil** (nom du héros, livre, or, objets, amis) ;
  - **taper un code** : majuscules ou minuscules, avec ou sans tirets ; O se lit 0, I et L se lisent 1.
    Un code faux, d'une autre série ou d'une version plus récente est refusé avec un message clair.
- Le héros repart avec ses **caractéristiques de départ** (en pleine forme), son or, sa mémoire, ses objets
  de campagne, ses marques et ses compagnons (soignés). La Feuille d'Aventure dit d'où il vient.

## Pour l'auteur

Onglet **Règles → Campagne** : « Faire de cette aventure un livre de campagne », puis :

| Champ | Rôle |
|---|---|
| Identifiant de la campagne | le même dans tous les livres (un passeport d'une autre campagne est refusé) |
| Titre, numéro de ce livre, préfixe | affichés dans le code (`LB` + numéro du livre) et à l'écran |
| Caractéristiques, compteurs, objets, marques, compagnons transportés | des identifiants, dans un ordre fixe |
| Transporter l'or | oui par défaut |
| Modes | identifiants des modes, dans le même ordre dans tous les livres |

**Règle d'or : les listes ne font que s'allonger.** Le livre 3 peut ajouter des objets ou des marques **à la
fin** des listes du livre 1 ; il ne doit jamais en retirer ni les réordonner. Le code porte la longueur de
chaque liste : un passeport du livre 1 se lit donc encore au livre 3 (les cases ajoutées valent « non »).

Dans le fichier :

```jsonc
"rules": {
  "campaign": {
    "id": "tresor-labuse", "title": "Le Trésor de La Buse", "book": 2, "prefix": "LB",
    "modes": ["petit", "pisteur", "gardien"],
    "fields": {
      "stats": ["habilete", "endurance", "chance"], "gold": true,
      "counters": ["memoire"],
      "items": ["piece-01", "…", "piece-33", "piece-trouee"],
      "flags": ["papangue-ami"],
      "companions": ["cimendef"]
    },
    "newcomer": { "gold": 5, "items": ["piece-trouee"], "flags": [], "counters": {} }
  }
}
```

- `newcomer` : ce que reçoit le **nouveau voyageur** (partie sans passeport).
- Sur une fin de victoire, `"passport": false` n'affiche pas le passeport (fin secondaire, par exemple).
- Les objets et compagnons transportés doivent exister dans chaque livre qui les reçoit (`items`,
  `companions`), sinon ils sont ignorés à l'arrivée.

## Le code

Environ 150 bits pour une campagne de taille moyenne (33 pièces, une dizaine d'objets et de marques) :
une trentaine de caractères en base 32 de Crockford, groupés par quatre. Il contient : format, livre, mode,
longueurs des listes, caractéristiques de départ (0-127), or (0-1023), compteurs (0-255), une case par
objet, marque et compagnon, une empreinte de la campagne (8 bits) et une somme de contrôle (15 bits).
Rien n'est envoyé sur Internet.

## Vocabulaire du combat (moteur)

`rules.combat.words` remplace les libellés du combat ; un **mode** peut le faire aussi (règles du mode).
Exemple de « duel de courage » pour les petits, où personne n'est blessé :

```jsonc
"combat": { "damage": 1, "fleeDamage": 0, "words": {
  "title": "Duel de courage", "round": "manche {round}", "start": "Tenir bon", "attack": "Manche suivante",
  "flee": "Reculer", "foeHealth": "Peur", "hit": "{name} recule ! −{n}", "wounded": "Tu faiblis −{n}",
  "win": "Tu as tenu bon !", "lose": "Tu es à bout de souffle.", "down": "{name} s'enfuit.",
  "logRound": "Manche {round} : {txt}.", "logHit": "{name} recule", "logWounded": "tu faiblis (−{n} {stat})"
} }
```

Tous les libellés et leurs valeurs par défaut sont dans `COMBAT_WORDS` (`js/core/combat.js`). Repères :
`{name}` adversaire, `{n}` points, `{stat}` caractéristique de vie, `{round}`, `{me}`, `{foe}`, `{txt}`, `{total}`.
