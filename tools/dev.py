#!/usr/bin/env python3
"""Serveur de développement : `npm run dev`, puis http://localhost:8080.

    npm run dev                                         # le moteur seul
    npm run dev -- --livre ../mon-livre/dist            # + un livre en cours d'écriture (dossier ou .lhz)
    npm run dev -- --bibliotheque ../bibliotheque.json  # + toute une bibliothèque rangée par rayons
    npm run dev -- --lan                                # aussi depuis une tablette du même réseau (http://<adresse>:8080)

Comme `npm run serve`, mais pour voir ses changements en direct, sans vider de cache :
- aucune réponse n'est gardée par le navigateur (Cache-Control: no-store) ;
- `sw.js` est remplacé par un service worker qui vide les caches et se désinscrit : la version installée
  (hors ligne) ne sert plus de vieux fichiers. Un simple rechargement de la page montre la dernière version ;
- `--livre CHEMIN` (plusieurs fois si besoin) : le livre de ce dossier (adventure.json, images/…) ou de ce .lhz apparaît
  dans la bibliothèque comme une aventure publiée, relu à chaque chargement. Rien n'est copié dans le dépôt. Une copie
  importée du même livre (même identifiant) passe avant : la supprimer de la bibliothèque pour voir celle du dossier ;
- `--bibliotheque FICHIER` : un catalogue de rayons (séries), relu dès qu'il change :
      { "rayons": [
          { "titre": "Sorcellerie !", "note": "…", "livres": ["chemin/dossier", "chemin.lhz", { "livre": "…", "pdf": "…" }] },
          { "titre": "Démonstrations", "publiees": true },        // les aventures publiées du moteur (adventures/)
          { "titre": "Loup Solitaire", "documents": [ { "pdf": "…", "titre": "1. …", "ordre": 1, "vignette": "….jpg" } ] } ] }
  Les livres se jouent ; les documents (PDF) se lisent. Les fichiers ne sont servis que par leur numéro de catalogue.
Ne sert qu'au poste de l'auteur : la version publiée garde son vrai service worker.
"""
import functools
import http.server
import json
import pathlib
import sys
import threading
import time
import urllib.parse
import zipfile

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
    port, livres, bib, lan, i = 8080, [], None, False, 0
    while i < len(argv):
        a = argv[i]
        if a == '--livre' and i + 1 < len(argv):
            livres.append(pathlib.Path(argv[i + 1]).resolve()); i += 2; continue
        if a == '--bibliotheque' and i + 1 < len(argv):
            bib = pathlib.Path(argv[i + 1]).resolve(); i += 2; continue
        if a == '--lan':
            lan = True
        elif a.isdigit():
            port = int(a)
        i += 1
    return port, livres, bib, lan


# Par défaut, ce poste seulement (127.0.0.1) : un livre en cours d'écriture n'a pas à être vu de tout le réseau.
PORT, LIVRES, BIBLIOTHEQUE, LAN = arguments(sys.argv[1:])


class Livre:
    """Un livre jouable : un dossier (adventure.json, images/…) ou un .lhz (zip), lu sans être décompressé."""

    def __init__(self, chemin):
        self.chemin = pathlib.Path(chemin).resolve()
        self.zip = self.chemin.suffix.lower() in ('.lhz', '.zip')
        self.prefixe = ''
        if self.zip:
            with zipfile.ZipFile(self.chemin) as z:
                nom = next(n for n in z.namelist() if n.endswith('adventure.json'))
            self.prefixe = nom[:-len('adventure.json')]

    def aventure(self):
        if self.zip:
            with zipfile.ZipFile(self.chemin) as z:
                return json.loads(z.read(self.prefixe + 'adventure.json'))
        return json.loads((self.chemin / 'adventure.json').read_text(encoding='utf-8'))

    def fichier(self, rel):
        """Contenu d'un fichier du livre (bytes), ou None : jamais hors du livre."""
        if self.zip:
            with zipfile.ZipFile(self.chemin) as z:
                try:
                    return z.read(self.prefixe + rel)
                except KeyError:
                    return None
        f = (self.chemin / rel).resolve()
        return f.read_bytes() if self.chemin in f.parents and f.is_file() else None


def entree(adv, **plus):
    meta = adv.get('meta', {})
    e = {'id': adv['id'], 'title': meta.get('title', adv['id']), 'author': meta.get('author', ''),
         'description': meta.get('description', ''), 'cover': meta.get('cover'), 'sections': len(adv.get('sections', {}))}
    e.update({k: v for k, v in plus.items() if v is not None})
    return e


_cache = {'cle': None, 'quand': 0.0, 'val': None}
_verrou = threading.Lock()


