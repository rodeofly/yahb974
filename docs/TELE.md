# La télé et le cinéma : un livre-jeu synchronisé avec un monde en 3D

Ce document décrit comment Livre-Héros (yahb974) affiche, à côté d'un livre-jeu, une **page compagnon** (un monde
en 3D, une carte animée…) qui suit l'histoire paragraphe par paragraphe et partage les mêmes boutons. Il sert à
**adapter un livre existant** (ou un roman) en « mode synchro 3D », et à écrire une page compagnon qui lui répond.
Premier livre qui s'en sert : *Les sentiers de La Réunion*, avec l'appli 3D *L'île des parcours* (publiée avec le site,
dans `ile-des-parcours/` ; en local, servie sur le port 8081).

Principe en une phrase : **le livre raconte et décide, la télé montre ; les boutons sont les mêmes des deux côtés.**

## 1. En bref

| Pour… | Dans l'aventure | Ce que fait le lecteur |
|---|---|---|
| Afficher la télé | `meta.tele: { url, title?, cinema? }` | un cadre (`iframe`) à côté de l'en-tête, qui ne se recharge jamais d'un paragraphe à l'autre |
| Dire où on est | `sections[n].tele: "repère"` (texte libre) | envoie le repère à la télé ; sans repère, garde celui du dernier paragraphe qui en avait un |
| Relier un bouton au monde | `choices[i].tele: "étiquette"` | envoie les boutons du paragraphe (texte, étiquette, ce qu'ils donnent) ; un bouton pressé dans la télé fait le même choix |
| Un défi facultatif qui ne coupe pas le monde | `blocks[i].tele: "cote"` | panneau sur le côté au lieu d'une fenêtre, la télé continue |
| Ouvrir directement le cinéma | `meta.tele.cinema: true` | le monde en grand, le livre par-dessus |
| Un retour toujours à portée | `meta.tele.home: { to, label, title? }` | un bouton dans la pastille (« 🪂 Grand saut » : le hub d'où l'on choisit une porte) |
| Messages évanescents sans télé | `rules.toasts: true` | gains et notes surgissent puis s'effacent |

Rien d'autre à écrire : la légende (sous-titres), la fenêtre des défis, la carte du monde comme vue des choix, la
progression, le plein écran et les préférences sont automatiques.

## 2. Ce que voit le lecteur

- **Page** : l'en-tête (numéro, titre, Écouter, Texte/Sous-titres, Cinéma) à gauche, la télé à droite ; la feuille
  d'aventure repliable (« Replier › » / « 📜 Feuille ‹ ») ; au défilement, la télé devient une vignette flottante en
  haut à droite, réductible en pastille.
- **Cinéma** (bouton « Cinéma », ou `meta.tele.cinema`) : la télé occupe l'écran sous la barre du haut ; une pastille
  en haut à gauche (numéro, titre, Écouter, Page, 🗺️ Carte, 🎒 Sac, 📜 Feuille, et la **progression** : compteurs
  visibles, collections trouvées sur le total) ; la feuille devient un tiroir à droite ; une fin de partie revient à
  la page.
- **Plein écran** (⛶) : toute la page passe en plein écran, en cinéma, barre du haut masquée (`html.lh-full`,
  `--topbar-h: 0`). Pas le plein écran du seul cadre : il cacherait le sac, la carte, la feuille et les fenêtres.
- **La légende** : le texte du paragraphe passe en sous-titres **en bas** de la télé, un carton par paragraphe (les
  longs coupés entre deux phrases, jamais au milieu d'un gras). On avance par la molette, les flèches, ›, un toucher
  sur la télé hors d'un objet ; « ‹ » au premier carton revient au paragraphe précédent (si le livre le permet) ;
  « Passer le récit ⏭ » va au bout. Le texte complet reste lu par les lecteurs d'écran.
- **Le récit d'abord** : défis et choix n'apparaissent qu'au dernier sous-titre (ligne « Passer le récit » sous la
  télé en mode page).
- **Les défis** (blocs) s'ouvrent dans une fenêtre au-dessus de la télé, qui reçoit `paused: true` (le monde peut
  s'arrêter) ; « 📺 Voir la télé » ou Échap la cachent, une pastille « 🧩 Reprendre le défi » la rappelle ; la barre
  du jeu (Recommencer, Agrandir) reste en haut quand on fait défiler ; un défi réussi fait défiler jusqu'à
  « Continuer », qui prend le focus. En cinéma, la fenêtre et les messages sont rendus **dans** la télé.
- **Les messages** (gains, objets, notes) surgissent environ 3,6 s puis s'effacent ; les plus récents seulement
  (3 sur téléphone, 5 sur grand écran), au-dessus de la légende et des boutons du monde.
- **La carte du monde** (greffon carte) devient une autre vue des choix : un lieu connu où mène un choix possible du
  paragraphe (le paragraphe d'arrivée porte ce lieu, `sections[n].place`) est marqué ✈ et s'atteint d'un clic.
- **Préférences propres à chaque livre** : télé allumée, cinéma, sous-titres (`livre-heros:tele:<id>`,
  `livre-heros:cinema:<id>`, `livre-heros:sous-titres:<id>`) ; feuille repliée (`livre-heros:feuille-repliee`).

## 3. Le protocole (postMessage)

Le lecteur ne parle qu'au cadre de la télé et à l'origine de son adresse ; il n'accepte que les messages venus de ce
cadre et de cette origine. `{host}` dans `meta.tele.url` est remplacé par la machine qui sert le livre
(`http://{host}:8081/?tele=1` : la même télé depuis le poste, une tablette ou un téléphone du réseau).

### Du livre vers la télé

`{ type: "livre-heros:tele", … }`, envoyé au chargement du cadre, à chaque changement, et quand la télé annonce
`livre-heros:tele-ready` :

| Champ | Sens |
|---|---|
| `cue` | le repère du paragraphe (ou du dernier qui en avait un) |
| `section` | le numéro du paragraphe (la télé le renvoie avec ses choix : un choix venu d'un paragraphe passé est ignoré) |
| `choices` | `[{ index, text, tag, gives: [{ icon, name, text }] }]` : les boutons **disponibles**, envoyés seulement une fois le récit lu ; `gives` = objets et compteurs que donnent leurs effets (effets à condition fausse ignorés) |
| `paused` | un défi est ouvert par-dessus (la télé peut s'arrêter) |
| `legend` | hauteur de la légende en bas (px) : poser les boutons et les cartes au-dessus |
| `top` | hauteur couverte par la pastille du livre en haut à gauche (px, cinéma) : ranger les cartes dessous |
| `places`, `visited` | lieux connus et visités de la carte du monde (noms) : montrer ce que le lecteur a découvert |

`{ type: "livre-heros:tele-view", id }` : le lecteur a pressé un bouton de vue déclaré par la télé.

### De la télé vers le livre

| Message | Effet |
|---|---|
| `livre-heros:tele-ready` | le lecteur renvoie le message du paragraphe en cours (la page compagnon peut mettre longtemps à charger) |
| `livre-heros:tele-choice` `{ index?, tag?, section }` | le lecteur fait ce choix (par numéro, ou le premier disponible qui porte cette étiquette) ; s'il n'y en a pas, il montre ce qu'il reste à faire (le défi) |
| `livre-heros:tele-tap` | sous-titre suivant |
| `livre-heros:tele-wheel` `{ deltaY }` | molette : sous-titre suivant ou précédent |
| `livre-heros:tele-views` `{ views: [{ id, icon, label, active?, disabled? }] }` | le lecteur met ces vues en boutons dans la barre de la télé |

Dans la page même, les autres vues des choix (la carte du monde…) demandent un choix par l'événement
`livre-heros:choose` (`{ index | tag, section }`) : **un seul chemin pour choisir**, quel que soit l'endroit du clic.

## 4. Adapter un livre en mode synchro 3D : la méthode

1. **Les lieux.** Donner à chaque paragraphe son `place` (carte du monde) ; c'est ce qui rend la carte cliquable
   (✈) et ce que la télé reçoit dans `places`.
2. **Les repères.** Écrire une grammaire de repères au grain du **lieu et de l'action visible**, pas du texte :
   `sentier-3` (la porte), `sentier-3:marche-2` (on marche vers l'étape 2), `sentier-3:etape-2` (la caisse fermée),
   `sentier-3:caisse-2` (elle s'ouvre), `sentier-3:arrivee`, `z07:sentier`, `z07`, `ciel`, `final`. La page compagnon
   décide seule *comment* y aller (marcher si l'histoire se suit, couper sinon) : les retours en arrière et les sauts
   restent justes. Générer les repères avec le livre (une table « clé de paragraphe → repère »).
3. **Les boutons.** Toute action visible dans le monde devient un **choix** (pas un `onEnter`), avec une étiquette :
   ranger un butin (`ranger`, avec ses `give` : la télé en fait une carte « Ranger dans le sac »), ouvrir un coffre
   (`coffre`), marcher (`marcher`), sauter (`saut`), une porte (`sentier-N`), un sentier caché (`zNN`). Un choix qui
   reste sur le paragraphe (`to` = lui-même) avec une marque (`flag`) et `hideIfUnavailable` fait les étapes « ouvrir
   puis ranger ».
4. **Les défis.** Les blocs (énigmes, activités zefor) s'ouvrent seuls par-dessus la télé après le récit ; marquer
   `tele: "cote"` ceux qu'on peut faire en marchant. Prévoir une sortie (`failure` vers une aide) pour ne jamais
   coincer le lecteur.
5. **Le texte.** Écrire en paragraphes courts (un carton de légende chacun, environ 220 signes) ; pas de liens vers
   un site extérieur (la télé montre déjà le lieu).
6. **Vérifier** : la simulation du livre (tous les chemins), puis le lecteur à la taille d'un téléphone (pastille,
   légende, boutons, défi au premier plan).

## 5. Écrire la page compagnon (liste de contrôle)

- Lire `livre-heros:tele` et ne garder que le dernier message ; changer de lieu seulement quand `cue` change.
- Ne rien enregistrer de la progression : le livre est la seule mémoire (la même page peut servir à plusieurs livres).
- Annoncer `livre-heros:tele-ready` quand elle est prête.
- Montrer chaque bouton reçu ; rendre cliquables les objets du monde qui portent une étiquette ; renvoyer
  `livre-heros:tele-choice` avec `section`.
- Faire passer **chaque champ** du message jusqu'à l'interface (une couche de relais qui oublie un champ le perd en silence).
- Poser ses boutons au-dessus de `legend`, ses cartes sous `top`, et cadrer la caméra au milieu de ce qui reste
  libre (décalage de l'image).
- Renvoyer la molette et les touchers « dans le vide » au livre (la légende).
- Déclarer ses vues (`livre-heros:tele-views`) plutôt que d'ajouter sa propre barre.

## 6. Pièges rencontrés (et la règle qui en est sortie)

| Piège | Règle |
|---|---|
| Déplacer un `iframe` dans la page le recharge | le cadre ne bouge jamais ; seuls ses styles changent (vignette, cinéma) |
| Le plein écran d'un élément cache tout le reste (sac, carte, feuille, fenêtres) | plein écran de toute la page |
| `pointer-events: none` sur un conteneur passe aux enfants : la télé ne recevait plus les clics, qui tombaient sur les boutons cachés de la page derrière | rendre `pointer-events: auto` à la télé |
| Une position fixe à l'intérieur de la télé se calculait par rapport à un mauvais cadre ; une pile en grille avec hauteur maximale et alignement en bas s'étirait | dans la télé, positions absolues ; pile de messages en colonne flexible, limitée par le nombre |
| Un champ ajouté au protocole n'arrivait pas (couche de relais) | chaque nouveau champ se suit de bout en bout |
| La télé éteinte dans un livre l'était dans tous | préférences par livre |
| Un défi en panneau latéral passait sous la pastille sur téléphone | sur téléphone, tout défi prend l'écran et masque la pastille |
| Les noms de lieux diffèrent par la typographie (’ et ', espaces fines) | comparer des noms normalisés |
| Renuméroter les paragraphes casse les parties sauvegardées | le dire au lecteur, ou garder des numéros stables |

## 7. Servir le livre et la télé sur le réseau local

Pour jouer depuis une tablette ou un téléphone : `tools/dev.py 8080 --lan --bibliotheque …` (bibliothèque) et la page
compagnon sur un autre port (`http://{host}:8081/…`). Les deux serveurs ont une file d'attente large
(`request_queue_size = 128` : un téléphone demande des dizaines de fichiers d'un coup, Python n'en garde que 5 par
défaut). Chez l'auteur, deux services systemd utilisateur les gardent en vie (`Restart=always`, `loginctl enable-linger`).

## 8. Tests

`npm test` (moteur). Dans la bibliothèque locale : `#/jouer/<id>?test=1&from=<n>&mode=<m>` ouvre un paragraphe en
mode test (« Simuler une réussite » pour les défis zefor). Vérifier à la taille d'un téléphone (412 × 860) : pastille,
légende en bas, boutons du monde au-dessus, défi au premier plan, messages qui ne recouvrent pas les boutons. Un
navigateur sans écran qui rend une page 3D en logiciel charge fortement la machine : un seul onglet, et l'arrêter
après chaque essai si quelqu'un joue en même temps sur la même machine.
