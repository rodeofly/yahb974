#!/usr/bin/env python3
"""Convertit un livre-jeu extrait par OCR (paragraphes + renvois) en aventure Livre-Héros (.lhz).

Entrées (produites par l'analyse du texte) :
  paras.json   {"1": "texte du paragraphe", ...}
  edges.json   [[source, cible, type, libellé], ...]   type : choice | spell | shop | hidden
  places.json  {"places": [...], "assign": {"1": 0, ...}}   (facultatif)

Usage :
  python3 tools/graphe-vers-aventure.py donnees/ "Les Collines Maléfiques" sortie.lhz [texte-du-livre.txt]

Avec le texte du livre, le Livre des Formules est extrait (codes, descriptions, coûts) et les
listes de formules deviennent des blocs « formules » jouables.

Le résultat est à usage personnel : les combats et les tests restent écrits dans le texte
(ils ne sont pas convertis en blocs interactifs), seuls les renvois deviennent des choix.
"""
import json, re, sys, unicodedata, zipfile
from pathlib import Path

src, title, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
book_txt = Path(sys.argv[4]).read_text(encoding='utf-8') if len(sys.argv) > 4 else None
paras = {int(k): v for k, v in json.loads((src / 'paras.json').read_text()).items()}
edges = json.loads((src / 'edges.json').read_text())
places = json.loads((src / 'places.json').read_text()) if (src / 'places.json').exists() else None
edges = [e for e in edges if not (e[0] == 456 and e[1] == 12)]  # renvoi vers le livre suivant

BOUNDARY = re.compile(r"(?:[.!?;:]\s|\(|\bou\s(?=au\b)|,\s*soit\s|\bau\s*\d+\s)")

def clause(text, target):
    """Morceau de phrase qui précède « au N » : « Si vous voulez prendre à gauche »."""
    m = re.search(r"\bau\s*" + str(target) + r"\b", text)
    if not m:
        return None
    before = text[:m.start()]
    cuts = [0] + [x.end() for x in BOUNDARY.finditer(before)]
    strip = lambda c: re.sub(r"(?i)[,;]?\s*(il faudra pour cela vous rendre|rendez-?\s?vous|retournez|allez|vous rendrez)\s*(ensuite|maintenant|à présent|alors|dans ce cas|donc|directement|pour cela)?\s*$", "", c).strip(" ,;:(?")
    c = strip(before[cuts[-1]:])
    if len(c) < 4 and len(cuts) > 1:   # « Allina ? Rendez-vous au 238 » : la réponse est juste avant
        c = strip(before[cuts[-2]:cuts[-1]])
    if len(c) < 2:
        return None
    return c[0].upper() + c[1:]

def spell_book(text):
    """Livre des Formules : « ZAP Cette formule… Coût : 4 points d'ENDURANCE »."""
    if not text or 'Le Livre des Formules Magiques' not in text:
        return []
    b = re.sub(r"\n\d+\.\n", " ", text[text.find('Le Livre des Formules Magiques'):])
    codes = set(re.findall(r"(?<![A-Za-zÀ-ÿ])([A-Z]{3})(?![A-Za-zÀ-ÿ])", b))
    ents = list(re.finditer(r"(?<![A-Za-zÀ-ÿ])([A-Z]{3}) (?=[A-ZÀ-Ý][a-zà-ÿ])", b))
    book, seen = [], set()
    for j, m in enumerate(ents):
        code = m.group(1)
        if code in seen:
            continue
        end = ents[j + 1].start() if j + 1 < len(ents) else len(b)
        d = b[m.end():end].strip()
        c = re.search(r"Coût\s*:?\s*(\d+)", d)
        d = re.split(r"\s*Achevé d'imprimer", d)[0]
        book.append({"code": code, "name": code, "description": d[:600], "cost": int(c.group(1)) if c else 1})
        seen.add(code)
    for code in sorted(codes - seen):
        book.append({"code": code, "name": code, "description": "", "cost": 1})
    return sorted(book, key=lambda x: x["code"])

BOOK = spell_book(book_txt)
MORNING = re.compile(r"Vous vous levez de bonne heure|mangé hier|repas hier|mangé quelque chose hier|rien mangé dans la journée d'hier")

sections = {}
out_edges = {}
for s, t, k, label in edges:
    out_edges.setdefault(s, []).append((t, k, label))

for n, text in sorted(paras.items()):
    choices, spells = [], []
    for t, k, label in out_edges.get(n, []):
        if k == 'spell' and BOOK:
            spells.append({"code": label, "to": str(t)})
            continue
        if k == 'spell':
            txt = f"Formule {label}"
        elif k == 'shop':
            txt = f"Examiner : {label}"
        elif k == 'hidden':
            txt = f"({label})"
        else:
            txt = clause(text, t) or f"Rendez-vous au {t}"
        choices.append({"text": txt, "to": str(t)})
    blocks = [{"type": "spells", "label": "Lancer une formule", "costInText": True, "options": spells}] if spells else []
    ending = None
    if not choices and not blocks:
        ending = 'victory' if n == 456 else 'death'
    on_enter = [{"op": "newDay"}] if MORNING.search(text[:400]) else []
    sec = {"title": "", "text": text, "image": None, "place": "", "onEnter": on_enter, "blocks": blocks, "choices": choices, "ending": ending}
    if places:
        sec["place"] = places["places"][places["assign"][str(n)]]
    sections[str(n)] = sec

adv = {
    "format": "livre-heros/1",
    "id": re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFD", title).encode("ascii", "ignore").decode().lower()).strip("-")[:40] or "livre",
    "meta": {"title": title, "author": "", "description": "Import automatique depuis le texte du livre (usage personnel).", "cover": None, "version": 1},
    "rules": {
        "stats": [{"id": "habilete", "label": "Habileté", "roll": "1d6+6"}, {"id": "endurance", "label": "Endurance", "roll": "2d6+12"}, {"id": "chance", "label": "Chance", "roll": "1d6+6"}],
        "classes": [{"id": "guerrier", "label": "Guerrier", "description": "", "rolls": {}, "items": []},
                    {"id": "sorcier", "label": "Sorcier", "description": "Habileté plus faible, accès aux formules.", "rolls": {"habilete": "1d6+4"}, "items": []}],
        "gold": "20", "provisions": 2, "meal": {"stat": "endurance", "heal": 2},
        "combat": {"skill": "habilete", "health": "endurance", "damage": 2, "luck": "chance", "fleeDamage": 2},
        "startItems": [], "allowBack": True,
        # Le texte gère lui-même la faim et le coût des formules : le moteur compte seulement les jours.
        "time": {"enabled": True, "mealRequired": False, "stat": "endurance", "penalty": 3},
        "spells": {"enabled": bool(BOOK), "stat": "endurance", "casters": ["sorcier"], "typeCode": False, "unknownCost": 0, "book": BOOK},
    },
    "items": {}, "start": "1", "sections": sections,
}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("adventure.json", json.dumps(adv, ensure_ascii=False, indent=1))
print(f"{out} : {len(sections)} paragraphes, {sum(len(s['choices']) for s in sections.values())} choix, "
      f"{sum(1 for s in sections.values() if s['blocks'])} listes de formules, {len(BOOK)} formules, "
      f"{sum(1 for s in sections.values() if s['onEnter'])} matins")
