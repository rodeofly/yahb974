# Greffon « minuteur »

Un **compte à rebours** dans un paragraphe, pour celui qui lit : le temps d'attente avant de relancer un élève
(livre du maître), un sablier de jeu, une pause. Il ne change rien à la partie : ni effet, ni destination.

## Pour le joueur

Un bouton rond : « Les 5 secondes d'attente ». Un toucher lance le compte à rebours : l'anneau se vide seconde après
seconde (« J'attends… »), puis la fin s'annonce par une phrase (« C'est le moment : relance si besoin. »), un petit
son et, sur tablette, une courte vibration. Un nouveau toucher le relance. Si l'appareil réduit les animations,
l'anneau change d'un coup chaque seconde.

## Dans l'éditeur

Bouton **Minuteur** des blocs du paragraphe : la durée (1 à 600 secondes, 5 par défaut), le texte du bouton et la
phrase de fin.

## Format JSON

```jsonc
"blocks": [
  { "type": "timer", "seconds": 5, "label": "Les 5 secondes d'attente", "after": "C'est le moment : relance si besoin." }
]
```

Version imprimable : « Les 5 secondes d'attente : comptez 5 secondes dans votre tête. » (tutoyé si l'aventure tutoie).
