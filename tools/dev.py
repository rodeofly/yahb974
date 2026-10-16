#!/usr/bin/env python3
"""Serveur de développement : `npm run dev` (ou `python3 tools/dev.py [port]`), puis http://localhost:8080.

Comme `npm run serve`, mais pour voir ses changements en direct, sans vider de cache :
- aucune réponse n'est gardée par le navigateur (Cache-Control: no-store) ;
- `sw.js` est remplacé par un service worker qui vide les caches et se désinscrit : la version installée
  (hors ligne) ne sert plus de vieux fichiers. Un simple rechargement de la page montre la dernière version.
Ne sert qu'au poste de l'auteur : la version publiée garde son vrai service worker.
"""
import functools
import http.server
import pathlib
import sys

RACINE = pathlib.Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

SW_DEV = b"""// Service worker de developpement (tools/dev.py) : vide les caches et se desinscrit.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
"""


class Dev(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/sw.js':
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(SW_DEV)))
            self.end_headers()
            self.wfile.write(SW_DEV)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    print(f'Livre-Héros (dev) : http://localhost:{PORT}  (Ctrl+C pour arrêter)')
    http.server.ThreadingHTTPServer(('', PORT), functools.partial(Dev, directory=str(RACINE))).serve_forever()
