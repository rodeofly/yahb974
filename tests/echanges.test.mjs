import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newAdventure, normalizeAdventure, targetsOf } from '../js/core/rules.js';
import { validate } from '../js/core/validate.js';
import {
  toTwee, toTwineHTML, toInk, toJSON, fromTwee, fromTwineHTML, parseStory, detectFormat, twineStories,
  cleanPassage, parseLink, ifidOf, countLinks, mergeAdventures, decodeEntities, defaultPrefix,
} from '../js/plugins/echanges/core.js';

const tour = () => normalizeAdventure(JSON.parse(readFileSync(new URL('../adventures/la-tour-de-brume/adventure.json', import.meta.url), 'utf8')));

/** Petite aventure qui utilise tous les blocs, des conditions et des caractères délicats. */
function sample() {
  const a = newAdventure('Le Gué {des} # Brumes');
  a.id = 'le-gue-test';
  a.meta.author = 'Alice';
  a.items = { cle: { name: 'Clé d’argent' }, corde: { name: 'Corde' } };
  a.rules.startItems = ['corde'];
  a.rules.gold = '2d6';
  a.sections = {
    '1': { title: 'Le gué', text: 'Le _courant_ est **fort**. Un panneau dit : « (voir: page 3) » et $5 [sic] // fin.\n\n- première ligne', onEnter: [{ op: 'give', item: 'cle' }, { op: 'flag', flag: 'gue-vu' }, { op: 'stat', stat: 'endurance', add: -1 }],
      choices: [{ text: 'Traverser -> vite', to: '2', if: { has: 'cle' } }, { text: 'Payer le passeur', to: '3', if: { gold: true, gte: 3 }, effects: [{ op: 'gold', add: -3 }] }, { text: 'Si fort', to: '3', if: { stat: 'habilete', gte: 10 } }] },
    '2': { text: 'Test et dés.', blocks: [{ type: 'test', stat: 'chance', success: '4', failure: '5' }, { type: 'roll', dice: '1d6', table: [{ min: 1, max: 3, to: '4' }, { min: 4, max: 6, to: '5', text: 'Aïe' }] }] },
    '3': { text: 'Un troll.', blocks: [{ type: 'combat', enemies: [{ name: 'Troll', skill: 9, health: 10 }], win: '4', flee: '5' }, { type: 'shop', offers: [{ item: 'corde', price: 2 }] }], choices: [{ text: 'Revenir', to: '1', if: { all: [{ visited: '2' }, { not: { flag: 'gue-vu' } }] } }] },
    '4': { text: 'Vous avez traversé.', ending: 'victory' },
    '5': { text: 'Le courant vous emporte.', ending: 'death' },
    '6b': { text: 'Un paragraphe au numéro inhabituel.', choices: [{ text: 'Retour', to: '1' }] },
  };
  return normalizeAdventure(a);
}

