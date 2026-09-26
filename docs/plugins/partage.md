# Greffon « partage » : envoyer une aventure par lien, QR code ou fichier

Ce greffon sert à **faire circuler vos aventures** sans serveur ni compte : un élève, un collègue ou un ami
reçoit un lien (ou scanne un QR code) et se retrouve directement dans l'aventure.

Il n'ajoute **aucun champ** au format des aventures : toutes les aventures, anciennes ou nouvelles, se partagent.

## Où le trouver

| Endroit | Bouton | Ce qu'il fait |
|---|---|---|
| Bibliothèque, sur chaque carte | **Partager** | ouvre la fenêtre « Partager » de cette aventure |
| Éditeur, barre du haut | **Partager** | la même fenêtre, pour l'aventure en cours d'écriture |
| Bibliothèque, en haut | **Ouvrir un lien** | colle un lien reçu (utile quand l'application installée ne s'ouvre pas depuis un message) |
| Version imprimable | *(automatique)* | un encadré « Version numérique » avec un QR code, à la fin des règles, pour les aventures publiées |

## La fenêtre « Partager »

### Aventure publiée avec le site (badge « Publiée »)

- **Lien direct** : `https://votre-site/#/jouer/<identifiant>`. Il ouvre l'aventure, prête à jouer, sur n'importe quel appareil.
- **QR code** grand et contrasté (toujours noir sur blanc, même en thème sombre : c'est ce que lisent les téléphones),
  avec sa légende. **Afficher en grand** le montre en plein écran, pratique pour le projeter en classe.
  **PNG** et **SVG** l'enregistrent en image pour une fiche d'activité ou une affiche.
- **Copier le lien** le met dans le presse-papiers (si le navigateur refuse, le lien est sélectionné : Ctrl+C ou appui long).
  Sur téléphone, **Envoyer…** ouvre le menu de partage du système (SMS, messagerie, courriel…).

### Aventure « Sur cet appareil » : le lien magique

Une aventure écrite dans votre navigateur n'existe nulle part ailleurs. Le **lien magique** la contient tout entière,
compressée, dans l'adresse elle-même : `https://votre-site/#/importer/<jeton>`. Aucun serveur ne la stocke.

- **Sans les images ni les sons.** Les fichiers ajoutés sur votre appareil ne voyagent pas dans un lien : la fenêtre
  indique combien il en manque. La personne qui ouvre le lien aura le texte, les règles, les combats, les objets, mais pas
  les illustrations. Pour tout transmettre, utilisez le **fichier** (voir plus bas).
- **La longueur compte.** La fenêtre affiche la longueur du lien et une jauge à trois étapes (l'étape actuelle est
  encadrée en gras et marquée « votre lien ») :

  | Longueur du lien | Ce qui est proposé |
  |---|---|
  | jusqu'à 2 000 caractères | lien **et** QR code (au-delà, le code serait trop dense pour un téléphone) |
  | de 2 001 à 59 999 caractères | lien seul, à copier et envoyer par message ou courriel |
  | 60 000 caractères et plus | pas de lien : envoyez le fichier |

  Pour vous donner une idée : une petite énigme d'environ **400 mots** (cinq à huit paragraphes courts) tient dans un
  QR code ; « La Tour de Brume » (19 paragraphes, combats, boutique, formules) donne un lien d'environ 5 000 caractères ;
  il faut plusieurs centaines de paragraphes pour dépasser 60 000.
- Certaines messageries coupent les liens très longs. Si le lien arrive incomplet, la page d'arrivée le dit clairement
  (« Ce lien magique est abîmé… ») : envoyez alors le fichier.

### Le fichier de l'aventure (.lhz)

Toujours disponible, pour toutes les aventures : il contient **tout** (texte, règles, images, sons). Sur les appareils
qui le permettent, **Envoyer le fichier…** ouvre le menu de partage du système ; sinon **Télécharger le fichier**
l'enregistre. La personne l'ouvre avec **Importer (.lhz)** dans sa bibliothèque.

### Attention en local

Si vous utilisez Livre-Héros depuis votre ordinateur (`localhost`, `127.0.0.1` ou un fichier ouvert directement), la
fenêtre vous prévient : ces liens et QR codes ne marcheront que sur cet appareil. Partagez depuis le site en ligne.

## Recevoir un lien magique

En ouvrant un lien magique, on arrive sur une page d'aperçu :

- titre, auteur, description, nombre de paragraphes, d'objets et de fins victorieuses ;
- « Version sans images » s'il manque des illustrations ;
- si une aventure de même identifiant est déjà dans la bibliothèque, elle **n'est jamais remplacée** : l'aventure reçue
  est ajoutée à côté, avec un nouvel identifiant (et un bouton « Jouer à celle que j'ai déjà ») ;
- **Ajouter à ma bibliothèque**, puis **Jouer** (ou **Modifier**).

Si le lien est abîmé, la page explique pourquoi, sans jargon :

| Cas | Message affiché |
|---|---|
| lien coupé par une messagerie | « Ce lien magique est abîmé — il est incomplet : il a probablement été coupé… » |
| caractère modifié ou ajouté | « … il contient des caractères inattendus » ou « … son contenu ne correspond plus à sa somme de contrôle » |
| lien créé par une version plus récente | « Ce lien vient d'une version plus récente » (recharger la page) |
| contenu qui n'est pas une aventure | « Ce lien ne contient pas d'aventure » |

## Format du lien magique (pour les curieux)

Le jeton qui suit `#/importer/` est écrit en **base64url** (lettres, chiffres, `-` et `_`, sans `=`) et contient :

| Octets | Contenu |
|---|---|
| 0 | version du format : `1` |
| 1 à 4 | taille du JSON décompressé (entier non signé, octet de poids fort en premier) |
| 5 et 6 | nombre d'images et de sons retirés |
| 7 à 10 | CRC-32 (celui des fichiers zip) des octets 5-6 puis du JSON : un lien coupé ou modifié est détecté |
| 11 et suivants | le JSON de l'aventure (`adventure.json`, allégé comme expliqué ci-dessous), compressé en DEFLATE brut (bibliothèque fflate, niveau 9) |

Avant compression :
- toute valeur qui est un **chemin de fichier local** (`images/…`, `sons/…`, ou tout chemin relatif se terminant par une
  extension d'image ou de son) est remplacée par `null` (ou retirée d'une liste), y compris dans les champs ajoutés par
  d'autres greffons ; les images données par une adresse `https://…` sont conservées ;
- pour raccourcir le lien, les valeurs égales aux **valeurs par défaut du format 1** ne sont pas écrites : règles
  (`stats`, `classes`, `gold`, `provisions`, `meal`, `combat`, `startItems`, `allowBack`, `spells`, `time`, telles que
  les crée une nouvelle aventure), informations (`author: ""`, `description: ""`, `cover: null`, `sound: null`) et
  champs de paragraphe (`title: ""`, `text: ""`, `image: null`, `place: ""`, `onEnter: []`, `blocks: []`, `choices: []`,
  `ending: null`). Elles sont remises à l'import. Ces valeurs sont figées dans `core.js` : même si les réglages par défaut
  de l'application changent un jour, un ancien lien gardera exactement son sens ;
- la date de modification (`meta.updated`) n'est pas transmise : elle est fixée quand l'aventure est ajoutée.

À l'import, l'aventure est complétée comme n'importe quel fichier (`normalizeAdventure`), un identifiant dangereux
(`../x`) est nettoyé, et une taille annoncée de plus de 8 Mo est refusée.

### Exemple (console du navigateur ou Node)

```js
import { packAdventure, unpackAdventure, importLink, shareMode, qrSvg } from './js/plugins/partage/core.js';

const { token, removed } = packAdventure(aventure);        // removed : [{ path: 'images/1.webp', kind: 'image' }, …]
const lien = importLink('https://rodeofly.github.io/yahb974/', token);
shareMode(lien.length);                                      // 'qr' | 'link' | 'file'
const svg = qrSvg(lien, { title: aventure.meta.title });     // fichier SVG, ou null si le lien est trop long

const { adventure, missingMedia } = unpackAdventure(token);  // lève une ShareError { code, title, message } si abîmé
```

Toutes ces fonctions sont pures (aucun accès au DOM) et testées dans `tests/partage.test.mjs`.

## Bibliothèque tierce

Le QR code est calculé par [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT),
copié dans `js/lib/qrcode/` avec sa licence ; une ligne `export default qrcode;` a été ajoutée à la fin du fichier pour en
faire un module. Rien n'est chargé depuis Internet : le partage fonctionne hors ligne.

## Limites connues

- Chrome (Android, Windows) ne sait pas « partager » un fichier `.lhz` avec le menu du système : le bouton télécharge
  alors le fichier, qu'il faut joindre soi-même au message. Safari (iPhone, iPad, Mac) le permet.
- Un QR code de plus de ~1 000 caractères est dense : utilisez « Afficher en grand » pour le scanner sur un écran.
- Le lien magique fige l'aventure au moment du partage : si vous la modifiez ensuite, renvoyez un nouveau lien.
