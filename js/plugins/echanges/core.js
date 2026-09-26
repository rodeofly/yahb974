// Greffon « échanges » — moteur pur (aucun DOM, testable dans Node).
// Passerelles vers d'autres outils d'écriture interactive, et fusion de deux aventures (co-écriture).
//
//   Export : toTwee(adv)       Twee 3 (Twine 2.6+, Tweego), format d'histoire Harlowe 3.3
//            toTwineHTML(adv)  archive de bibliothèque Twine 2 (<tw-storydata>…), « Bibliothèque › Importer »
//            toInk(adv)        script ink (Inky, Inkle) : objets et marques en VAR, conditions simples en {…}
//            toJSON(adv)       adventure.json seul
//   Import : fromTwee(text), fromTwineHTML(html) (Twine 2 et Twine 1, sans DOM), parseStory(text)
//   Fusion : mergeAdventures(base, other, options) → { adventure, mapping, report, assetMap }
//
// Twine et ink n'ont ni caractéristiques ni dés : comme dans la version imprimable, les tests, combats et
// tables de dés deviennent une phrase suivie de liens (« Chanceux », « Malchanceux »…) que le lecteur suit
// selon son propre jet. Voir docs/plugins/echanges.md.

import { normalizeAdventure, newSection, targetsOf, describeCondition, describeEffect, statLabel, itemName, slug, FORMAT, DEFAULT_RULES } from '../../core/rules.js';
import { remap } from '../../core/validate.js';
import { ext, findCondition } from '../../core/plugins.js';
import { parseDice } from '../../core/dice.js';

export const HARLOWE_VERSION = '3.3.9';
export const CREATOR = 'Livre-Héros';

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const sortIds = ids => [...ids].sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || String(a).localeCompare(String(b)));
const UP = (adv, id) => statLabel(adv, id).toUpperCase();
const plural = (n, one, many) => `${n} ${Math.abs(n) > 1 ? many : one}`;
const de = label => (/^[aeiouyàâäéèêëîïôöùûüh]/i.test(label) ? `d'${label}` : `de ${label}`);
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const escHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
/** Une phrase : point final ajouté si le texte ne se termine pas déjà par une ponctuation. */
const sentence = s => { const t = oneLine(s); return !t || /[.!?…:;]$/.test(t) ? t : `${t}.`; };