def catalogue():
    """(entrées de l'index, { id: Livre }, { numéro: (pdf, vignette) }), relu quand le catalogue change (2 s au plus)."""
    with _verrou:
        cle = BIBLIOTHEQUE.stat().st_mtime if BIBLIOTHEQUE and BIBLIOTHEQUE.exists() else None
        if _cache['val'] is not None and _cache['cle'] == cle and time.time() - _cache['quand'] < 2:
            return _cache['val']
        publiees = json.loads((RACINE / 'adventures' / 'index.json').read_text(encoding='utf-8'))
        entrees, livres, docs, avec_publiees = [], {}, {}, False

        def ajoute_livre(chemin, serie=None, note=None, ordre=None, pdf=None):
            try:
                l = Livre(chemin)
                adv = l.aventure()
            except (OSError, ValueError, KeyError, StopIteration, zipfile.BadZipFile) as err:
                print(f'  livre illisible : {chemin} ({err})', flush=True)
                return
            camp = (adv.get('rules') or {}).get('campaign') or {}
            plus = {'series': serie, 'seriesNote': note, 'seriesOrder': camp.get('book') or ordre}
            if pdf:
                n = str(len(docs)); docs[n] = (pathlib.Path(pdf), None); plus['pdf'] = f'/bibliotheque/{n}.pdf'
            livres[adv['id']] = l
            entrees[:] = [e for e in entrees if e['id'] != adv['id']]
            entrees.append(entree(adv, **plus))

        for chemin in LIVRES:
            ajoute_livre(chemin)
        if BIBLIOTHEQUE and BIBLIOTHEQUE.exists():
            cfg = json.loads(BIBLIOTHEQUE.read_text(encoding='utf-8'))
            base = BIBLIOTHEQUE.parent
            for r in cfg.get('rayons', []):
                serie, note = r.get('titre'), r.get('note')
                if r.get('publiees'):
                    avec_publiees = True
                    entrees += [{**e, 'series': serie, 'seriesNote': note, 'seriesOrder': k + 1} for k, e in enumerate(publiees)]
                    continue
                for k, x in enumerate(r.get('livres', [])):
                    chemin, pdf = (x, None) if isinstance(x, str) else (x.get('livre'), x.get('pdf'))
                    ajoute_livre(base / chemin, serie, note, k + 1, pdf and base / pdf)
                for k, d in enumerate(r.get('documents', [])):
                    n = str(len(docs))
                    docs[n] = (base / d['pdf'], d.get('vignette') and base / d['vignette'])
                    entrees.append({'id': f'pdf-{n}', 'title': d.get('titre') or pathlib.Path(d['pdf']).stem, 'kind': 'document',
                                    'series': serie, 'seriesNote': note, 'seriesOrder': d.get('ordre', k + 1),
                                    'href': f'/bibliotheque/{n}.pdf', 'coverUrl': f'/bibliotheque/{n}.jpg' if d.get('vignette') else None})
        if not avec_publiees:
            entrees = publiees + entrees
        _cache.update(cle=cle, quand=time.time(), val=(entrees, livres, docs))
        return _cache['val']


class Dev(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def envoyer(self, corps, type_, nom=None):
        self.send_response(200)
        self.send_header('Content-Type', type_)
        self.send_header('Content-Length', str(len(corps)))
        if nom:
            self.send_header('Content-Disposition', "inline; filename*=UTF-8''" + urllib.parse.quote(nom))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        chemin = urllib.parse.unquote(self.path.split('?')[0])
        if chemin == '/sw.js':
            return self.envoyer(SW_DEV, 'text/javascript; charset=utf-8')
        extra = LIVRES or BIBLIOTHEQUE
        if extra and chemin == '/adventures/index.json':
            entrees, _, _ = catalogue()
            return self.envoyer(json.dumps(entrees, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')
        if extra and chemin.startswith('/bibliotheque/'):
            n, _, ext = chemin[len('/bibliotheque/'):].partition('.')
            doc = catalogue()[2].get(n)
            f = doc and (doc[0] if ext == 'pdf' else doc[1] if ext == 'jpg' else None)
            if f and f.is_file():
                return self.envoyer(f.read_bytes(), 'application/pdf' if ext == 'pdf' else 'image/jpeg', f.name)
            self.send_error(404)
            return None
        if extra and chemin.startswith('/adventures/'):
            ident, _, reste = chemin[len('/adventures/'):].partition('/')
            livre = catalogue()[1].get(ident)
            if livre:
                corps = livre.fichier(reste)
                if corps is not None:
                    return self.envoyer(corps, self.guess_type(reste))
                self.send_error(404)
                return None
        return super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    print(f'Livre-Héros (dev) : http://localhost:{PORT}{"  (ouvert au réseau local)" if LAN else ""}  (Ctrl+C pour arrêter)', flush=True)
    if LIVRES or BIBLIOTHEQUE:
        entrees, livres, docs = catalogue()
        print(f'  bibliothèque : {len(livres)} livre(s) jouable(s), {len(docs)} document(s), {len(entrees)} carte(s)', flush=True)
    http.server.ThreadingHTTPServer(('' if LAN else '127.0.0.1', PORT), functools.partial(Dev, directory=str(RACINE))).serve_forever()
