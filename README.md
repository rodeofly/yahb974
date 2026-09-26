# Livre-Héros

Application web pour **écrire**, **tester** et **jouer** des livres dont vous êtes le héros :
illustrations, lancers de dés, feuille d'aventure tenue à jour, combats simulés, boutiques, sauvegardes.
Elle s'installe comme une application (PWA), fonctionne hors ligne et n'a besoin d'aucun serveur ni base de données.

**En ligne :** <https://rodeofly.github.io/livre-heros/> (installable sur téléphone et ordinateur).

La conception complète (inventaire des fonctions, architecture, format des aventures) est dans
[docs/CONCEPTION.md](docs/CONCEPTION.md).

## Lancer l'application

Il faut seulement servir le dossier en HTTP (les modules JavaScript et le service worker ne marchent pas en `file://`) :

```sh
git clone https://github.com/rodeofly/livre-heros.git
cd livre-heros
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
css/        app.css, fonts.css (polices incluses dans fonts/)
js/core/    moteur pur : dés, règles, combat, validation (testé en Node)
js/store/   IndexedDB, import/export .lhz, compression des images
js/ui/      interface Preact + htm (sans compilation)
js/lib/     bibliothèques incluses : preact-htm, cytoscape, fflate
adventures/ aventures publiées avec le site (exemple : La Tour de Brume)
tests/      tests du moteur
tools/      graphe-vers-aventure.py : convertit un livre-jeu analysé (paragraphes + renvois) en .lhz
```

## Tests

```sh
node --test tests/*.test.mjs
```

## Licences

Les bibliothèques et polices incluses sont listées dans [THIRD_PARTY.md](THIRD_PARTY.md).