/** Représentation canonique (clés triées) pour comparer deux définitions. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Parcourt tous les objets d'un arbre JSON (profondeur d'abord). */
function walk(node, fn) {
  if (Array.isArray(node)) node.forEach(v => walk(v, fn));
  else if (isObj(node)) { fn(node); Object.values(node).forEach(v => walk(v, fn)); }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', uuml: 'ü', oelig: 'œ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç', copy: '©', times: '×', minus: '−', middot: '·', bull: '•' };
/** Décode les entités HTML (nommées courantes et numériques). */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return own(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

/** Petit hachage 128 bits (cyrb128), stable d'une exécution à l'autre. */
function hash128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** IFID (identifiant de fiction interactive, UUID v4 en majuscules) : celui de l'histoire Twine d'origine, sinon dérivé de adv.id. */
export function ifidOf(adv) {
  if (UUID.test(adv?.meta?.ifid || '')) return adv.meta.ifid.toUpperCase();
  const h = hash128(`livre-heros:${adv?.id ?? ''}`).split('');
  h[12] = '4';                                   // version 4
  h[16] = '89ab'[parseInt(h[16], 16) & 3];       // variante RFC 4122
  const s = h.join('').toUpperCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Texte brut d'un morceau de HTML (pour les blocs de greffons imprimables). */
export function htmlToText(h) {
  return decodeEntities(String(h ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|tr|div|h\d)>/gi, '\n').replace(/<td\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ */
/* Conditions et effets en phrases de livre (comme la version imprimée) */
/* ------------------------------------------------------------------ */

export function condText(c, adv) {
  if (!c) return '';
  if (c.all) return c.all.map(x => condText(x, adv)).filter(Boolean).join(' et ');
  if (c.any) return c.any.map(x => condText(x, adv)).filter(Boolean).join(' ou ');
  const plug = findCondition(c);
  if (plug) { try { return plug.print?.(c, adv) ?? plug.describe(c, adv); } catch { return ''; } }
  if (c.not) {
    const x = c.not;
    if (x.has) return `vous ne possédez pas : ${itemName(adv, x.has)}`;
    if (x.flag) return `vous n'avez pas noté le mot-clé « ${x.flag} »`;
    if (x.visited) return `vous n'êtes jamais passé par le ${x.visited}`;
    return `pas (${condText(x, adv)})`;
  }
  if (c.has) return `vous possédez : ${itemName(adv, c.has)}${c.qty > 1 ? ` (×${c.qty})` : ''}`;
  if (c.flag) return `vous avez noté le mot-clé « ${c.flag} »`;
  if (c.visited) return `vous êtes déjà passé par le ${c.visited}`;
  if (c.class) return `vous êtes ${adv.rules.classes?.find(x => x.id === c.class)?.label || c.class}`;
  if (c.caster !== undefined) return c.caster ? 'vous savez lancer des formules' : 'vous ne savez pas lancer de formules';
  if (c.ate !== undefined) return c.ate ? 'vous avez mangé aujourd’hui' : 'vous n’avez pas encore mangé aujourd’hui';
  if (c.gold !== undefined && c.gte !== undefined) return `vous avez au moins ${plural(c.gte, 'pièce d’or', 'pièces d’or')}`;
  const what = c.stat ? `votre ${UP(adv, c.stat)}` : c.gold !== undefined ? 'votre nombre de pièces d’or' : c.day !== undefined ? 'le jour' : c.provisions !== undefined ? 'votre nombre de repas' : null;
  if (what && c.gte !== undefined) return `${what} est de ${c.gte} ou plus`;
  if (what && c.lte !== undefined) return `${what} est de ${c.lte} ou moins`;
  if (what && c.eq !== undefined) return `${what} est exactement de ${c.eq}`;
  return describeCondition(c, adv);
}

export function effectText(e, adv) {
  let t = '';
  switch (e.op) {
    case 'stat': {
      const L = UP(adv, e.stat);
      if (e.set === 'initial') t = `votre ${L} revient à son total de départ.`;
      else if (e.set !== undefined) t = `votre ${L} passe à ${e.set}.`;
      else if (e.addInitial) t = `${e.addInitial > 0 ? 'ajoutez' : 'retirez'} ${plural(Math.abs(e.addInitial), 'point', 'points')} à votre total de départ ${de(L)}.`;
      else if (Number(e.add)) t = `vous ${e.add < 0 ? 'perdez' : 'gagnez'} ${plural(Math.abs(e.add), 'point', 'points')} ${de(L)}.`;
      break;
    }
    case 'gold': if (Number(e.add)) t = `${e.add < 0 ? 'retirez' : 'ajoutez'} ${plural(Math.abs(e.add), 'pièce d’or', 'pièces d’or')} ${e.add < 0 ? 'de' : 'à'} votre bourse.`; break;
    case 'provisions': if (Number(e.add)) t = `${e.add < 0 ? 'rayez' : 'ajoutez'} ${plural(Math.abs(e.add), 'repas', 'repas')} ${e.add < 0 ? 'de' : 'à'} vos provisions.`; break;
    case 'give': t = `inscrivez sur votre Feuille d'Aventure : ${itemName(adv, e.item)}${e.qty > 1 ? ` (×${e.qty})` : ''}.`; break;
    case 'take': t = `rayez de votre Feuille d'Aventure : ${itemName(adv, e.item)}.`; break;
    case 'flag': t = e.value === false ? `rayez le mot-clé « ${e.flag} ».` : `notez le mot-clé « ${e.flag} ».`; break;
    case 'note': t = `notez : ${e.text}`; break;
    case 'newDay': t = 'un nouveau jour commence.'; break;
    case 'meal': t = `vous prenez un repas (+${e.heal ?? adv.rules.meal?.heal ?? 4} ${UP(adv, adv.rules.meal?.stat || 'endurance')}).`; break;
    default: {
      const plug = ext.effects.get(e.op);
      try { t = plug?.print?.(e, adv) ?? plug?.describe?.(e, adv) ?? describeEffect(e, adv); } catch { t = ''; }
    }
  }
  t = oneLine(t);
  if (!t) return '';
  if (e.if) return `Si ${condText(e.if, adv)} : ${t.charAt(0).toLowerCase() + t.slice(1)}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const PRINT_HELPERS = { go: n => `rendez-vous au <b>${n}</b>`, esc: escHTML, UP, plural, condText, effectText };

/** Un bloc interactif traduit pour un outil sans règles : une phrase et des liens. */
function blockParts(b, i, adv) {
  const C = adv.rules.combat || {};
  const L = (text, to) => (to ? [{ text, to: String(to) }] : []);
  switch (b.type) {
    case 'test': {
      const luck = b.stat === C.luck;
      const cost = b.cost ?? (luck ? 1 : 0);
      const dice = !b.dice || b.dice === '2d6' ? 'deux dés' : b.dice;
      const S = UP(adv, b.stat);
      return {
        text: `${luck ? 'Tentez votre Chance' : `Testez votre ${statLabel(adv, b.stat)}`} : lancez ${dice}${b.mod ? ` et ${b.mod > 0 ? 'retirez' : 'ajoutez'} ${Math.abs(b.mod)} au résultat` : ''}. Si le total est inférieur ou égal à votre ${S}, ${luck ? 'vous êtes Chanceux' : 'vous réussissez'}${cost ? ` (dans tous les cas, retirez ${plural(cost, 'point', 'points')} ${de(S)})` : ''}.`,
        links: [...L(luck ? 'Chanceux' : 'Réussite', b.success), ...L(luck ? 'Malchanceux' : 'Échec', b.failure)],
      };
    }
    case 'roll': {
      const dice = !b.dice || b.dice === '1d6' ? 'un dé' : b.dice === '2d6' ? 'deux dés' : b.dice;
      return {
        text: `${b.label ? `${sentence(b.label)} ` : ''}Lancez ${dice}${b.addStat ? ` et ajoutez votre ${UP(adv, b.addStat)}` : ''}.`,
        links: (b.table || []).flatMap(t => L(`${t.min === t.max ? t.min : `${t.min} à ${t.max}`}${t.text ? ` : ${oneLine(t.text)}` : ''}`, t.to)),
      };
    }
    case 'combat': {
      const foes = (b.enemies || []).map(e => `${oneLine(e.name || 'Adversaire').toUpperCase()} (${UP(adv, C.skill)} ${e.skill}, ${UP(adv, C.health)} ${e.health})`);
      const parts = [`Combat : ${foes.join(' ; ') || 'un adversaire'}.`];
      if (foes.length > 1) parts.push(b.mode === 'together' ? 'Ils vous attaquent tous en même temps.' : 'Combattez-les l’un après l’autre.');
      if (b.attackMod) parts.push(`Pendant ce combat, ${b.attackMod > 0 ? 'ajoutez' : 'retirez'} ${Math.abs(b.attackMod)} à votre Force d’Attaque.`);
      if (b.stopAt) parts.push(`Le combat s’arrête dès que votre adversaire tombe à ${b.stopAt} points ${de(UP(adv, C.health))} ou moins.`);
      return {
        text: parts.join(' '),
        links: [...L('Vous êtes vainqueur', b.win), ...L(`Prendre la fuite${b.fleeAfter ? ` après ${b.fleeAfter} assauts` : ''} (−${b.fleeDamage ?? C.fleeDamage ?? 2} ${UP(adv, C.health)})`, b.flee), ...L('Vous êtes vaincu', b.lose)],
      };
    }
    case 'shop': {
      const offers = (b.offers || []).map(o => `${itemName(adv, o.item)} (${plural(o.price, 'pièce d’or', 'pièces d’or')}${o.stock ? `, ${o.stock} au plus` : ''})`);
      return { text: `${sentence(b.label || 'Marchand')}${offers.length ? ` Vous pouvez acheter : ${offers.join(', ')}.` : ''}`, links: [] };
    }
    case 'spells': {
      const sp = adv.rules.spells || {};
      return {
        text: `${oneLine(b.label || 'Lancer une formule')} : choisissez une formule${b.costInText ? '' : ` et retirez son coût de votre ${UP(adv, sp.stat || 'endurance')}`} (voir le Livre des formules).`,
        links: (b.options || []).flatMap(o => L(String(o.code || '?').toUpperCase(), o.to)),
      };
    }
    default: {
      const plug = ext.blocks.get(b.type);
      let text = '', links = [];
      try { if (plug?.print) text = htmlToText(plug.print(b, adv, PRINT_HELPERS)); } catch { text = ''; }
      try { links = (plug?.targets?.(b, i) || []).filter(t => t?.to).map(t => ({ text: oneLine(t.label) || 'Continuer', to: String(t.to) })); } catch { links = []; }
      return { text, links };
    }
  }
}

/** Morceaux d'un paragraphe : effets d'entrée (phrases), blocs (phrase + liens), choix. */
function sectionParts(sec, adv) {
  return {
    effects: (sec.onEnter || []).map(e => effectText(e, adv)).filter(Boolean),
    blocks: (sec.blocks || []).map((b, i) => blockParts(b, i, adv)),
    choices: (sec.choices || []).filter(c => c.to).map(c => ({ text: oneLine(c.text) || 'Continuer', to: String(c.to), if: c.if, effects: c.effects || [] })),
  };
}

/** Nombre total de renvois d'une aventure (choix + sorties des blocs). */
export const countLinks = adv => Object.values(adv.sections || {}).reduce((n, s) => n + targetsOf(s).length, 0);

/** Petit bilan d'une aventure (aperçu avant import ou fusion). */
export function storyStats(adv) {
  const secs = Object.values(adv.sections || {});
  return {
    sections: secs.length,
    links: countLinks(adv),
    deaths: secs.filter(s => s.ending === 'death').length,
    victories: secs.filter(s => s.ending === 'victory').length,
    deadEnds: secs.filter(s => !s.ending && !targetsOf(s).length).length,
    items: Object.keys(adv.items || {}).length,
  };
}

/** Disposition des passages pour la carte de Twine : une colonne par distance au départ. */
function layout(adv) {
  const depth = {}, order = [];
  const start = String(adv.start);
  const q = adv.sections[start] ? [start] : [];
  if (q.length) depth[start] = 0;
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const t of targetsOf(adv.sections[id])) if (adv.sections[t.to] && depth[t.to] === undefined) { depth[t.to] = depth[id] + 1; q.push(t.to); }
  }
  const lost = Math.max(-1, ...Object.values(depth)) + 1;
  for (const id of sortIds(Object.keys(adv.sections))) if (depth[id] === undefined) { depth[id] = lost; order.push(id); }
  const rows = {}, pos = {};
  for (const id of order) { const d = depth[id]; rows[d] = (rows[d] ?? -1) + 1; pos[id] = `${100 + d * 175},${100 + rows[d] * 150}`; }
  return pos;
}

/* ------------------------------------------------------------------ */
/* Export Twine (Twee 3 et archive HTML), format Harlowe               */
/* ------------------------------------------------------------------ */

/** Noms de passages : le numéro du paragraphe, débarrassé des caractères réservés de Twine. */
function passageNames(adv) {
  const names = {}, used = new Set();
  for (const id of sortIds(Object.keys(adv.sections))) {
    const n = oneLine(String(id).replace(/[[\]{}|\\]/g, '').replace(/->|<-/g, '-')) || 'paragraphe';
    let k = n, i = 2;
    while (used.has(k)) k = `${n}-${i++}`;
    used.add(k); names[id] = k;
  }
  return names;
}

/** Texte de lien sans les séparateurs de Twine (->, <-, |, crochets). */
const linkText = s => oneLine(s).replace(/->/g, '→').replace(/<-/g, '←').replace(/\|/g, '/').replace(/[[{]/g, '(').replace(/[\]}]/g, ')') || 'Continuer';
const twLink = (text, target) => `[[${linkText(text)}->${target}]]`;
const commentSafe = s => oneLine(s).replace(/--+/g, '—').replace(/>/g, '›');

/**
 * Markdown léger de Livre-Héros → Harlowe : **gras** et *italique* sont communs ; _x_ devient *x* ;
 * les caractères que Harlowe interpréterait ($variable, (macro:), [crochet], //, <balise) sont protégés
 * par le balisage verbatim `…` de Harlowe.
 */
function harlowe(md) {
  return String(md ?? '').replace(/\r\n?/g, '\n')
    .replace(/`/g, '’')
    .replace(/_(.+?)_/g, '*$1*')
    .replace(/^- /gm, '* ')
    .replace(/\$(?=[A-Za-z_])|\((?=[^\s()[\]:]+:)|\[|\]|\/\/|\/\*|\*\/|<(?=[A-Za-z!/])|~~|\^\^|''|\{|\}/g, m => `\`${m}\``);
}

function passageBody(id, sec, adv, names) {
  const P = sectionParts(sec, adv);
  const to = t => names[t] ?? oneLine(String(t).replace(/[[\]|]/g, ''));
  const out = [];
  if (sec.title) out.push(`### ${harlowe(oneLine(sec.title))}`);
  if (sec.image) out.push(`<img src="${escHTML(sec.image)}" alt="${escHTML(oneLine(sec.title) || `Illustration du paragraphe ${id}`)}">`);
  if (out.length) out.push('');
  if (sec.text?.trim()) out.push(harlowe(sec.text.trim()), '');
  if (P.effects.length) out.push(`*${harlowe(P.effects.join(' '))}*`, '');
  for (const b of P.blocks) {
    if (b.text) out.push(harlowe(b.text));
    b.links.forEach(l => out.push(twLink(l.text, to(l.to))));
    out.push('');
  }
  for (const c of P.choices) {
    const notes = [];
    if (c.if) notes.push(`Condition : ${condText(c.if, adv)}`);
    const fx = c.effects.map(e => effectText(e, adv)).filter(Boolean);
    if (fx.length) notes.push(`En choisissant : ${fx.join(' ')}`);
    out.push(twLink(c.text, to(c.to)) + (notes.length ? ` <!-- ${commentSafe(notes.join(' — '))} -->` : ''));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const endingTag = sec => (sec.ending === 'death' ? 'mort' : sec.ending === 'victory' ? 'victoire' : '');
const escName = n => n.replace(/\\/g, '\\\\').replace(/[[\]{}]/g, m => `\\${m}`);

/** Export Twee 3 (texte brut) : :: StoryTitle, :: StoryData, puis un passage par paragraphe. */
export function toTwee(adventure) {
  const adv = normalizeAdventure(adventure);
  const names = passageNames(adv), pos = layout(adv);
  const data = {
    ifid: ifidOf(adv), format: 'Harlowe', 'format-version': HARLOWE_VERSION,
    start: names[adv.start] ?? String(adv.start), 'tag-colors': { mort: 'red', victoire: 'green' }, zoom: 1,
  };
  const out = [`:: StoryTitle\n${oneLine(adv.meta.title) || 'Sans titre'}`, `:: StoryData\n${JSON.stringify(data, null, 2)}`];
  for (const id of sortIds(Object.keys(adv.sections))) {
    const sec = adv.sections[id];
    const tag = endingTag(sec);
    const body = passageBody(id, sec, adv, names).replace(/^::/gm, '\\::');
    out.push(`:: ${escName(names[id])}${tag ? ` [${tag}]` : ''} ${JSON.stringify({ position: pos[id], size: '100,100' })}\n${body}`);
  }
  return out.join('\n\n\n') + '\n';
}

/** Export archive Twine 2 (<tw-storydata>) : importable par « Bibliothèque › Importer » dans Twine. */
export function toTwineHTML(adventure) {
  const adv = normalizeAdventure(adventure);
  const names = passageNames(adv), pos = layout(adv);
  const ids = sortIds(Object.keys(adv.sections));
  const pid = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  const passages = ids.map(id => {
    const sec = adv.sections[id];
    return `<tw-passagedata pid="${pid[id]}" name="${escHTML(names[id])}" tags="${endingTag(sec)}" position="${pos[id]}" size="100,100">${escHTML(passageBody(id, sec, adv, names))}</tw-passagedata>`;
  });
  return `<tw-storydata name="${escHTML(oneLine(adv.meta.title) || 'Sans titre')}" startnode="${pid[adv.start] || 1}" creator="${CREATOR}" creator-version="1.0" format="Harlowe" format-version="${HARLOWE_VERSION}" ifid="${ifidOf(adv)}" options="" tags="" zoom="1" hidden>`
    + '<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>'
    + '<script role="script" id="twine-user-script" type="text/twine-javascript"></script>'
    + '<tw-tag name="mort" color="red"></tw-tag><tw-tag name="victoire" color="green"></tw-tag>'
    + passages.join('\n') + '</tw-storydata>\n';
}

/** Export JSON brut (adventure.json, sans les images). */
export const toJSON = adv => JSON.stringify(adv, null, 2) + '\n';

/* ------------------------------------------------------------------ */
/* Export ink                                                          */
/* ------------------------------------------------------------------ */

const inkIdent = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

/** Échappe une ligne de texte ink (et retire le Markdown, qu'ink n'affiche pas). */
function inkLine(s) {
  let t = String(s ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1').replace(/^#{1,6}\s+/, '').trimEnd();
  t = t.replace(/\\/g, '\\\\').replace(/[{}|#[\]]/g, m => `\\${m}`)
    .replace(/->/g, '-\\>').replace(/<-/g, '\\<-').replace(/<>/g, '\\<>').replace(/\/\//g, '\\/\\/').replace(/\/\*/g, '\\/*');
  if (/^\s*([*+\-=~]|TODO\b)/.test(t)) t = t.replace(/^(\s*)/, '$1\\');
  return t;
}
const inkTag = s => oneLine(String(s ?? '').replace(/[#\\{}|[\]]/g, ''));
const inkLit = v => (typeof v === 'boolean' ? String(v) : typeof v === 'number' && Number.isFinite(v) ? String(v) : `"${String(v ?? '').replace(/["\\\n]/g, ' ')}"`);

/** Variables ink d'une aventure : objets (compte), marques (vrai/faux), pièces d'or. */
function inkVars(adv) {
  const used = new Set(['pieces_or']);
  const uniq = base => { let k = base, i = 2; while (used.has(k)) k = `${base}_${i++}`; used.add(k); return k; };
  const items = {}, flags = {};
  let gold = false;
  const addItem = id => { if (id && typeof id === 'string' && !own(items, id)) items[id] = uniq(`obj_${inkIdent(id)}`); };
  const addFlag = f => { if (f && typeof f === 'string' && !own(flags, f)) flags[f] = uniq(`marque_${inkIdent(f)}`); };
  Object.keys(adv.items || {}).forEach(addItem);
  (adv.rules.startItems || []).forEach(addItem);
  walk([adv.sections, adv.items], o => {
    if (o.op === 'give' || o.op === 'take') addItem(o.item);
    else if (o.op === 'flag') addFlag(o.flag);
    else if (o.op === 'gold') gold = true;
    if (!o.op) { if (typeof o.has === 'string') addItem(o.has); if (typeof o.flag === 'string') addFlag(o.flag); if (o.gold !== undefined && typeof o.gold !== 'object') gold = true; }
    if (o.type === 'shop') { gold = true; (o.offers || []).forEach(x => addItem(x.item)); }
  });
  return { items, flags, gold };
}

/** Parenthèses seulement autour d'une expression composée : « (nom) » seul serait lu par ink comme un élément de liste. */
const inkWrap = x => (/^\w+$/.test(x) ? x : `(${x})`);

/** Condition Livre-Héros → expression ink, ou null si elle n'a pas d'équivalent. */
function inkCond(c, V, knots) {
  if (!c) return null;
  if (c.all || c.any) {
    const parts = (c.all || c.any).map(x => inkCond(x, V, knots));
    if (!parts.length || parts.some(p => !p)) return null;
    return parts.length === 1 ? parts[0] : parts.map(inkWrap).join(c.all ? ' and ' : ' or ');
  }
  if (findCondition(c)) return null;
  if (c.not) { const x = inkCond(c.not, V, knots); return x ? `not ${inkWrap(x)}` : null; }
  if (typeof c.has === 'string' && own(V.items, c.has)) return `${V.items[c.has]} >= ${Number(c.qty || 1)}`;
  if (typeof c.flag === 'string' && own(V.flags, c.flag)) return c.value === undefined ? `${V.flags[c.flag]}` : `${V.flags[c.flag]} == ${inkLit(c.value)}`;
  if (c.visited !== undefined && own(knots, String(c.visited))) return `${knots[String(c.visited)]} > 0`;
  if (c.gold !== undefined && V.gold) {
    const cmp = c.gte !== undefined ? `>= ${Number(c.gte)}` : c.lte !== undefined ? `<= ${Number(c.lte)}` : c.eq !== undefined ? `== ${Number(c.eq)}` : null;
    return cmp ? `pieces_or ${cmp}` : null;
  }
  return null;
}

/** Effet → lignes de logique ink (~ …), ou null si l'effet n'a pas d'équivalent. */
function inkEffect(e, V, knots) {
  let lines = null;
  const n = Number(e.qty || 1);
  if ((e.op === 'give' || e.op === 'take') && own(V.items, e.item)) {
    const v = V.items[e.item];
    lines = e.op === 'give' ? [`~ ${v} = ${v} + ${n}`] : [e.all ? `~ ${v} = 0` : `~ ${v} = MAX(${v} - ${n}, 0)`];
  } else if (e.op === 'flag' && own(V.flags, e.flag)) lines = [`~ ${V.flags[e.flag]} = ${inkLit(e.value === undefined ? true : e.value)}`];
  else if (e.op === 'gold' && V.gold) {
    const add = Number(e.add || 0);
    lines = e.set !== undefined ? [`~ pieces_or = ${Number(e.set)}`] : add ? [`~ pieces_or = MAX(pieces_or ${add < 0 ? '-' : '+'} ${Math.abs(add)}, 0)`] : [];
  }
  if (!lines) return null;
  if (!e.if) return lines;
  const cond = inkCond(e.if, V, knots);
  return cond ? [`{ ${cond}:`, ...lines.map(l => `    ${l}`), '}'] : null;
}

/** Formule de dés → expression ink (RANDOM), ou null. */
function inkDice(expr) {
  try {
    const { count, sides, mod } = parseDice(expr);
    const parts = Array.from({ length: Math.min(count, 12) }, () => `RANDOM(1, ${sides})`);
    if (mod || !parts.length) parts.push(String(mod));
    return parts.join(' + ').replace(/\+ -/g, '- ');
  } catch { return null; }
}

/**
 * Export ink : un nœud (=== p12 ===) par paragraphe, choix « + [texte] -> p34 ».
 * Les choix sont persistants (+) : comme dans un livre, un choix reste proposé quand on revient
 * sur un paragraphe. options.sticky = false produit des choix à usage unique (*).
 */
export function toInk(adventure, { sticky = true } = {}) {
  const adv = normalizeAdventure(adventure);
  const ids = sortIds(Object.keys(adv.sections));
  const knots = {}, usedK = new Set();
  for (const id of ids) {
    const base = `p${/^\d+$/.test(id) ? id : `_${inkIdent(id)}`}`;
    let k = base, i = 2;
    while (usedK.has(k)) k = `${base}_${i++}`;
    usedK.add(k); knots[id] = k;
  }
  const V = inkVars(adv);
  const bullet = sticky ? '+' : '*';
  const out = [];
  out.push(`// « ${oneLine(adv.meta.title) || 'Sans titre'} »${adv.meta.author ? ` — ${oneLine(adv.meta.author)}` : ''}`);
  out.push('// Exporté depuis Livre-Héros au format ink (Inkle) : ouvrez ce fichier dans Inky.');
  out.push('// Tests, combats et tables de dés deviennent des choix : le lecteur lance les dés lui-même.');
  out.push(`# title: ${inkTag(adv.meta.title) || 'Sans titre'}`);
  if (adv.meta.author) out.push(`# author: ${inkTag(adv.meta.author)}`);
  out.push('');
  const start = {};
  (adv.rules.startItems || []).forEach(id => { start[id] = (start[id] || 0) + 1; });
  if (Object.keys(V.items).length) out.push('// Objets (nombre d’exemplaires dans le sac)');
  for (const [id, v] of Object.entries(V.items)) out.push(`VAR ${v} = ${start[id] || 0} // ${oneLine(itemName(adv, id))}`);
  if (Object.keys(V.flags).length) out.push('// Marques (mots-clés notés sur la Feuille d’Aventure)');
  for (const [f, v] of Object.entries(V.flags)) out.push(`VAR ${v} = false // ${oneLine(f)}`);
  if (V.gold) out.push('VAR pieces_or = 0 // pièces d’or');
  out.push('');
  const goldRoll = V.gold ? inkDice(adv.rules.gold || '0') : null;
  if (goldRoll && goldRoll !== '0') out.push(`~ pieces_or = ${goldRoll}`);
  out.push(`-> ${knots[adv.start] || knots[ids[0]] || 'END'}`, '');

  const choiceLines = (text, cond, effects, target, comment) => {
    const lines = [];
    if (comment) lines.push(`// ${oneLine(comment)}`);
    const head = `${bullet} ${cond ? `{${cond}} ` : ''}[${inkLine(text)}]`;
    const logic = [], said = [];
    for (const e of effects || []) {
      const l = inkEffect(e, V, knots);
      if (l) logic.push(...l); else { const t = effectText(e, adv); if (t) said.push(inkLine(t)); }
    }
    const dest = knots[target] || 'END';
    if (!logic.length && !said.length) lines.push(`${head} -> ${dest}`);
    else lines.push(head, ...logic.map(l => `    ${l}`), ...said.map(l => `    ${l}`), `    -> ${dest}`);
    return lines;
  };

  for (const id of ids) {
    const sec = adv.sections[id];
    const P = sectionParts(sec, adv);
    out.push(`=== ${knots[id]} ===`);
    if (sec.title) out.push(`# titre: ${inkTag(sec.title)}`);
    if (sec.image) out.push(`# image: ${inkTag(sec.image)}`);
    if (sec.ending) out.push(`# fin: ${sec.ending === 'death' ? 'mort' : 'victoire'}`);
    const body = String(sec.text || '').replace(/\r\n?/g, '\n').split('\n').map(inkLine);
    for (const l of body) if (l.trim() || out[out.length - 1] !== '') out.push(l.trim() ? l : '');
    const logic = [], said = [];
    for (const e of sec.onEnter || []) {
      const l = inkEffect(e, V, knots);
      if (l) logic.push(...l); else { const t = effectText(e, adv); if (t) said.push(inkLine(t)); }
    }
    out.push(...logic, ...said);
    P.blocks.forEach(b => { if (b.text) out.push(...b.text.split('\n').map(inkLine)); });
    const choices = [];
    P.blocks.forEach(b => b.links.forEach(l => choices.push(...choiceLines(l.text, null, [], l.to))));
    let guarded = 0;
    for (const c of P.choices) {
      const cond = c.if ? inkCond(c.if, V, knots) : null;
      if (cond) guarded++;
      choices.push(...choiceLines(c.text, cond, c.effects, c.to, c.if && !cond ? `Condition non traduite : ${condText(c.if, adv)}` : ''));
    }
    const all = P.blocks.reduce((n, b) => n + b.links.length, 0) + P.choices.length;
    if (!all) out.push('-> END');
    else {
      out.push(...choices);
      if (guarded === all) out.push(`${bullet} -> END`); // aucun choix possible : l'histoire s'arrête proprement
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ------------------------------------------------------------------ */
/* Import Twine : Twee, archive HTML Twine 2, fichier Twine 1           */
/* ------------------------------------------------------------------ */

const SPECIAL_PASSAGES = new Set(['StoryTitle', 'StoryData', 'StoryAuthor', 'StorySubtitle', 'StoryIncludes', 'StorySettings', 'StoryInit', 'StoryMenu', 'StoryCaption', 'StoryBanner', 'StoryShare', 'StoryInterface', 'PassageReady', 'PassageDone', 'PassageHeader', 'PassageFooter', 'StoryMenu']);
const SPECIAL_TAGS = new Set(['script', 'stylesheet', 'widget', 'twine.image', 'twine.private', 'annotation', 'header', 'footer', 'startup', 'debug-header', 'debug-footer', 'debug-startup', 'init', 'Twine.image']);
const DEATH_TAGS = new Set(['death', 'mort', 'dead', 'gameover', 'game-over', 'fin-mort', 'defaite', 'défaite']);
const VICTORY_TAGS = new Set(['victory', 'victoire', 'win', 'fin-victoire', 'success', 'succes', 'succès']);
const STR = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`;
const unquote = s => { const t = String(s ?? '').trim(); return /^(["']).*\1$/s.test(t) ? t.slice(1, -1).replace(/\\(.)/g, '$1') : t; };

/** Découpe l'intérieur de [[…]] : [[texte->cible]], [[cible<-texte]], [[texte|cible]], [[cible]], [[…][réglage]]. */
export function parseLink(inner) {
  const s = String(inner).split('][')[0];
  const r = s.lastIndexOf('->'), l = s.indexOf('<-');
  if (r >= 0) return { text: s.slice(0, r).trim(), target: s.slice(r + 2).trim() };
  if (l >= 0) return { text: s.slice(l + 2).trim(), target: s.slice(0, l).trim() };
  const p = s.lastIndexOf('|');
  if (p >= 0) return { text: s.slice(0, p).trim(), target: s.slice(p + 1).trim() };
  return { text: s.trim(), target: s.trim() };
}

/** Indice juste après la parenthèse (ou le crochet) fermante qui répond à s[i], en sautant les chaînes. */
function matchClose(s, i, open, close) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (ch === '"' || ch === "'") { const q = ch; k++; while (k < s.length && s[k] !== q) { if (s[k] === '\\') k++; k++; } continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (!depth) return k + 1; }
  }
  return -1;
}

const LINK_MARK = /\u0001(\d+)\u0002/g;
const keepMarks = s => (String(s).match(/\u0001\d+\u0002/g) || []).join(' ');

/** Retire les macros Harlowe « (nom: …) » en gardant le texte de leurs crochets (hooks). */
function stripHarlowe(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '(' && /^\((?:[A-Za-z][\w-]*|[$_]\w+)\s*:/.test(s.slice(i, i + 64))) {
      const end = matchClose(s, i, '(', ')');
      if (end > 0) {
        out += keepMarks(s.slice(i, end));
        i = end;
        while (s[i] === '+' && s[i + 1] === '(') { const e2 = matchClose(s, i + 1, '(', ')'); if (e2 < 0) break; out += keepMarks(s.slice(i, e2)); i = e2; }
        if (s[i] === '[') { const h = matchClose(s, i, '[', ']'); if (h > 0) { out += stripHarlowe(s.slice(i + 1, h - 1)); i = h; } }
        continue;
      }
    }
    out += s[i++];
  }
  return out;
}

/**
 * Nettoie le texte d'un passage : liens mis de côté, macros Harlowe / SugarCube retirées (le texte
 * narratif de leurs crochets est gardé), balisage converti en Markdown léger, HTML retiré.
 * Renvoie { text, title, links: [{ text, target, hidden }], images }.
 */
export function cleanPassage(raw, format = 'harlowe') {
  const links = [], images = [], kept = [];
  const addLink = (text, target, hidden = false) => { links.push({ text: oneLine(text), target: oneLine(target), hidden }); return `\u0001${links.length - 1}\u0002`; };
  const protect = t => { kept.push(t); return `\u0003${kept.length - 1}\u0004`; };
  const harl = format !== 'sugarcube' && format !== 'other';
  const sugar = format === 'sugarcube';
  let s = String(raw ?? '').replace(/\r\n?/g, '\n');

  // 1. Texte littéral (verbatim) : `…` (Harlowe), {{{…}}} et <nowiki> (SugarCube).
  if (harl) s = s.replace(/(`+)([\s\S]*?)\1/g, (_, q, body) => protect(body));
  if (sugar) s = s.replace(/\{\{\{([\s\S]*?)\}\}\}/g, (_, b) => protect(b)).replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, (_, b) => protect(b));
  // 2. Commentaires et code.
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/%[\s\S]*?%\//g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<%[\s\S]*?%>/g, '');
  // 3. Images.
  s = s.replace(/<img\b[^>]*>/gi, tag => { const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag); if (m) images.push(decodeEntities(m[1] ?? m[2] ?? m[3])); return ''; });
  s = s.replace(/\[img\[(?:[^\]|]*\|)?([^\]]*)\](?:\[([^\]]*)\])?\]/gi, (_, src, target) => { images.push(src.trim()); return target ? addLink('', parseLink(target).target, true) : ''; });
  // 4. Liens [[…]].
  s = s.replace(/\[\[(.+?)\]\]/g, (_, inner) => { const l = parseLink(inner); return addLink(l.text, l.target); });
  // 5. Liens par macros.
  s = s.replace(new RegExp(`\\((?:link-goto|link-go-to|link-reveal-goto):\\s*(${STR})(?:\\s*,\\s*(${STR}))?[^)]*\\)`, 'gi'), (_, a, b) => addLink(unquote(a), unquote(b ?? a)));
  s = s.replace(new RegExp(`\\((?:goto|go-to|redirect):\\s*(${STR})\\s*\\)`, 'gi'), (_, a) => addLink('', unquote(a), true));
  s = s.replace(new RegExp(`<<(?:link|button|click|choice)\\s+(${STR})\\s+(${STR})\\s*>>`, 'gi'), (_, a, b) => addLink(unquote(a), unquote(b)));
  s = s.replace(new RegExp(`<<goto\\s+(${STR})\\s*>>`, 'gi'), (_, a) => addLink('', unquote(a), true));
  // 6. Macros restantes : on garde les liens qu'elles contenaient et le texte narratif autour.
  s = s.replace(/<<[\s\S]*?>>/g, m => keepMarks(m));
  if (harl) {
    s = stripHarlowe(s)
      .replace(/\|[\w-]+>(?=\[)/g, '').replace(/\](<[\w-]+\|)/g, ']')
      .replace(/[{}]/g, '');
    let prev;
    do { prev = s; s = s.replace(/\[([^[\]]*)\]/g, '$1'); } while (s !== prev);
    s = s.replace(/^\s*(?:==+>|<==+|=><=|<==>|=+\|?|\|=+)\s*$/gm, '');
  }
  s = s.replace(/\$[A-Za-z_]\w*(?:\.\w+)*/g, '');
  // 7. Balisage → Markdown léger de Livre-Héros.
  s = s.replace(/''(.+?)''/g, '**$1**').replace(/\/\/(.+?)\/\//g, '*$1*').replace(/__(.+?)__/g, '*$1*')
    .replace(/~~(.+?)~~/g, '$1').replace(/\^\^(.+?)\^\^/g, '$1').replace(/@@(?:[^;@\n]*;)?([\s\S]*?)@@/g, '$1');
  if (sugar) s = s.replace(/^!{1,6}\s*/gm, '### ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p\b[^>]*>/gi, '\n\n').replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<\/?[A-Za-z][^>]*>/g, '');
  s = s.replace(/\\\n/g, '').replace(/^\s*(?:-{3,}|\*{3,})\s*$/gm, '');
  s = decodeEntities(s);
  // 8. Liens : une ligne qui ne contient que des liens disparaît ; sinon le texte du lien reste dans la phrase.
  const order = [];
  s = s.split('\n').map(line => {
    const marks = [...line.matchAll(LINK_MARK)].map(m => Number(m[1]));
    if (!marks.length) return line;
    order.push(...marks);
    const rest = line.replace(LINK_MARK, '').replace(/[\s|•·*>,;:.\-–—()]+/g, '');
    return rest ? line.replace(LINK_MARK, (_, n) => (links[n].hidden ? '' : links[n].text)) : null;
  }).filter(l => l !== null).join('\n');
  s = s.replace(/\u0003(\d+)\u0004/g, (_, n) => kept[Number(n)]);
  s = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let title = '';
  const h = /^#{1,6}\s+(.+)(\n|$)/.exec(s);
  if (h) { title = h[1].trim(); s = s.slice(h[0].length).trim(); }
  return { text: s, title, links: order.map(n => links[n]), images };
}

/** En-tête Twee « Nom [étiquettes] {métadonnées} » (les crochets et accolades du nom sont échappés par \). */
function parseHeader(h) {
  const s = h.trim();
  let name = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { name += s[i + 1]; i += 2; continue; }
    if (c === '[' || c === '{' || (c === '<' && /^<\d+,\d+>/.test(s.slice(i)))) break;
    name += c; i++;
  }
  let rest = s.slice(i).trim(), tags = [], meta = {};
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    tags = rest.slice(1, end < 0 ? undefined : end).split(/\s+/).filter(Boolean);
    rest = end < 0 ? '' : rest.slice(end + 1).trim();
  }
  if (rest.startsWith('{')) { try { meta = JSON.parse(rest); } catch { meta = {}; } }
  return { name: name.trim(), tags, meta };
}

/** Passages d'un fichier Twee (Twee 3, compatible Twee 1 et 2). */
export function parseTweePassages(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out = [];
  let cur = null;
  for (const line of src.split('\n')) {
    if (line.startsWith('::')) { cur = { ...parseHeader(line.slice(2)), lines: [] }; out.push(cur); }
    else if (cur) cur.lines.push(line.replace(/^\\::/, '::'));
  }
  return out.map(p => ({ name: p.name, tags: p.tags, meta: p.meta, text: p.lines.join('\n').replace(/\s+$/, '') }));
}

const TAG_ATTRS = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
function attrs(src) {
  const out = {};
  for (const m of String(src).matchAll(TAG_ATTRS)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
const ATTR_BODY = `((?:[^>"']|"[^"]*"|'[^']*')*)`;
const PASSAGE_RE = () => new RegExp(`<tw-passagedata\\b${ATTR_BODY}>([\\s\\S]*?)<\\/tw-passagedata\\s*>`, 'gi');
const TIDDLER_RE = () => new RegExp(`<div\\s+(?=(?:[^>"']|"[^"]*"|'[^']*')*\\btiddler\\s*=)${ATTR_BODY}>([\\s\\S]*?)<\\/div>`, 'gi');

/**
 * Blocs <tw-storydata> d'un fichier : chaque balise fermante est associée à la balise ouvrante la plus proche
 * (une histoire publiée contient avant elle le code du format d'histoire, qui peut citer « <tw-storydata »).
 * Renvoie [[, attributs, contenu]], en gardant ceux qui contiennent des passages s'il y en a.
 */
function storyBlocks(html) {
  const src = String(html ?? '');
  const opens = [...src.matchAll(new RegExp(`<tw-storydata\\b${ATTR_BODY}>`, 'gi'))];
  const out = [];
  let from = 0;
  for (const close of src.matchAll(/<\/tw-storydata\s*>/gi)) {
    const open = opens.filter(o => o.index >= from && o.index < close.index).pop();
    if (open) out.push([open[0], open[1], src.slice(open.index + open[0].length, close.index)]);
    from = close.index + close[0].length;
  }
  const full = out.filter(m => /<tw-passagedata\b/i.test(m[2]));
  return full.length ? full : out;
}

/** Histoires d'une archive Twine 2 : [{ index, name, format, passages }]. */
export function twineStories(html) {
  return storyBlocks(html).map((m, index) => {
    const a = attrs(m[1]);
    return { index, name: a.name || 'Sans titre', format: a.format || '', passages: [...m[2].matchAll(PASSAGE_RE())].length };
  });
}

/** Quel format ? 'twine2' | 'twine1' | 'twee' | 'json' | null. */
export function detectFormat(text) {
  const t = String(text ?? '');
  if (/<tw-storydata\b/i.test(t)) return 'twine2';
  if (/<div\s[^>]*\btiddler\s*=/i.test(t)) return 'twine1';
  if (/^\uFEFF?::/m.test(t)) return 'twee';
  try { const j = JSON.parse(t); if (j && typeof j === 'object' && j.sections) return 'json'; } catch { /* pas du JSON */ }
  return null;
}

const formatKind = f => (/sugarcube|twine\s*1|jonah|sugarcane|responsive/i.test(f || '') ? 'sugarcube' : /harlowe/i.test(f || 'harlowe') ? 'harlowe' : 'other');
const numericLike = n => /^\d+[a-z]?$/i.test(n) && n !== '0';
const defaultName = n => /^(untitled passage|passage sans titre|nouveau passage)(\s*\d+)?$/i.test(n);

/** Construit une aventure Livre-Héros à partir de passages Twine { name, tags, text }. */
function buildAdventure({ title, author, ifid, format, formatVersion, start, passages }, options = {}) {
  const warnings = options.warnings || [];
  const kind = formatKind(format);
  const story = [];
  const byName = new Map();
  for (const p of passages) {
    const tags = (p.tags || []).map(t => t.toLowerCase());
    if (!p.name || SPECIAL_PASSAGES.has(p.name) || tags.some(t => SPECIAL_TAGS.has(t))) continue;
    if (byName.has(p.name)) { warnings.push(`Deux passages s’appellent « ${p.name} » : seul le premier est gardé.`); continue; }
    const q = { ...p, tags, parsed: cleanPassage(p.text, kind) };
    byName.set(p.name, q);
    story.push(q);
  }
  if (!story.length) throw new Error('aucun passage d’histoire dans ce fichier');
  const first = byName.get(start) || byName.get('Start') || byName.get('Début') || story[0];
  if (start && !byName.has(start)) warnings.push(`Le passage de départ « ${start} » est introuvable : l’histoire commence à « ${first.name} ».`);

  // Numérotation : des noms déjà numérotés (12, 6b…) sont gardés, sinon 1..N en suivant les liens depuis le départ.
  const num = new Map();
  const keep = story.every(p => numericLike(p.name));
  if (keep) story.forEach(p => num.set(p.name, p.name));
  else {
    const seen = new Set([first.name]), q = [first], order = [];
    while (q.length) {
      const p = q.shift();
      order.push(p);
      for (const l of p.parsed.links) { const t = byName.get(l.target); if (t && !seen.has(t.name)) { seen.add(t.name); q.push(t); } }
    }
    for (const p of story) if (!seen.has(p.name)) order.push(p);
    order.forEach((p, i) => num.set(p.name, String(i + 1)));
  }

  const adv = {
    format: FORMAT,
    id: options.id || `${slug(title || 'histoire-twine')}-${Math.random().toString(36).slice(2, 6)}`,
    meta: { title: oneLine(title) || 'Histoire importée de Twine', author: oneLine(author || ''), description: `Histoire importée depuis Twine${format ? ` (${format}${formatVersion ? ` ${formatVersion}` : ''})` : ''}.`, cover: null, version: 1, updated: new Date().toISOString() },
    rules: structuredClone(DEFAULT_RULES),
    items: {},
    start: num.get(first.name),
    sections: {},
  };
  if (ifid && UUID.test(ifid)) adv.meta.ifid = ifid.toUpperCase();
  let lostImages = 0;
  for (const p of story) {
    const { text, title: heading, links, images } = p.parsed;
    const sec = newSection(text);
    sec.title = heading || (!keep && !/^\d+$/.test(p.name) && !defaultName(p.name) ? p.name : '');
    const img = images.find(src => /^(https?:\/\/|data:image\/)/i.test(src));
    if (img) sec.image = img;
    else if (images.length) lostImages++;
    if (p.tags.some(t => DEATH_TAGS.has(t))) sec.ending = 'death';
    else if (p.tags.some(t => VICTORY_TAGS.has(t))) sec.ending = 'victory';
    sec.choices = links.map(l => {
      const t = byName.get(l.target);
      if (!t) warnings.push(`Passage « ${p.name} » : le lien « ${l.text || l.target} » mène à « ${l.target} », qui n’existe pas.`);
      return { text: l.text || (l.hidden ? 'Continuer' : l.target), to: t ? num.get(t.name) : l.target };
    });
    adv.sections[num.get(p.name)] = sec;
  }
  if (lostImages) warnings.push(`${plural(lostImages, 'illustration n’a pas pu être importée', 'illustrations n’ont pas pu être importées')} (fichiers absents) : ajoutez-les dans l’éditeur.`);
  return normalizeAdventure(adv);
}

/** Twee (Twee 3, 2 ou 1) → aventure Livre-Héros. options : { id, warnings: [] } */
export function fromTwee(text, options = {}) {
  const passages = parseTweePassages(text);
  if (!passages.length) throw new Error('aucun passage Twee (« :: Nom ») dans ce fichier');
  const get = n => passages.find(p => p.name === n);
  let data = {};
  const sd = get('StoryData');
  if (sd) { try { data = JSON.parse(sd.text); } catch { options.warnings?.push('Le passage StoryData est illisible : il est ignoré.'); } }
  const settings = get('StorySettings');
  return buildAdventure({
    title: get('StoryTitle')?.text.trim() || data.name,
    author: get('StoryAuthor')?.text.trim(),
    ifid: data.ifid || (/^ifid\s*:\s*(\S+)/im.exec(settings?.text || '') || [])[1],
    format: data.format || (settings ? 'SugarCube' : ''),
    formatVersion: data['format-version'],
    start: data.start,
    passages,
  }, options);
}

/** Archive ou histoire publiée Twine 2 (et fichier Twine 1) → aventure, sans DOM. options : { story, id, warnings } */
export function fromTwineHTML(html, options = {}) {
  const src = String(html ?? '');
  const stories = storyBlocks(src);
  if (stories.length) {
    const st = stories[options.story ?? 0] || stories[0];
    const a = attrs(st[1]);
    const passages = [...st[2].matchAll(PASSAGE_RE())].map(m => {
      const p = attrs(m[1]);
      return { pid: p.pid, name: p.name || '', tags: (p.tags || '').split(/\s+/).filter(Boolean), text: decodeEntities(m[2]) };
    });
    return buildAdventure({ title: a.name, ifid: a.ifid, format: a.format, formatVersion: a['format-version'], start: passages.find(p => p.pid === a.startnode)?.name, passages }, options);
  }
  // Twine 1 : <div tiddler="Nom" tags="…">texte avec \n échappés</div>
  const passages = [];
  for (const m of src.matchAll(TIDDLER_RE())) {
    const p = attrs(m[1]);
    if (!own(p, 'tiddler')) continue;
    const text = decodeEntities(m[2]).replace(/\\([nbst])/g, (_, c) => ({ n: '\n', b: ' ', s: '\\', t: '\t' }[c]));
    passages.push({ name: p.tiddler, tags: (p.tags || '').split(/\s+/).filter(Boolean), text });
  }
  if (!passages.length) throw new Error('aucune histoire Twine dans ce fichier');
  const get = n => passages.find(p => p.name === n);
  return buildAdventure({ title: get('StoryTitle')?.text.trim(), author: get('StoryAuthor')?.text.trim(), format: 'Twine 1', start: 'Start', passages }, options);
}

/** Lit un fichier texte d'un format connu (Twee, archive Twine, adventure.json) et renvoie une aventure. */
export function parseStory(text, options = {}) {
  const f = detectFormat(text);
  if (f === 'twine2' || f === 'twine1') return fromTwineHTML(text, options);
  if (f === 'twee') return fromTwee(text, options);
  if (f === 'json') return normalizeAdventure(JSON.parse(text));
  throw new Error('format non reconnu : il faut un fichier Twee (.twee), une archive Twine (.html) ou un adventure.json');
}

/* ------------------------------------------------------------------ */
/* Fusion de deux aventures (co-écriture)                              */
/* ------------------------------------------------------------------ */

const ASSET_RE = /^(images|sons)\/\S+$/;
/** Chemins d'images et de sons cités par un morceau d'aventure. */
export function assetPaths(node, out = new Set()) {
  if (typeof node === 'string') { if (ASSET_RE.test(node)) out.add(node); }
  else if (Array.isArray(node)) node.forEach(v => assetPaths(v, out));
  else if (isObj(node)) Object.values(node).forEach(v => assetPaths(v, out));
  return out;
}

/** Remplace des chaînes exactes (chemins d'images) partout dans un arbre JSON. */
function replaceStrings(node, map) {
  if (Array.isArray(node)) return node.map(v => replaceStrings(v, map));
  if (isObj(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceStrings(v, map)]));
  return typeof node === 'string' && own(map, node) ? map[node] : node;
}

const STOP = new Set(['les', 'des', 'une', 'aux', 'the', 'and', 'pour', 'dans', 'sur', 'avec', 'sans']);
/** Préfixe proposé pour les identifiants en double : un mot du titre de l'autre aventure. */
export function defaultPrefix(adv) {
  const words = slug(adv?.meta?.title || '').split('-').filter(w => w.length > 2 && !STOP.has(w));
  return `${(words[0] || 'b').slice(0, 12)}-`;
}
const normPrefix = p => { const s = slug(String(p ?? '')).slice(0, 20); return s && s !== 'aventure' ? `${s}-` : 'b-'; };

/** Plan de renommage d'un dictionnaire d'identifiants (objets, compagnons, compteurs). */
function planIds(aDict, bDict, prefix, share, nameOf) {
  const map = Object.create(null), entries = [];
  const taken = new Set([...Object.keys(aDict), ...Object.keys(bDict)]);
  for (const [id, def] of Object.entries(bDict)) {
    const name = nameOf(def, id);
    if (!own(aDict, id)) { entries.push({ from: id, to: id, name, status: 'added' }); continue; }
    if (share && canon(aDict[id]) === canon(def)) { entries.push({ from: id, to: id, name, status: 'shared' }); continue; }
    let to = `${prefix}${id}`, n = 2;
    while (taken.has(to)) to = `${prefix}${id}-${n++}`;
    taken.add(to); map[id] = to;
    entries.push({ from: id, to, name, status: 'renamed' });
  }
  return { map, entries };
}

/** Clés qui citent un identifiant : objet, compagnon, compteur, marque. */
const REF_KEYS = { has: 'items', item: 'items', requires: 'items', equipped: 'items', companion: 'companions', counter: 'counters', flag: 'flags' };
function rewriteRefs(node, maps) {
  if (Array.isArray(node)) { node.forEach(v => rewriteRefs(v, maps)); return; }
  if (!isObj(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && own(REF_KEYS, k) && own(maps[REF_KEYS[k]], v)) node[k] = maps[REF_KEYS[k]][v];
    else if (Array.isArray(v) && (k === 'items' || k === 'startItems')) { node[k] = v.map(x => (typeof x === 'string' && own(maps.items, x) ? maps.items[x] : x)); rewriteRefs(node[k], maps); }
    else if (v && typeof v === 'object') rewriteRefs(v, maps);
  }
}

/** Marques (mots-clés) utilisées par une aventure. */
function flagsOf(adv) {
  const out = new Set();
  walk([adv.sections, adv.items], o => { if (typeof o.flag === 'string' && o.flag) out.add(o.flag); });
  return out;
}

const listFr = arr => (arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} et ${arr[arr.length - 1]}`);

/**
 * Fusionne `other` dans `base` (co-écriture) : les paragraphes de l'autre aventure sont renumérotés à la suite,
 * les objets, compagnons et compteurs dont l'identifiant existe déjà sont préfixés (sauf s'ils sont identiques),
 * les caractéristiques, classes et formules manquantes sont ajoutées ; les règles de `base` sont conservées.
 * options : { prefix, startAt, shareIdentical = true, prefixFlags = false, link: { from, text }, takenAssets: [] }
 * Renvoie { adventure, mapping: { ancienNuméro: nouveau }, report, assetMap: { cheminAutre: cheminFinal } }.
 */
export function mergeAdventures(base, other, options = {}) {
  const A = normalizeAdventure(base);
  const B = normalizeAdventure(other);
  const prefix = options.prefix === undefined || options.prefix === '' ? defaultPrefix(B) : normPrefix(options.prefix);
  const share = options.shareIdentical !== false;
  const lines = [];
  const report = { title: B.meta.title, prefix, sections: null, items: [], companions: [], counters: [], stats: [], classes: [], spells: [], flags: { common: [], renamed: [] }, assets: [], warnings: [], lines };
  const warn = text => { report.warnings.push(text); lines.push({ kind: 'warning', text }); };

  // 1. Identifiants en double.
  const counterDict = list => Object.fromEntries((Array.isArray(list) ? list : []).filter(c => c && c.id).map(c => [c.id, c]));
  const items = planIds(A.items || {}, B.items || {}, prefix, share, (d, id) => d?.name || id);
  const comps = planIds(A.companions || {}, B.companions || {}, prefix, share, (d, id) => d?.name || id);
  const ctrs = planIds(counterDict(A.rules.counters), counterDict(B.rules.counters), prefix, share, (d, id) => d?.label || id);
  const common = [...flagsOf(B)].filter(f => flagsOf(A).has(f));
  const flagMap = Object.create(null);
  if (options.prefixFlags) for (const f of common) flagMap[f] = `${prefix}${f}`;
  report.items = items.entries; report.companions = comps.entries; report.counters = ctrs.entries;
  report.flags = { common: options.prefixFlags ? [] : common, renamed: Object.entries(flagMap).map(([from, to]) => ({ from, to })) };

  // 2. Références réécrites dans l'autre aventure (effets, conditions, boutiques, classes…).
  const maps = { items: items.map, companions: comps.map, counters: ctrs.map, flags: flagMap };
  const { meta: _meta, ...rest } = B;
  rewriteRefs(rest, maps);
  const rename = (dict, map) => Object.fromEntries(Object.entries(dict || {}).map(([k, v]) => [own(map, k) ? map[k] : k, v]));
  B.items = rename(B.items, items.map);
  if (B.companions) B.companions = rename(B.companions, comps.map);
  if (Array.isArray(B.rules.counters)) B.rules.counters = B.rules.counters.map(c => (c && own(ctrs.map, c.id) ? { ...c, id: ctrs.map[c.id] } : c));

  // 3. Paragraphes renumérotés à la suite de ceux de la base.
  const broken = new Set();
  for (const [id, sec] of Object.entries(B.sections)) for (const t of targetsOf(sec)) if (!B.sections[t.to]) broken.add(`${id} → ${t.to}`);
  const maxA = Math.max(0, ...Object.keys(A.sections).map(Number).filter(n => Number.isInteger(n) && n > 0));
  let n = Number(options.startAt) > 0 ? Math.floor(Number(options.startAt)) - 1 : maxA; // les numéros déjà pris sont sautés
  const mapping = {};
  for (const id of sortIds(Object.keys(B.sections))) { do n++; while (A.sections[String(n)]); mapping[id] = String(n); }
  const B2 = remap(B, mapping);
  const ids = Object.values(mapping);
  const newStart = mapping[String(B.start)] ?? ids[0];

  // 4. Ce qui entre dans la base : paragraphes, définitions nouvelles, données de greffons absentes.
  const added = { sections: B2.sections, items: {}, companions: {}, counters: [], extra: {} };
  for (const e of items.entries) if (e.status !== 'shared') added.items[e.to] = B2.items[e.to];
  for (const e of comps.entries) if (e.status !== 'shared') added.companions[e.to] = B2.companions[e.to];
  for (const e of ctrs.entries) if (e.status !== 'shared') added.counters.push(B2.rules.counters.find(c => c?.id === e.to));
  const KNOWN = new Set(['format', 'id', 'meta', 'rules', 'items', 'start', 'sections', 'companions']);
  for (const [k, v] of Object.entries(B2)) {
    if (KNOWN.has(k) || v === undefined) continue;
    const a = A[k];
    if (a === undefined || (Array.isArray(a) && !a.length) || (isObj(a) && !Object.keys(a).length)) { added.extra[k] = { how: 'set', value: v }; continue; }
    if (canon(a) === canon(v)) continue;
    if (Array.isArray(a) && Array.isArray(v)) {
      const seen = new Set(a.map(canon)), idsA = new Set(a.map(x => x?.id).filter(Boolean));
      const extra = v.filter(x => !seen.has(canon(x)) && !(x?.id && idsA.has(x.id)));
      const skipped = v.filter(x => x?.id && idsA.has(x.id) && !seen.has(canon(x)));
      if (extra.length) added.extra[k] = { how: 'append', value: extra };
      if (skipped.length) warn(`Données « ${k} » : ${skipped.length} élément(s) de l’autre aventure ont un identifiant déjà pris et n’ont pas été repris.`);
    } else if (isObj(a) && isObj(v)) {
      const extra = Object.fromEntries(Object.entries(v).filter(([kk]) => !own(a, kk)));
      const clash = Object.keys(v).filter(kk => own(a, kk) && canon(a[kk]) !== canon(v[kk]));
      if (Object.keys(extra).length) added.extra[k] = { how: 'assign', value: extra };
      if (clash.length) warn(`Données « ${k} » : ${listFr(clash)} existe(nt) déjà ; la version de cette aventure est gardée.`);
    } else warn(`Données « ${k} » de l’autre aventure non reprises : cette aventure a déjà les siennes.`);
  }

  // 5. Images et sons : un chemin déjà pris dans la base est renommé avec le préfixe.
  const taken = assetPaths([A, options.takenAssets || []]);
  const assetMap = {}, renamedAssets = {};
  for (const p of assetPaths(added)) {
    let to = p;
    if (taken.has(p)) {
      const cut = p.lastIndexOf('/');
      const dir = p.slice(0, cut + 1), file = p.slice(cut + 1);
      let k = 2;
      to = `${dir}${prefix}${file}`;
      while (taken.has(to)) to = `${dir}${prefix}${k++}-${file}`;
      renamedAssets[p] = to;
      report.assets.push({ from: p, to });
    }
    taken.add(to);
    assetMap[p] = to;
  }
  const final = replaceStrings(added, renamedAssets);

  // 6. Assemblage.
  const baseIds = new Set(Object.keys(A.sections));
  Object.assign(A.sections, final.sections);
  Object.assign(A.items, final.items);
  if (Object.keys(final.companions).length) A.companions = { ...(A.companions || {}), ...final.companions };
  if (final.counters.length) A.rules.counters = [...(Array.isArray(A.rules.counters) ? A.rules.counters : []), ...final.counters];
  for (const [k, { how, value }] of Object.entries(final.extra)) A[k] = how === 'append' ? [...A[k], ...value] : how === 'assign' ? { ...A[k], ...value } : value;
  for (const s of B2.rules.stats || []) if (!A.rules.stats.some(x => x.id === s.id)) { A.rules.stats.push(structuredClone(s)); report.stats.push(s.label || s.id); }
  for (const c of B2.rules.classes || []) if (!(A.rules.classes || []).some(x => x.id === c.id)) { (A.rules.classes ||= []).push(structuredClone(c)); report.classes.push(c.label || c.id); }
  const book = A.rules.spells.book || (A.rules.spells.book = []);
  for (const sp of B2.rules.spells?.book || []) if (!book.some(x => String(x.code).toUpperCase() === String(sp.code).toUpperCase())) { book.push(structuredClone(sp)); report.spells.push(String(sp.code).toUpperCase()); }
  for (const [k, v] of Object.entries(B2.rules)) if (A.rules[k] === undefined) A.rules[k] = structuredClone(v);
  if (B.meta.author && !A.meta.author?.includes(B.meta.author)) {
    const names = String(A.meta.author || '').split(/\s*(?:,|\bet\b)\s*/).filter(Boolean);
    A.meta.author = listFr([...names, B.meta.author]);
    lines.push({ kind: 'info', text: `Auteur·es : ${A.meta.author}.` });
  }
  if (options.link?.from) {
    const from = String(options.link.from).trim();
    if (baseIds.has(from)) {
      const text = oneLine(options.link.text) || `Continuer vers « ${B.meta.title} »`;
      A.sections[from].choices = [...(A.sections[from].choices || []), { text, to: newStart }];
      report.link = { from, to: newStart, text };
    } else warn(`Le paragraphe ${from} n’existe pas dans cette aventure : aucun choix n’a été ajouté pour relier les deux histoires.`);
  }

  // 7. Rapport lisible.
  report.sections = { count: ids.length, first: ids[0] ?? null, last: ids[ids.length - 1] ?? null, start: newStart ?? null };
  const head = ids.length
    ? `${plural(ids.length, 'paragraphe ajouté', 'paragraphes ajoutés')}, numérotés de ${ids[0]} à ${ids[ids.length - 1]}. Le départ de « ${B.meta.title} » devient le paragraphe ${newStart}.`
    : `« ${B.meta.title} » ne contient aucun paragraphe.`;
  lines.unshift({ kind: 'info', text: head });
  if (report.link) lines.push({ kind: 'info', text: `Nouveau choix au paragraphe ${report.link.from}, vers le ${report.link.to} : ${report.link.text}` });
  else if (ids.length && !report.warnings.some(w => w.includes('relier'))) lines.push({ kind: 'warning', text: `Aucun paragraphe de cette aventure ne mène encore au ${newStart} : ajoutez un choix pour relier les deux histoires.` });
  const kinds = [['items', 'Objet'], ['companions', 'Compagnon'], ['counters', 'Compteur']];
  for (const [k, label] of kinds) {
    for (const e of report[k].filter(x => x.status === 'renamed')) lines.push({ kind: 'rename', text: `${label} « ${e.name} » : l’identifiant « ${e.from} » existait déjà avec une autre définition ; il devient « ${e.to} ».` });
    const shared = report[k].filter(x => x.status === 'shared').map(x => x.name);
    if (shared.length) lines.push({ kind: 'info', text: `${label}${shared.length > 1 ? 's' : ''} identique${shared.length > 1 ? 's' : ''} dans les deux aventures, gardé${shared.length > 1 ? 's' : ''} une seule fois : ${listFr(shared)}.` });
    const plain = report[k].filter(x => x.status === 'added').length;
    if (plain) lines.push({ kind: 'info', text: `${plural(plain, `${label.toLowerCase()} ajouté`, `${label.toLowerCase()}s ajoutés`)}.` });
  }
  if (report.flags.common.length) lines.push({ kind: 'info', text: `Mots-clés utilisés dans les deux aventures (ils sont partagés) : ${listFr(report.flags.common)}.` });
  for (const f of report.flags.renamed) lines.push({ kind: 'rename', text: `Mot-clé « ${f.from} » de l’autre aventure renommé « ${f.to} ».` });
  if (report.stats.length) lines.push({ kind: 'info', text: `Caractéristique${report.stats.length > 1 ? 's' : ''} ajoutée${report.stats.length > 1 ? 's' : ''} : ${listFr(report.stats)}.` });
  if (report.classes.length) lines.push({ kind: 'info', text: `Classe${report.classes.length > 1 ? 's' : ''} ajoutée${report.classes.length > 1 ? 's' : ''} : ${listFr(report.classes)}.` });
  if (report.spells.length) lines.push({ kind: 'info', text: `Formule${report.spells.length > 1 ? 's' : ''} ajoutée${report.spells.length > 1 ? 's' : ''} au livre : ${listFr(report.spells)}.` });
  if (report.assets.length) lines.push({ kind: 'rename', text: `${plural(report.assets.length, 'fichier (image ou son) renommé', 'fichiers (images ou sons) renommés')} pour ne pas écraser ceux de cette aventure.` });
  if (B.rules.spells?.enabled && !A.rules.spells?.enabled) warn('L’autre aventure utilise des formules magiques, désactivées ici : activez-les dans l’onglet Règles si besoin.');
  if (B.rules.time?.enabled && !A.rules.time?.enabled) warn('L’autre aventure compte les jours, pas celle-ci : activez les journées dans l’onglet Règles si besoin.');
  if (broken.size) warn(`Renvois déjà cassés dans l’autre aventure (à corriger) : ${[...broken].slice(0, 8).join(', ')}${broken.size > 8 ? '…' : ''}.`);
  lines.push({ kind: 'info', text: `Les règles de « ${A.meta.title} » (combat, or, repas…) sont conservées.` });
  return { adventure: A, mapping, report, assetMap };
}
