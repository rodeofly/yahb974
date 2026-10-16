#!/usr/bin/env python3
"""Serveur de développement : `npm run dev`, puis http://localhost:8080.

    npm run dev                                   # le moteur seul
    npm run dev -- --livre ../mon-livre/dist      # + un livre en cours d'écriture (dossier : adventure.json, images/…)

Comme `npm run serve`, mais pour voir ses changements en direct, sans vider de cache :
- aucune réponse n'est gardée par le navigateur (Cache-Control: no-store) ;
- `sw.js` est remplacé par un service worker qui vide les caches et se désinscrit : la version installée
  (hors ligne) ne sert plus de vieux fichiers. Un simple rechargement de la page montre la dernière version ;
- `--livre DOSSIER` (plusieurs fois si besoin) : le livre de ce dossier apparaît dans la bibliothèque comme une
  aventure publiée, relu à chaque chargement (régénérer le livre, recharger la page : c'est à jour). Rien n'est
  copié dans le dépôt. Une copie importée du même livre (même identifiant) passe avant : la supprimer de la
  bibliothèque pour voir celle du dossier.
Ne sert qu'au poste de l'auteur : la version publiée garde son vrai service worker.
"""
import functools
import http.server
import json
import pathlib
import sys
import urllib.parse

RACINE = pathlib.Path(__file__).resolve().parent.parent

SW_DEV = b"""// Service worker de developpement (tools/dev.py) : vide les caches et se desinscrit.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
"""


def arguments(argv):
    port, livres, i = 8080, [], 0
    while i < len(argv):
        a = argv[i]
        if a == '--livre' and i + 1 < len(argv):
            livres.append(pathlib.Path(argv[i + 1]).resolve()); i += 2; continue
        if a.isdigit():
            port = int(a)
        i += 1
    return port, livres


PORT, LIVRES = arguments(sys.argv[1:])


def livres():
    """{ identifiant: (dossier, aventure) } pour chaque --livre lisible."""
    out = {}
    for d in LIVRES:
        try:
            adv = json.loads((d / 'adventure.json').read_text(encoding='utf-8'))
            out[adv['id']] = (d, adv)
        except (OSError, ValueError, KeyError) as e:
            print(f'  --livre {d} : illisible ({e})')
    return out


class Dev(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def envoyer(self, corps, type_):
        self.send_response(200)
        self.send_header('Content-Type', type_)
        self.send_header('Content-Length', str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        chemin = urllib.parse.unquote(self.path.split('?')[0])
        if chemin == '/sw.js':
            return self.envoyer(SW_DEV, 'text/javascript; charset=utf-8')
        if LIVRES and chemin == '/adventures/index.json':
            liste = json.loads((RACINE / 'adventures' / 'index.json').read_text(encoding='utf-8'))
            for ident, (_, adv) in livres().items():
                meta = adv.get('meta', {})
                liste = [e for e in liste if e.get('id') != ident] + [{
                    'id': ident, 'title': meta.get('title', ident), 'author': meta.get('author', ''),
                    'description': meta.get('description', ''), 'cover': meta.get('cover'),
                    'sections': len(adv.get('sections', {}))}]
            return self.envoyer(json.dumps(liste, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')
        if LIVRES and chemin.startswith('/adventures/'):
            ident, _, reste = chemin[len('/adventures/'):].partition('/')
            trouve = livres().get(ident)
            if trouve:
                dossier = trouve[0]
                fichier = (dossier / reste).resolve()
                if dossier in fichier.parents and fichier.is_file():
                    type_ = self.guess_type(str(fichier))
                    return self.envoyer(fichier.read_bytes(), type_)
                self.send_error(404)
                return None
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    print(f'Livre-Héros (dev) : http://localhost:{PORT}  (Ctrl+C pour arrêter)', flush=True)
    for ident, (d, _) in livres().items():
        print(f'  livre « {ident} » lu dans {d}', flush=True)
    http.server.ThreadingHTTPServer(('', PORT), functools.partial(Dev, directory=str(RACINE))).serve_forever()