test('ifid : UUID v4 stable dérivé de l’identifiant, ou celui de Twine', () => {
  const a = sample();
  const id = ifidOf(a);
  assert.match(id, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  assert.equal(ifidOf(sample()), id, 'même aventure, même IFID');
  assert.notEqual(ifidOf({ ...a, id: 'autre' }), id);
  assert.equal(ifidOf({ ...a, meta: { ...a.meta, ifid: 'd674c58c-defa-4f70-b7a2-27742230c0fc' } }), 'D674C58C-DEFA-4F70-B7A2-27742230C0FC');
});

test('Twee : en-têtes, StoryData, un passage par paragraphe, liens et blocs traduits', () => {
  const tw = toTwee(sample());
  assert.match(tw, /^:: StoryTitle\nLe Gué \{des\} # Brumes\n/);
  const data = JSON.parse(/:: StoryData\n([\s\S]*?)\n\n\n/.exec(tw)[1]);
  assert.equal(data.format, 'Harlowe');
  assert.match(data['format-version'], /^3\.3\.\d+$/);
  assert.equal(data.start, '1');
  assert.equal(data.ifid, ifidOf(sample()));
  assert.equal((tw.match(/^:: (?!Story)/gm) || []).length, 6);
  assert.match(tw, /^:: 4 \[victoire\] \{"position"/m);
  assert.match(tw, /^:: 5 \[mort\]/m);
  assert.match(tw, /\[\[Chanceux->4\]\]\n\[\[Malchanceux->5\]\]/);
  assert.match(tw, /\[\[4 à 6 : Aïe->5\]\]/);
  assert.match(tw, /\[\[Vous êtes vainqueur->4\]\]/);
  assert.match(tw, /\[\[Traverser → vite->2\]\] <!-- Condition : vous possédez : Clé d’argent -->/, 'condition en commentaire, flèche du texte neutralisée');
  assert.match(tw, /\[\[Payer le passeur->3\]\] <!-- Condition : .* — En choisissant : Retirez 3 pièces d’or/);
  assert.match(tw, /\*italique\*|\*courant\*/);
  assert.match(tw, /`\(`voir: page 3\)/, 'macro Harlowe apparente protégée');
  assert.match(tw, /`\$`5|\$5/);
  assert.equal((tw.match(/\[\[/g) || []).length, countLinks(sample()));
});

test('Twee : aller-retour (même nombre de paragraphes et de liens, départ, fins, titres, texte)', () => {
  for (const adv of [sample(), tour()]) {
    const warnings = [];
    const back = fromTwee(toTwee(adv), { warnings });
    assert.equal(Object.keys(back.sections).length, Object.keys(adv.sections).length, adv.meta.title);
    assert.equal(countLinks(back), countLinks(adv), `liens de ${adv.meta.title}`);
    assert.deepEqual(Object.keys(back.sections).sort(), Object.keys(adv.sections).sort(), 'numéros gardés (6b compris)');
    assert.equal(back.start, adv.start);
    assert.equal(back.meta.title, adv.meta.title);
    assert.equal(back.meta.ifid, ifidOf(adv), 'IFID conservé');
    for (const [id, sec] of Object.entries(adv.sections)) {
      assert.equal(back.sections[id].ending, sec.ending, `fin du ${id}`);
      assert.equal(back.sections[id].title, sec.title || '', `titre du ${id}`);
      const targets = targetsOf(sec).map(t => t.to).sort();
      assert.deepEqual(back.sections[id].choices.map(c => c.to).sort(), targets, `destinations du ${id}`);
    }
    assert.ok(!warnings.some(w => /n’existe pas/.test(w)), warnings.join('\n'));
  }
  const back = fromTwee(toTwee(sample()));
  const t1 = back.sections['1'].text;
  assert.ok(t1.startsWith('Le *courant* est **fort**. Un panneau dit : « (voir: page 3) » et $5 [sic] // fin.'), t1);
  assert.match(t1, /première ligne/);
  assert.equal(back.sections['1'].choices[0].text, 'Traverser → vite');
  assert.equal(back.sections['2'].choices.find(c => c.to === '4').text, 'Chanceux');
  assert.equal(validate(back).filter(p => p.level === 'error').length, 0);
});

test('Twine 2 : l’archive exportée se relit (sans DOM) et contient les attributs attendus', () => {
  const adv = sample();
  const h = toTwineHTML(adv);
  assert.match(h, /^<tw-storydata name="Le Gué \{des\} # Brumes" startnode="1" creator="Livre-Héros" creator-version="[\d.]+" format="Harlowe" format-version="3\.3\.\d+" ifid="[0-9A-F-]{36}"/);
  assert.equal((h.match(/<tw-passagedata /g) || []).length, 6);
  assert.match(h, /<tw-passagedata pid="\d+" name="5" tags="mort" position="\d+,\d+" size="100,100">/);
  assert.ok(!/<tw-passagedata[^>]*>[^<]*<(?!\/tw-passagedata)/.test(h), 'texte des passages échappé');
  assert.deepEqual(twineStories(h).map(s => [s.name, s.passages]), [['Le Gué {des} # Brumes', 6]]);
  const back = fromTwineHTML(h);
  assert.equal(Object.keys(back.sections).length, 6);
  assert.equal(countLinks(back), countLinks(adv));
  assert.equal(back.sections['4'].ending, 'victory');
  assert.equal(back.sections['1'].title, 'Le gué');
  // Histoire publiée : le code du format d'histoire, placé avant, peut citer « <tw-storydata » sans tromper l'import.
  const published = `<html><head><script>var tpl = '<tw-storydata name="piège">';</script></head><body>${h}</body></html>`;
  assert.deepEqual(twineStories(published).map(s => s.name), ['Le Gué {des} # Brumes']);
  assert.equal(countLinks(fromTwineHTML(published)), countLinks(adv));
});

/** Archive Twine 2 écrite « à la main », comme en produit Twine (Harlowe, macros, entités, étiquettes). */
const ARCHIVE = `<tw-storydata name="La Grotte &amp; le Dragon" startnode="2" creator="Twine" creator-version="2.10.0" format="Harlowe" format-version="3.3.9" ifid="1A2B3C4D-1111-4222-8333-444455556666" options="" tags="" zoom="1" hidden><style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">tw-story { color: red; }</style><script role="script" id="twine-user-script" type="text/twine-javascript">window.x = 1;</script><tw-passagedata pid="1" name="Entrée de la grotte" tags="" position="400,100" size="100,100">(set: $torche to true)Il fait sombre&#39;ici. (if: $torche)[Votre torche éclaire une &quot;fresque&quot;.](else:)[Vous ne voyez rien.]
''Attention'' : //le sol glisse//.
[[Avancer dans le noir-&gt;Salle du dragon]]
[[Retour&lt;-Revenir au soleil]]
|porte&gt;[Une porte grince.]
(link-goto: &quot;Fouiller les rochers&quot;, &quot;Trésor&quot;)</tw-passagedata><tw-passagedata pid="2" name="Début" tags="" position="100,100" size="100,100">Vous arrivez devant une montagne. <!-- note de l'auteur -->
[[Entrer->Entrée de la grotte]]
Vous pouvez aussi [[rentrer chez vous|Retour]] tout de suite.</tw-passagedata><tw-passagedata pid="3" name="Salle du dragon" tags="death combat" position="700,100" size="100,100">Le dragon vous dévore. /* commentaire */</tw-passagedata><tw-passagedata pid="4" name="Retour" tags="" position="400,300" size="100,100">Vous rentrez bredouille.
(goto: "Début")</tw-passagedata><tw-passagedata pid="5" name="Trésor" tags="victoire" position="700,300" size="100,100">&lt;img src=&quot;https://exemple.org/tresor.png&quot; alt=&quot;&quot;&gt;Un coffre plein d'or !</tw-passagedata><tw-passagedata pid="6" name="Notes" tags="Twine.private" position="0,0" size="100,100">Ne pas importer.</tw-passagedata></tw-storydata>`;

test('import d’une archive Twine 2 (Harlowe) : numérotation, liens, fins, macros retirées', () => {
  assert.equal(detectFormat(ARCHIVE), 'twine2');
  const warnings = [];
  const adv = fromTwineHTML(`<html><body>${ARCHIVE}</body></html>`, { warnings, id: 'grotte' });
  assert.equal(adv.id, 'grotte');
  assert.equal(adv.meta.title, 'La Grotte & le Dragon');
  assert.equal(adv.meta.ifid, '1A2B3C4D-1111-4222-8333-444455556666');
  assert.equal(Object.keys(adv.sections).length, 5, 'passage privé ignoré');
  assert.equal(adv.start, '1');
  const s1 = adv.sections['1'];
  assert.equal(s1.title, 'Début');
  assert.equal(s1.text, 'Vous arrivez devant une montagne.\nVous pouvez aussi rentrer chez vous tout de suite.');
  assert.deepEqual(s1.choices.map(c => [c.text, adv.sections[c.to].title]), [['Entrer', 'Entrée de la grotte'], ['rentrer chez vous', 'Retour']]);
  const grotte = adv.sections[s1.choices[0].to];
  assert.equal(grotte.text, 'Il fait sombre\'ici. Votre torche éclaire une "fresque".Vous ne voyez rien.\n**Attention** : *le sol glisse*.\nUne porte grince.');
  assert.deepEqual(grotte.choices.map(c => [c.text, adv.sections[c.to].title]), [['Avancer dans le noir', 'Salle du dragon'], ['Revenir au soleil', 'Retour'], ['Fouiller les rochers', 'Trésor']]);
  const dragon = adv.sections[grotte.choices[0].to];
  assert.equal(dragon.ending, 'death');
  assert.equal(dragon.text, 'Le dragon vous dévore.');
  const tresor = adv.sections[grotte.choices[2].to];
  assert.equal(tresor.ending, 'victory');
  assert.equal(tresor.image, 'https://exemple.org/tresor.png');
  assert.equal(tresor.text, 'Un coffre plein d\'or !');
  const retour = adv.sections[s1.choices[1].to];
  assert.deepEqual(retour.choices, [{ text: 'Continuer', to: '1' }], '(goto:) devient « Continuer »');
  assert.equal(validate(adv).filter(p => p.level === 'error').length, 0);
  assert.deepEqual(warnings, []);
});

test('import Twee SugarCube et Twine 1 : macros <<…>> retirées, texte narratif gardé', () => {
  const twee = `:: StoryTitle
Le Marché

:: StoryData
{ "ifid": "0B7A5A5C-6C43-4BD6-8E0E-8C9A9B5F3F10", "format": "SugarCube", "format-version": "2.37.3", "start": "Place" }

:: StoryInit
<<set $or to 5>>

:: Place [marché] {"position":"100,100"}
<<if $or gt 3>>Vous avez de quoi acheter.<</if>> Vous avez $or pièces.
!Au marché
<<link "Acheter une pomme" "Pomme">><<set $or -= 1>><</link>>
[[Partir|Route][$depart to true]]
[[Nulle part]]

:: Pomme
@@color:red;Une pomme rouge.@@ <<goto "Route">>

:: Route [death]
La route est longue.`;
  const warnings = [];
  const adv = fromTwee(twee, { warnings });
  assert.equal(adv.meta.title, 'Le Marché');
  assert.equal(Object.keys(adv.sections).length, 3, 'StoryInit ignoré');
  const place = adv.sections['1'];
  assert.equal(place.title, 'Place');
  assert.equal(place.text, 'Vous avez de quoi acheter. Vous avez pièces.\n### Au marché');
  assert.deepEqual(place.choices.map(c => c.text), ['Acheter une pomme', 'Partir', 'Nulle part']);
  assert.equal(place.choices[2].to, 'Nulle part', 'lien cassé conservé tel quel');
  assert.ok(warnings.some(w => /Nulle part/.test(w)));
  const pomme = adv.sections[place.choices[0].to];
  assert.equal(pomme.text, 'Une pomme rouge.');
  assert.equal(adv.sections[pomme.choices[0].to].ending, 'death');

  const t1 = `<html><body><div id="storeArea" data-size="3"><div tiddler="StoryTitle" tags="">Vieux conte</div><div tiddler="Start" tags="" twine-position="10,10">Il était une fois.\\n[[Suite]]</div><div tiddler="Suite" tags="fin victoire">Fin \\s heureuse.</div></div></body></html>`;
  assert.equal(detectFormat(t1), 'twine1');
  const old = fromTwineHTML(t1);
  assert.equal(old.meta.title, 'Vieux conte');
  assert.deepEqual(Object.values(old.sections).map(s => s.text), ['Il était une fois.', 'Fin \\ heureuse.']);
  assert.equal(old.sections['2'].ending, 'victory');
});

test('outils d’import : liens, entités, nettoyage', () => {
  assert.deepEqual(parseLink('a->b->c'), { text: 'a->b', target: 'c' });
  assert.deepEqual(parseLink('c<-a<-b'), { text: 'a<-b', target: 'c' });
  assert.deepEqual(parseLink('Aller|Nord][$x to 1'), { text: 'Aller', target: 'Nord' });
  assert.deepEqual(parseLink('Nord'), { text: 'Nord', target: 'Nord' });
  assert.equal(decodeEntities('&lt;b&gt; &amp;amp; &#233;t&#xE9; &eacute; &inconnu;'), '<b> &amp; été é &inconnu;');
  const c = cleanPassage('`[[pas un lien]]` (print: $x) texte');
  assert.equal(c.text, '[[pas un lien]] texte');
  assert.equal(c.links.length, 0);
  assert.throws(() => parseStory('bonjour'), /format non reconnu/);
  assert.equal(detectFormat(JSON.stringify(sample())), 'json');
  assert.equal(parseStory(toJSON(sample())).sections['6b'].text, 'Un paragraphe au numéro inhabituel.');
});

/** Vérifications de forme d'un script ink (le compilateur inklecate n'est pas disponible hors ligne). */
function checkInk(ink) {
  const knots = new Set([...ink.matchAll(/^=== (\w+) ===$/gm)].map(m => m[1]));
  const vars = new Set([...ink.matchAll(/^VAR (\w+) = /gm)].map(m => m[1]));
  const problems = [];
  for (const m of ink.matchAll(/(?<!\\)-> ?(\w+)/g)) if (!knots.has(m[1]) && !['END', 'DONE'].includes(m[1])) problems.push(`renvoi vers ${m[1]}`);
  const logic = [...ink.matchAll(/^\s*~ (.*)$/gm), ...ink.matchAll(/^[+*] \{([^}]*)\}/gm), ...ink.matchAll(/^\{ (.*):$/gm)].map(m => m[1]);
  const known = new Set([...vars, ...knots, 'MAX', 'RANDOM', 'and', 'or', 'not', 'true', 'false']);
  for (const expr of logic) for (const id of expr.replace(/"[^"]*"/g, '').match(/[A-Za-z_]\w*/g) || []) if (!known.has(id)) problems.push(`identifiant inconnu ${id}`);
  let knot = false;
  for (const raw of ink.split('\n')) {
    const line = raw.trim();
    if (/^=== \w+ ===$/.test(line)) { knot = true; continue; }
    if (!line || /^(\/\/|#|VAR |~ |[+*] |-> |\{ .*:$|\}$)/.test(line)) continue;
    if (!knot) { problems.push(`contenu hors nœud : ${line}`); continue; }
    const bare = line.replace(/\\./g, '');
    if (/[{}|#[\]]|->|<-|\/\/|^[*+\-=~]/.test(bare)) problems.push(`caractère spécial non échappé : ${line}`);
  }
  return { knots, vars, problems };
}

test('ink : nœuds, choix, variables et conditions bien formés', () => {
  const adv = sample();
  const ink = toInk(adv);
  const { knots, vars, problems } = checkInk(ink);
  assert.deepEqual(problems, []);
  assert.deepEqual([...knots], ['p1', 'p2', 'p3', 'p4', 'p5', 'p_6b']);
  assert.ok(vars.has('obj_cle') && vars.has('obj_corde') && vars.has('marque_gue_vu') && vars.has('pieces_or'));
  assert.match(ink, /^VAR obj_corde = 1 /m, 'objet de départ');
  assert.match(ink, /^~ pieces_or = RANDOM\(1, 6\) \+ RANDOM\(1, 6\)$/m);
  assert.match(ink, /^-> p1$/m);
  assert.match(ink, /^\+ \{obj_cle >= 1\} \[Traverser -\\> vite\] -> p2$/m, 'condition simple traduite');
  assert.match(ink, /^\+ \{pieces_or >= 3\} \[Payer le passeur\]\n {4}~ pieces_or = MAX\(pieces_or - 3, 0\)\n {4}-> p3$/m, 'effet du choix');
  assert.match(ink, /^\/\/ Condition non traduite : votre HABILETÉ est de 10 ou plus\n\+ \[Si fort\] -> p3$/m);
  assert.match(ink, /^\+ \{\(p2 > 0\) and \(not marque_gue_vu\)\} \[Revenir\] -> p1$/m, 'pas de parenthèses autour d’un nom seul (ink les lirait comme une liste)');
  assert.match(ink, /^\+ \[Chanceux\] -> p4$/m);
  assert.match(ink, /^~ obj_cle = obj_cle \+ 1$/m);
  assert.match(ink, /^Vous perdez 1 point d'ENDURANCE\.$/m);
  assert.match(ink, /=== p4 ===\n# fin: victoire\nVous avez traversé\.\n-> END/);
  assert.match(ink, /Un panneau dit : « \(voir: page 3\) » et \$5 \\\[sic\\\] \\\/\\\/ fin\./);
  assert.match(ink, /^\\- première ligne$/m);
  assert.doesNotMatch(ink, /^\* \[/m, 'choix persistants par défaut');
  assert.match(toInk(adv, { sticky: false }), /^\* \[Chanceux\] -> p4$/m);
  const big = checkInk(toInk(tour()));
  assert.deepEqual(big.problems, []);
  assert.equal(big.knots.size, Object.keys(tour().sections).length);
});

/** Deux aventures écrites séparément, qui se recoupent (co-écriture). */
function coauthor() {
  const base = sample();
  const b = newAdventure('La Forêt des Murmures');
  b.id = 'foret';
  b.meta.author = 'Bob';
  b.meta.cover = 'images/cover.webp';
  b.items = { cle: { name: 'Clé de fer' }, corde: structuredClone(base.items.corde), gland: { name: 'Gland', use: [{ op: 'give', item: 'cle' }] } };
  b.companions = { kaya: { name: 'Kaya', skill: 8, health: 6 } };
  b.rules.counters = [{ id: 'temps', label: 'Temps', start: 6 }];
  b.rules.stats = [...b.rules.stats, { id: 'magie', label: 'Magie', roll: '1d6' }];
  b.rules.classes = [...b.rules.classes, { id: 'druide', label: 'Druide', rolls: {}, items: ['cle'] }];
  b.achievements = [{ id: 'foret', label: 'Sorti de la forêt' }];
  b.start = '1';
  b.sections = {
    '1': { text: 'La forêt.', image: 'images/p1.webp', onEnter: [{ op: 'companion', companion: 'kaya', action: 'join' }, { op: 'counter', counter: 'temps', add: -1 }],
      choices: [{ text: 'Ouvrir la grille', to: '2', if: { has: 'cle' } }, { text: 'Grimper', to: '3', if: { has: 'corde' } }, { text: 'Avec Kaya', to: '3', if: { companion: 'kaya' } }] },
    '2': { text: 'Une clairière.', blocks: [{ type: 'test', stat: 'chance', success: '3', failure: '1' }], choices: [{ text: 'Revenir', to: '1', if: { visited: '3' } }] },
    '3': { text: 'La sortie.', ending: 'victory', onEnter: [{ op: 'flag', flag: 'gue-vu' }, { op: 'counter', counter: 'temps', set: 0 }] },
  };
  const other = normalizeAdventure(b);
  base.companions = { kaya: { name: 'Kaya', skill: 9, health: 8 } };
  base.rules.counters = [{ id: 'temps', label: 'Temps', start: 6 }];
  base.sections['1'].image = 'images/p1.webp';
  return { base, other };
}

test('fusion : numéros à la suite, identifiants préfixés, références réécrites, rapport', () => {
  const { base, other } = coauthor();
  const frozen = JSON.stringify(base), frozenB = JSON.stringify(other);
  const { adventure: m, mapping, report, assetMap } = mergeAdventures(base, other, { link: { from: '3', text: 'Entrer dans la forêt' } });
  assert.equal(JSON.stringify(base), frozen, 'la base n’est pas modifiée');
  assert.equal(JSON.stringify(other), frozenB, 'l’autre aventure n’est pas modifiée');
  assert.deepEqual(mapping, { 1: '6', 2: '7', 3: '8' }, '6b n’est pas un nombre : la suite commence au 6');
  assert.equal(report.sections.start, '6');
  assert.equal(Object.keys(m.sections).length, 9);
  assert.equal(m.start, '1', 'le départ reste celui de la base');
  // Objets : « cle » existe avec une autre définition → préfixé ; « corde » identique → partagé ; « gland » nouveau.
  const prefix = defaultPrefix(other);
  assert.equal(prefix, 'foret-');
  assert.equal(m.items.cle.name, 'Clé d’argent');
  assert.equal(m.items['foret-cle'].name, 'Clé de fer');
  assert.ok(!m.items['foret-corde']);
  assert.ok(m.items.gland);
  assert.deepEqual(m.items.gland.use, [{ op: 'give', item: 'foret-cle' }]);
  assert.deepEqual(report.items.map(e => [e.from, e.to, e.status]), [['cle', 'foret-cle', 'renamed'], ['corde', 'corde', 'shared'], ['gland', 'gland', 'added']]);
  const s7 = m.sections['6'];
  assert.deepEqual(s7.choices.map(c => [c.to, c.if]), [['7', { has: 'foret-cle' }], ['8', { has: 'corde' }], ['8', { companion: 'foret-kaya' }]]);
  assert.deepEqual(m.sections['7'].blocks[0], { type: 'test', stat: 'chance', success: '8', failure: '6' });
  assert.deepEqual(m.sections['7'].choices[0].if, { visited: '8' });
  // Compagnons et compteurs.
  assert.equal(m.companions.kaya.skill, 9);
  assert.equal(m.companions['foret-kaya'].skill, 8);
  assert.deepEqual(s7.onEnter[0], { op: 'companion', companion: 'foret-kaya', action: 'join' });
  assert.deepEqual(m.rules.counters.map(c => c.id), ['temps'], 'compteur identique partagé');
  assert.deepEqual(s7.onEnter[1], { op: 'counter', counter: 'temps', add: -1 });
  // Règles : caractéristique et classe ajoutées (objets de la classe réécrits), données de greffon reprises.
  assert.ok(m.rules.stats.some(s => s.id === 'magie'));
  assert.deepEqual(m.rules.classes.find(c => c.id === 'druide').items, ['foret-cle']);
  assert.deepEqual(m.achievements, [{ id: 'foret', label: 'Sorti de la forêt' }]);
  // Données de greffon déjà présentes dans la base : seuls les éléments de l'autre aventure sont ajoutés,
  // et les images de la base qu'elles citent ne sont pas renommées.
  const withTrophy = structuredClone(base);
  withTrophy.achievements = [{ id: 'gue', label: 'Traversé', image: 'images/p1.webp' }];
  const m2 = mergeAdventures(withTrophy, other).adventure;
  assert.deepEqual(m2.achievements, [{ id: 'gue', label: 'Traversé', image: 'images/p1.webp' }, { id: 'foret', label: 'Sorti de la forêt' }]);
  // Images : chemin déjà pris dans la base → renommé ; la couverture de l'autre aventure n'est pas reprise.
  assert.deepEqual(assetMap, { 'images/p1.webp': 'images/foret-p1.webp' });
  assert.equal(s7.image, 'images/foret-p1.webp');
  assert.equal(m.sections['1'].image, 'images/p1.webp');
  // Lien vers la partie ajoutée, auteurs, marques partagées.
  assert.deepEqual(m.sections['3'].choices.at(-1), { text: 'Entrer dans la forêt', to: '6' });
  assert.equal(m.meta.author, 'Alice et Bob');
  assert.deepEqual(report.flags.common, ['gue-vu']);
  assert.ok(report.lines.some(l => l.kind === 'rename' && /Clé de fer.*foret-cle/.test(l.text)));
  assert.ok(report.lines[0].text.startsWith('3 paragraphes ajoutés, numérotés de 6 à 8.'));
  assert.equal(validate(m).filter(p => p.level === 'error').length, 0);
});

test('fusion : options (préfixe, départ de numérotation, pas de partage, marques préfixées) et avertissements', () => {
  const { base, other } = coauthor();
  const r = mergeAdventures(base, other, { prefix: 'Bob', startAt: 100, shareIdentical: false, prefixFlags: true, takenAssets: ['images/bob-p1.webp'] });
  assert.deepEqual(Object.values(r.mapping), ['100', '101', '102']);
  assert.ok(r.adventure.items['bob-corde'] && r.adventure.items['bob-cle']);
  assert.deepEqual(r.adventure.rules.counters.map(c => c.id), ['temps', 'bob-temps']);
  assert.deepEqual(r.adventure.sections['102'].onEnter[0], { op: 'flag', flag: 'bob-gue-vu' });
  assert.equal(r.assetMap['images/p1.webp'], 'images/bob-2-p1.webp', 'chemin libre même face aux fichiers déjà stockés');
  assert.ok(r.report.lines.some(l => l.kind === 'warning' && /mène encore au 100/.test(l.text)));
  const holes = mergeAdventures(base, other, { startAt: 2 });
  assert.deepEqual(Object.values(holes.mapping), ['6', '7', '8'], 'numéros déjà pris sautés');
  const bad = mergeAdventures(base, other, { link: { from: '999' } });
  assert.ok(bad.report.warnings.some(w => /999/.test(w)));
  // Fusionner une aventure avec elle-même : tout est partagé, les paragraphes sont copiés à la suite.
  const self = mergeAdventures(base, base);
  assert.equal(Object.keys(self.adventure.sections).length, 12);
  assert.deepEqual(Object.keys(self.adventure.items).sort(), Object.keys(base.items).sort());
  assert.equal(validate(self.adventure).filter(p => p.level === 'error').length, 0);
  // Une histoire Twine se fusionne aussi.
  const tw = mergeAdventures(base, fromTwineHTML(ARCHIVE));
  assert.equal(tw.report.sections.count, 5);
  assert.equal(validate(tw.adventure).filter(p => p.level === 'error').length, 0);
});

test('fusion : les règles Zefor et l’équipement de l’autre aventure ne se perdent pas en silence', async () => {
  await import('../js/plugins/equipement/core.js');
  await import('../js/plugins/zefor/core.js');
  const base = sample();
  const other = normalizeAdventure({ ...newAdventure('Autre'), id: 'autre', sections: { '1': { text: 'x', ending: 'victory' } } });
  other.rules.zefor = { ...other.rules.zefor, codeKey: 'CLE-B', origin: 'https://zefor.maths974.fr', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } };
  other.rules.equipment = { ...(other.rules.equipment || {}), enabled: true };
  const r = mergeAdventures(base, other);
  assert.equal(r.adventure.rules.zefor.codeKey, 'CLE-B');
  assert.equal(r.adventure.rules.zefor.origin, 'https://zefor.maths974.fr');
  assert.deepEqual(r.adventure.rules.zefor.publicKeyJwk, other.rules.zefor.publicKeyJwk);
  assert.ok(r.report.warnings.some(w => /équipement/.test(w)));
  const withKey = sample();
  withKey.rules.zefor = { ...withKey.rules.zefor, codeKey: 'CLE-A' };
  const r2 = mergeAdventures(withKey, other);
  assert.equal(r2.adventure.rules.zefor.codeKey, 'CLE-A');
  assert.ok(r2.report.warnings.some(w => /règles Zefor/.test(w) && /clé des codes personnels/.test(w)));
});
