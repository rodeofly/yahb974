# Livre-Héros

Application web pour **écrire**, **tester** et **jouer** des livres dont vous êtes le héros :
illustrations, lancers de dés, feuille d'aventure tenue à jour, combats simulés, boutiques, sauvegardes.
Elle s'installe comme une application (PWA), fonctionne hors ligne et n'a besoin d'aucun serveur ni base de données.

**En ligne :** <https://rodeofly.github.io/yahb974/> (installable sur téléphone et ordinateur).

La conception complète (inventaire des fonctions, architecture, format des aventures) est dans
[docs/CONCEPTION.md](docs/CONCEPTION.md).

## Fonctionnalités

**Pour jouer** : création du héros aux dés, lecture illustrée, choix conditionnels, tests de Chance et d'Habileté,
tables de dés, combats simulés, boutiques, magie à codes, jours et repas, sauvegardes multiples, retour en arrière,
effets sonores et lecture à voix haute, thème clair ou sombre.

**Pour écrire** : éditeur sans code (conditions et effets en listes déroulantes), graphe de l'aventure,
vérification des renvois, renumérotation façon livre, test depuis n'importe quel paragraphe,
version imprimable A4 / A5, export et import `.lhz`.

**Greffons** (chacun documenté dans [docs/plugins/](docs/plugins/), architecture dans [docs/PLUGINS.md](docs/PLUGINS.md)) :

| Greffon | Ce qu'il apporte |
|---|---|
| [Équipement](docs/plugins/equipement.md) | objets portés (arme, armure, bouclier, bijou), bonus de combat, malus sans arme, sac à capacité limitée |
| [Compteurs](docs/plugins/compteurs.md) | Réputation, Temps, Malédiction… visibles ou secrets, seuils qui affichent un message, tuent ou font gagner |
| [Compagnons](docs/plugins/compagnons.md) | alliés qui rejoignent le héros et combattent à ses côtés |
| [Défis](docs/plugins/defis.md) | énigmes et exercices (réponse, nombre, QCM, cases, ordre) qui débloquent la suite, indices payants, réponses chiffrées |
| [Zefor](docs/plugins/zefor.md) | parcours zefor974 (maths, logique, programmation, Blokaly…) dont la réussite débloque une étape ; protocole côté zefor dans [docs/ZEFOR.md](docs/ZEFOR.md) |
| [Maths](docs/plugins/maths.md) | formules `$…$` et `$$…$$` (KaTeX, hors ligne) dans les paragraphes et les choix, onglet d'aide |
| [Carte](docs/plugins/carte.md) | images à zones cliquables, carte du monde avec lieux visités et chemin parcouru |
| [Succès](docs/plugins/succes.md) | succès à débloquer, progression dans la bibliothèque, statistiques pour l'auteur |
| [Échanges](docs/plugins/echanges.md) | export Twine et ink, import Twine, fusion de deux aventures (co-écriture) |
| [Partage](docs/plugins/partage.md) | lien, « lien magique », QR code projetable en classe, fichier |
| [Accessibilité](docs/plugins/accessibilite.md) | polices Atkinson Hyperlegible et OpenDyslexic, interlignage, très contrasté, guide de lecture |

## Lancer l'application

Il faut seulement servir le dossier en HTTP (les modules JavaScript et le service worker ne marchent pas en `file://`) :

```sh
git clone https://github.com/rodeofly/yahb974.git
cd yahb974
python3 -m http.server 8080
```

puis ouvrir <http://localhost:8080>. Sur un téléphone du même réseau : `http://<adresse-de-l-ordinateur>:8080`.
Le navigateur propose ensuite « Installer l'application ».

## Mettre en ligne

Ce dépôt est un site statique. Il suffit de le copier sur n'importe quel hébergement :
GitHub Pages, Netlify, Cloudflare Pages, un NAS… Ce dépôt est publié automatiquement sur GitHub Pages
à chaque `git push` sur `main`. Pensez à changer `VERSION` dans `sw.js` à chaque mise en ligne
pour que les joueurs reçoivent la nouvelle version.

## Écrire une aventure

1. **Écrire une aventure** sur l'écran d'accueil.
2. Un paragraphe = un texte, une image facultative, des effets à l'arrivée, des blocs (test, table de dés, combat, boutique)
   et des choix. Un choix peut exiger un objet, une marque, une caractéristique… et appliquer des effets.
3. L'onglet **Graphe** montre toute l'aventure ; glissez les paragraphes pour les ranger, cliquez pour les ouvrir.
4. L'onglet **Vérifier** liste les renvois cassés, les impasses et les paragraphes inaccessibles.
5. **Tester d'ici** lance une partie à partir du paragraphe ouvert, sans rien sauvegarder.
6. **Exporter** produit un fichier `.lhz` (zip : `adventure.json` + images) à partager ou à garder en sauvegarde.

Tout est enregistré automatiquement dans le navigateur (IndexedDB). Exportez régulièrement :
effacer les données du site efface aussi les aventures.

## Publier une aventure avec le site

Dézippez le `.lhz` dans `adventures/<identifiant>/` et ajoutez une ligne dans `adventures/index.json` :

```json
{ "id": "<identifiant>", "title": "…", "author": "…", "description": "…", "cover": "images/couverture.webp", "sections": 42 }
```

Les aventures publiées sont en lecture seule ; « Copier pour modifier » en fait une copie locale.

## Structure

```
index.html  manifest.webmanifest  sw.js
css/        app.css, fonts.css (polices incluses dans fonts/, polices d'accessibilité dans fonts/accessibilite/)
js/core/    moteur pur : dés, règles, combat, validation (testé en Node)
js/store/   IndexedDB, import/export .lhz, compression des images
js/ui/      interface Preact + htm (sans compilation) et registres des greffons (registry.js)
js/plugins/ greffons : un dossier par fonctionnalité (core.js moteur, index.js interface)
js/lib/     bibliothèques incluses : preact-htm, cytoscape, d3, dagre, fflate, KaTeX, qrcode-generator
adventures/ aventures publiées avec le site (La Tour de Brume ; Le Phare des Nombres, démonstration de tous les greffons)
tests/      tests du moteur et des greffons
tools/      graphe-vers-aventure.py : convertit un livre-jeu analysé (paragraphes + renvois) en .lhz
```

## Tests

```sh
node --test tests/*.test.mjs
```

## Licences

Les bibliothèques et polices incluses sont listées dans [THIRD_PARTY.md](THIRD_PARTY.md).
