// Version imprimable : l'aventure mise en page comme un livre-jeu papier.
// Les blocs interactifs (tests, combats, dés, formules, boutique) sont réécrits en instructions,
// la Feuille d'Aventure est générée, les numéros peuvent être mélangés. Impression ou PDF via le navigateur.

import { html, useState, useEffect, useMemo } from '../lib/preact-htm.js';
import { Icon, AssetImg, markdown, inlineMarkdown } from './common.js';
import { loadAdventure } from '../store/library.js';
import { statLabel, itemName, de } from '../core/rules.js';
import { renumber } from '../core/validate.js';
import { ext, findCondition } from '../core/plugins.js';
import { ui, sorted } from './registry.js';
import { makeRng, range } from '../core/dice.js';

const UP = (adv, id) => statLabel(adv, id).toUpperCase();
const plural = (n, one, many) => `${n} ${Math.abs(n) > 1 ? many : one}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tout ce qui vient de l'aventure est échappé : go() est aussi transmis aux greffons (h.go).
const go = n => `rendez-vous au <b>${esc(n)}</b>`;
/** Typographie du livre imprimé : espace fine insécable devant ; : ! ? » et après «, dans le texte
 *  seulement (jamais dans les balises), pour qu'aucune ligne ne commence par l'un de ces signes. */
const NNBSP = '\u202F';
const frTypo = h => String(h).split(/(<[^>]*>)/).map((p, i) => (i % 2 ? p
  : p.replace(/ ([;:!?»])/g, `${NNBSP}$1`).replace(/«[ \u00A0]/g, `«${NNBSP}`).replace(/\u00A0([;:!?»])/g, `${NNBSP}$1`))).join('');
/** Version échappée de UP(), pour le HTML des blocs. */
const UPe = (adv, id) => esc(UP(adv, id));

/* ---------- conditions et effets en français de livre ---------- */
export function condText(c, adv) {
  if (!c) return '';
  if (c.all) return c.all.map(x => condText(x, adv)).join(' et ');
  if (c.any) return c.any.map(x => condText(x, adv)).join(' ou ');
  const plug = findCondition(c);
  if (plug) return plug.print?.(c, adv) ?? plug.describe(c, adv);
  if (c.not) {
    const x = c.not;
    if (x.has) return `vous ne possédez pas : ${itemName(adv, x.has)}`;
    if (x.flag) return `vous n'avez pas noté le mot-clé « ${x.flag} »`;
    if (x.visited) return `vous n'êtes jamais passé par le ${x.visited}`;
    return `pas (${condText(x, adv)})`;
  }
  if (c.has) return `vous possédez : ${itemName(adv, c.has)}`;
  if (c.flag) return `vous avez noté le mot-clé « ${c.flag} »`;
  if (c.visited) return `vous êtes déjà passé par le ${c.visited}`;
  if (c.class) return `vous êtes ${adv.rules.classes.find(x => x.id === c.class)?.label || c.class}`;
  if (c.caster !== undefined) return c.caster ? 'vous savez lancer des formules' : 'vous ne savez pas lancer de formules';
  if (c.ate !== undefined) return c.ate ? 'vous avez mangé aujourd’hui' : 'vous n’avez pas encore mangé aujourd’hui';
  if (c.gold !== undefined && c.gte !== undefined) return `vous avez au moins ${plural(c.gte, 'Pièce d’Or', 'Pièces d’Or')}`;
  if (c.provisions !== undefined && c.gte !== undefined) return `il vous reste au moins ${plural(c.gte, 'repas', 'repas')}`;
  if (c.day !== undefined && c.gte !== undefined) return `vous êtes au jour ${c.gte} ou au-delà`;
  const what = c.stat ? `votre ${UP(adv, c.stat)}` : c.gold !== undefined ? 'votre nombre de Pièces d’Or' : c.day !== undefined ? 'le jour' : 'votre nombre de repas';
  if (c.gte !== undefined) return `${what} est de ${c.gte} ou plus`;
  if (c.lte !== undefined) return `${what} est de ${c.lte} ou moins`;
  if (c.eq !== undefined) return `${what} est exactement de ${c.eq}`;
  return '';
}

export function effectText(e, adv) {
  const cond = e.if ? `Si ${condText(e.if, adv)} : ` : '';
  let t = '';
  switch (e.op) {
    case 'stat':
      if (e.set === 'initial') t = `votre ${UP(adv, e.stat)} revient à son total de départ.`;
      else if (e.set !== undefined) t = `votre ${UP(adv, e.stat)} passe à ${e.set}.`;
      else if (e.addInitial) t = `${e.addInitial > 0 ? 'ajoutez' : 'retirez'} ${plural(Math.abs(e.addInitial), 'point', 'points')} à votre total de départ de ${UP(adv, e.stat)}.`;
      else t = `${e.add < 0 ? 'vous perdez' : 'vous gagnez'} ${plural(Math.abs(e.add), 'point', 'points')} ${de(UP(adv, e.stat))}.`;
      break;
    case 'gold': t = `${e.add < 0 ? 'retirez' : 'ajoutez'} ${plural(Math.abs(e.add), 'Pièce d’Or', 'Pièces d’Or')} ${e.add < 0 ? 'de' : 'à'} votre bourse.`; break;
    case 'provisions': t = `${e.add < 0 ? 'rayez' : 'ajoutez'} ${plural(Math.abs(e.add), 'repas', 'repas')} ${e.add < 0 ? 'de' : 'à'} vos Provisions.`; break;
    case 'give': t = `inscrivez sur votre Feuille d'Aventure : ${itemName(adv, e.item)}${e.qty > 1 ? ` (×${e.qty})` : ''}.`; break;
    case 'take': t = `rayez de votre Feuille d'Aventure : ${itemName(adv, e.item)}.`; break;
    case 'flag': t = e.value === false ? `rayez le mot-clé « ${e.flag} ».` : `notez le mot-clé « ${e.flag} » sur votre Feuille d'Aventure.`; break;
    case 'note': t = `notez : ${e.text}`; break;
    case 'newDay': {
      const tm = adv.rules.time || {};
      t = `un nouveau jour commence : cochez une case Jour.${tm.mealRequired !== false ? ` Si vous n'avez pas mangé hier, vous perdez ${plural(tm.penalty ?? 3, 'point', 'points')} ${de(UP(adv, tm.stat || 'endurance'))}.` : ''}`;
      break;
    }
    case 'meal': t = `vous prenez un repas : ${plural(e.heal ?? adv.rules.meal.heal, 'point', 'points')} ${de(UP(adv, adv.rules.meal.stat))} (sans dépasser votre total de départ).`; break;
    default: t = ext.effects.get(e.op)?.print?.(e, adv) ?? ext.effects.get(e.op)?.describe(e, adv) ?? '';
  }
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return cond + (cond ? t.charAt(0).toLowerCase() + t.slice(1) : t);
}

function blockHtml(b, adv) {
  const C = adv.rules.combat;
  if (b.type === 'test') {
    const luck = b.stat === C.luck;
    const cost = Number(b.cost ?? (luck ? 1 : 0)) || 0;
    const mod = Number(b.mod) || 0;
    return `<p class="pr-block"><b>${luck ? 'Tentez votre Chance' : `Testez votre ${esc(statLabel(adv, b.stat))}`}.</b> Lancez ${b.dice && b.dice !== '2d6' ? esc(b.dice) : 'deux dés'}${mod ? ` et ${mod > 0 ? 'retirez' : 'ajoutez'} ${Math.abs(mod)} au résultat` : ''} : si le total est inférieur ou égal à votre ${UPe(adv, b.stat)}, ${luck ? 'vous êtes Chanceux' : 'vous avez réussi'}${cost ? ` (dans tous les cas, retirez ${plural(cost, 'point', 'points')} ${esc(de(UP(adv, b.stat)))})` : ''}. ${luck ? 'Chanceux' : 'En cas de réussite'}, ${go(b.success)}. ${luck ? 'Malchanceux' : 'Sinon'}, ${go(b.failure)}.</p>`;
  }
  if (b.type === 'roll') {
    const rows = (b.table || []).map(t => `<tr><td>${t.min === t.max ? esc(t.min) : `${esc(t.min)} – ${esc(t.max)}`}</td><td>${esc(t.text || '')}</td><td>${go(t.to)}</td></tr>`).join('');
    return `<div class="pr-block"><p><b>${esc(b.label || '')}</b> Lancez ${b.dice === '1d6' || !b.dice ? 'un dé' : b.dice === '2d6' ? 'deux dés' : esc(b.dice)}${b.addStat ? ` et ajoutez votre ${UPe(adv, b.addStat)}` : ''} :</p><table class="pr-table"><tbody>${rows}</tbody></table></div>`;
  }
  if (b.type === 'combat') {
    const rows = (b.enemies || []).map(e => `<tr><td>${esc(String(e.name ?? '').toUpperCase())}</td><td>${UPe(adv, C.skill)} : ${esc(e.skill)}</td><td>${UPe(adv, C.health)} : ${esc(e.health)}</td></tr>`).join('');
    const parts = [];
    const H = esc(de(UP(adv, C.health), '’'));
    if ((b.enemies || []).length > 1) parts.push(b.mode === 'together' ? 'Ils vous attaquent tous en même temps : à chaque Assaut, choisissez celui que vous frappez ; contre les autres, vous ne faites que vous défendre.' : 'Combattez-les l’un après l’autre.');
    if (b.attackMod) parts.push(`Pendant ce combat, ${Number(b.attackMod) > 0 ? 'ajoutez' : 'retirez'} ${Math.abs(Number(b.attackMod)) || 0} à votre Force d’Attaque.`);
    if (b.stopAt) parts.push(`Le combat s’arrête dès que votre adversaire tombe à ${esc(b.stopAt)} points ${H} ou moins.`);
    parts.push(`Si vous êtes vainqueur, ${go(b.win)}.`);
    if (b.flee) parts.push(`Vous pouvez prendre la fuite${b.fleeAfter ? ` après ${esc(b.fleeAfter)} Assauts` : ''} en perdant ${esc(b.fleeDamage ?? C.fleeDamage)} points ${H} : ${go(b.flee)}.`);
    if (b.lose) parts.push(`Si vous êtes vaincu, ${go(b.lose)}.`);
    return `<div class="pr-block"><table class="pr-table pr-foes"><tbody>${rows}</tbody></table><p>${parts.join(' ')}</p></div>`;
  }
  if (b.type === 'shop') {
    const rows = (b.offers || []).map(o => `<li>${esc(itemName(adv, o.item))} : ${esc(plural(o.price, 'Pièce d’Or', 'Pièces d’Or'))}${o.stock ? ` (${esc(o.stock)} au plus)` : ''}</li>`).join('');
    const wants = (b.wants || []).map(o => `<li>${esc(itemName(adv, o.item))} : ${esc(plural(o.price, 'Pièce d’Or', 'Pièces d’Or'))}${o.stock ? ` (${esc(o.stock)} au plus)` : ''}</li>`).join('');
    return `<div class="pr-block"><p><b>${esc(b.label || 'Marchand')}.</b> Vous pouvez acheter (rayez l'or dépensé et inscrivez vos achats) :</p><ul>${rows}</ul>${wants ? `<p>Le marchand rachète (rayez l'objet vendu, ajoutez l'or) :</p><ul>${wants}</ul>` : ''}</div>`;
  }
  if (b.type === 'spells') {
    const sp = adv.rules.spells || {};
    const who = sp.casters?.length ? `Si vous êtes ${esc(sp.casters.map(c => adv.rules.classes.find(x => x.id === c)?.label || c).join(' ou '))}, vous` : 'Vous';
    const cells = (b.options || []).map(o => `<td><b>${esc(String(o.code).toUpperCase())}</b><br>${esc(o.to)}</td>`).join('');
    return `<div class="pr-block"><p>${who} pouvez utiliser l’une de ces formules${b.costInText ? '' : ` (retirez son coût de votre ${UPe(adv, sp.stat || 'endurance')}, voir le Livre des formules)`} : rendez-vous au numéro indiqué sous son code.</p><table class="pr-table pr-spells"><tbody><tr>${cells}</tr></tbody></table></div>`;
  }
  const plug = ext.blocks.get(b.type);
  if (plug?.print) return plug.print(b, adv, { go, esc, UP, plural, condText, effectText, markdown, inlineMarkdown });
  return '';
}

export function sectionHtml(sec, adv) {
  let h = markdown(sec.text);
  const fx = (sec.onEnter || []).map(e => effectText(e, adv)).filter(Boolean);
  if (fx.length) h += `<p class="pr-fx">${fx.map(esc).join(' ')}</p>`;
  h += (sec.blocks || []).map(b => blockHtml(b, adv)).join('');
  const ch = sec.choices || [];
  if (ch.length === 1 && !ch[0].if && !(ch[0].effects || []).length && !(sec.blocks || []).length) h += `<p class="pr-go">${inlineMarkdown(ch[0].text || '')}${ch[0].text ? ' : ' : ''}${go(ch[0].to).replace(/^r/, ch[0].text ? 'r' : 'R')}.</p>`;
  else if (ch.length) {
    h += '<ul class="pr-choices">' + ch.map(c => {
      const cond = c.if ? `<i>Si ${esc(condText(c.if, adv))}</i> — ` : '';
      const fxs = (c.effects || []).map(e => effectText(e, adv)).filter(Boolean);
      return `<li>${cond}${inlineMarkdown(c.text || 'Continuer')} : ${go(c.to)}.${fxs.length ? ` <span class="pr-small">(${esc(fxs.join(' '))})</span>` : ''}</li>`;
    }).join('') + '</ul>';
  }
  if (sec.ending) h += `<p class="pr-end">${esc(sec.endingTitle || (sec.ending === 'victory' ? 'VICTOIRE' : 'FIN')).toUpperCase()}</p>`;
  return frTypo(h);
}

/* ---------- règles et feuille d'aventure ---------- */
function Rules({ adv }) {
  const r = adv.rules, C = r.combat;
  const classes = r.classes || [];
  return html`<section class="pr-page pr-rules">
    <h2>Comment jouer</h2>
    <p>Pour ce voyage, il vous faut deux dés, un crayon et une gomme. Notez tout sur votre Feuille d'Aventure.</p>
    <h3>Vos caractéristiques</h3>
    <ul>${r.stats.map(s => html`<li><b>${s.label.toUpperCase()}</b> : lancez ${s.roll.replace('1d6', 'un dé').replace('2d6', 'deux dés').replace('+', ' et ajoutez ')} (de ${range(s.roll).min} à ${range(s.roll).max}).</li>`)}</ul>
    ${classes.length > 1 && html`<p>Choisissez votre classe : ${classes.map(c => html`<span><b>${c.label}</b>${c.description ? ` (${c.description})` : ''}${Object.entries(c.rolls || {}).filter(([, v]) => v).map(([k, v]) => ` ; ${statLabel(adv, k)} : ${v}`).join('')}. </span>`)}</p>`}
    <p>Ces totaux de départ ne peuvent pas être dépassés, sauf si le texte vous le dit. ${r.gold && r.gold !== '0' ? `Vous partez avec ${r.gold.replace('1d6', 'un dé').replace('2d6', 'deux dés').replace('+', ' + ')} Pièces d'Or.` : ''} Vous emportez ${plural(r.provisions, 'repas', 'repas')} : manger un repas rend ${r.meal.heal} points d'${UP(adv, r.meal.stat)}.</p>
    <h3>Les combats</h3>
    <ol>
      <li>Lancez deux dés pour votre adversaire et ajoutez son ${UP(adv, C.skill)} : c'est sa Force d'Attaque.</li>
      <li>Lancez deux dés pour vous et ajoutez votre ${UP(adv, C.skill)} : c'est votre Force d'Attaque.</li>
      <li>La plus forte blesse l'autre, qui perd ${C.damage} points d'${UP(adv, C.health)}. En cas d'égalité, personne n'est touché.</li>
      <li>Recommencez jusqu'à ce que l'un des deux tombe à zéro. Si c'est vous, votre aventure s'achève.</li>
    </ol>
    <p>Fuir un combat, quand le texte le permet, coûte ${C.fleeDamage} points d'${UP(adv, C.health)}.</p>
    <h3>La ${statLabel(adv, C.luck)}</h3>
    <p>Pour Tenter votre Chance, lancez deux dés : si le total est inférieur ou égal à votre ${UP(adv, C.luck)}, vous êtes Chanceux, sinon Malchanceux. Retirez 1 point de ${UP(adv, C.luck)} à chaque fois.
      En combat, après avoir blessé votre adversaire : Chanceux, il perd 2 points de plus ; Malchanceux, il en récupère 1. Après avoir été blessé : Chanceux, vous récupérez 1 point ; Malchanceux, vous en perdez 1 de plus.</p>
    ${r.time?.enabled && html`<h3>Les journées</h3><p>Quand le texte annonce un nouveau jour, cochez une case Jour. ${r.time.mealRequired !== false ? `Vous devez manger au moins un repas par jour : sinon, vous perdez ${r.time.penalty} points d'${UP(adv, r.time.stat)} le lendemain matin. Cochez la case « a mangé » quand vous mangez.` : ''}</p>`}
    ${r.spells?.enabled && html`<h3>La magie</h3><p>${r.spells.casters?.length ? `Seul${r.spells.casters.length > 1 ? 's' : ''} ${r.spells.casters.map(c => classes.find(x => x.id === c)?.label || c).join(' et ')} peu${r.spells.casters.length > 1 ? 'vent' : 't'} lancer des formules.` : ''} Chaque formule a un code de trois lettres et un coût en ${UP(adv, r.spells.stat)}. Le Livre des formules, à la fin de ce volume, les décrit toutes. Apprenez-les : pendant l'aventure, on ne vous rappellera que les codes, et certains sont des pièges.</p>`}
    ${r.allowBack === false && html`<p><b>Pas de retour en arrière :</b> ne gardez pas le doigt dans les pages !</p>`}
    ${sorted(ui.printSections.filter(x => x.where === 'rules')).map(x => html`<${x.Section} adv=${adv} />`)}
  </section>`;
}

function Sheet({ adv }) {
  const r = adv.rules;
  const boxes = n => html`<span class="pr-boxes">${Array.from({ length: n }, () => html`<i></i>`)}</span>`;
  return html`<section class="pr-page pr-sheet">
    <h2>Feuille d'Aventure</h2>
    <div class="pr-grid">
      <div class="pr-box"><b>Nom</b></div>
      ${(r.classes || []).length > 1 && html`<div class="pr-box"><b>Classe</b></div>`}
      ${r.stats.map(s => html`<div class="pr-box"><b>${s.label.toUpperCase()}</b><span class="pr-small">total de départ :</span></div>`)}
      <div class="pr-box"><b>PIÈCES D'OR</b></div>
      <div class="pr-box"><b>PROVISIONS</b><span class="pr-small">repas restants</span></div>
    </div>
    ${r.time?.enabled && html`<div class="pr-box pr-wide"><b>JOURS</b> ${boxes(10)} ${r.time.mealRequired !== false && html`<span style="margin-left:16px"><b>A MANGÉ</b> ${boxes(10)}</span>`}</div>`}
    <div class="pr-box pr-wide pr-tall"><b>ÉQUIPEMENT ET OBJETS</b></div>
    <div class="pr-grid">
      <div class="pr-box pr-tall"><b>MOTS-CLÉS</b></div>
      <div class="pr-box pr-tall"><b>NOTES</b></div>
    </div>
    <div class="pr-box pr-wide"><b>RENCONTRES AVEC DES ADVERSAIRES</b>
      <div class="pr-foes-grid">${Array.from({ length: 8 }, () => html`<div class="pr-foe">${statLabel(adv, r.combat.skill)} :<br/>${statLabel(adv, r.combat.health)} :</div>`)}</div></div>
    ${sorted(ui.printSections.filter(x => x.where === 'sheet')).map(x => html`<${x.Section} adv=${adv} />`)}
  </section>`;
}

/** Mesure la largeur naturelle (en em) de chaque formule centrée : la feuille de style d'impression
 *  s'en sert pour la réduire à la largeur de sa colonne (voir maths/style.css). */
function measureDisplays(root) {
  for (const d of root.querySelectorAll('.katex-display')) {
    const inner = d.querySelector('.katex-html') || d;
    const r = document.createRange();
    r.selectNodeContents(inner);
    const w = r.getBoundingClientRect().width, fs = parseFloat(getComputedStyle(d).fontSize) || 16;
    if (w > 0) d.style.setProperty('--kw', (w / fs).toFixed(3));
  }
}

/* ---------- écran ---------- */
export function Print({ id, query = {} }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [shuffle, setShuffle] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const [images, setImages] = useState(true);
  const [light, setLight] = useState(query.light !== '0'); // illustrations allégées : PDF bien plus petit
  const [cols, setCols] = useState(true);
  const [format, setFormat] = useState('A5');
  // Options des greffons (ex. version selon le mode de jeu) : appliquées à l'aventure avant la renumérotation.
  const [opts, setOpts] = useState(() => Object.fromEntries(ui.printOptions.map(o => [o.id, o.init?.(query)])));
  useEffect(() => { loadAdventure(id).then(setData).catch(e => setError(e.message)); }, [id]);
  useEffect(() => {
    if (!data) return undefined;
    let alive = true;
    const run = () => { const el = alive && document.querySelector('.print-book'); if (el) measureDisplays(el); };
    const t = setTimeout(() => (document.fonts?.ready || Promise.resolve()).then(run), 50);
    window.addEventListener('beforeprint', run);
    return () => { alive = false; clearTimeout(t); window.removeEventListener('beforeprint', run); };
  });
  const adv = useMemo(() => {
    if (!data) return null;
    let a = data.adventure;
    for (const o of sorted(ui.printOptions)) if (o.apply) a = o.apply(a, opts[o.id]) || a;
    return shuffle ? renumber(a, makeRng(seed)).adventure : a;
  }, [data, shuffle, seed, opts]);
  if (error) return html`<main class="page"><p>${error}</p></main>`;
  if (!adv) return html`<main class="page"><p class="muted">Préparation…</p></main>`;
  const ids = Object.keys(adv.sections).sort((a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b));
  const unprintable = ids.filter(i => (adv.sections[i].choices || []).some(c => c.hideIfUnavailable)).length;
  const book = adv.rules.spells?.enabled ? adv.rules.spells.book || [] : [];
  return html`<div class=${`print-root ${format} ${cols ? 'cols' : ''}`}>
    <style>${`@page { size: ${format === 'A5' ? '148mm 210mm' : 'A4'}; margin: ${format === 'A5' ? '12mm 11mm' : '16mm 15mm'}; }`}</style>
    <div class="page no-print print-controls">
      <span class="eyebrow">Version imprimable</span>
      <h1>${adv.meta.title}</h1>
      <div class="row">
        ${sorted(ui.printOptions).map(o => html`<${o.Control} key=${o.id} adv=${data.adventure} value=${opts[o.id]} set=${v => setOpts(x => ({ ...x, [o.id]: v }))} />`)}
        <label class="chk"><input type="checkbox" checked=${shuffle} onChange=${e => setShuffle(e.target.checked)} /> Mélanger les numéros</label>
        ${shuffle && html`<button class="btn small" onClick=${() => setSeed(Math.floor(Math.random() * 1e6))}>Autre tirage</button>`}
        <label class="chk"><input type="checkbox" checked=${images} onChange=${e => setImages(e.target.checked)} /> Illustrations</label>
        ${images && html`<label class="chk"><input type="checkbox" checked=${light} onChange=${e => setLight(e.target.checked)} /> Illustrations légères (PDF plus petit)</label>`}
        <label class="chk"><input type="checkbox" checked=${cols} onChange=${e => setCols(e.target.checked)} /> Deux colonnes</label>
        <div class="seg" role="group" aria-label="Format">${['A5', 'A4'].map(f => html`<button aria-pressed=${String(format === f)} onClick=${() => setFormat(f)}>${f}</button>`)}</div>
        <button class="btn primary" onClick=${() => window.print()}><${Icon} name="print" />Imprimer ou enregistrer en PDF</button>
      </div>
      <p class="subtle">Le numérotage mélangé ne modifie pas votre aventure : il ne sert qu'à l'impression. Les ambiances sonores ne s'impriment évidemment pas.
        ${unprintable ? ` ${unprintable} paragraphe(s) ont des choix « cachés si indisponibles » : sur papier ils apparaissent avec leur condition.` : ''}</p>
    </div>

    <article class="print-book" lang="fr">
      <section class="pr-page pr-cover">
        ${images && adv.meta.cover && html`<div class="pr-cover-img"><${AssetImg} adv=${adv} source=${data.source} path=${adv.meta.cover} alt="" eager light=${light ? 1200 : 0} /></div>`}
        <h1>${adv.meta.title}</h1>
        ${adv.meta.author && html`<p class="pr-author">${adv.meta.author}</p>`}
        ${adv.meta.description && html`<p class="pr-desc">${adv.meta.description}</p>`}
        <p class="pr-small">Une aventure dont vous êtes le héros · ${ids.length} paragraphes</p>
      </section>
      <${Rules} adv=${adv} />
      <${Sheet} adv=${adv} />
      <section class="pr-sections">
        <p class="pr-start">Commencez votre lecture au paragraphe ${adv.start}.</p>
        ${ids.map(i => { const s = adv.sections[i]; return html`<section class="pr-sec" key=${i}>
          <h3 class="pr-num">${i}</h3>
          ${images && s.image && html`<div class="pr-img"><${AssetImg} adv=${adv} source=${data.source} path=${s.image} alt="" eager light=${light ? 900 : 0} /></div>`}
          <div class="pr-text" dangerouslySetInnerHTML=${{ __html: sectionHtml(s, adv) }}></div>
        </section>`; })}
      </section>
      ${book.length > 0 && html`<section class="pr-page pr-spellbook">
        <h2>Le Livre des formules</h2>
        ${book.map(x => html`<p><b class="pr-code">${x.code}</b> ${x.name !== x.code ? html`<b>${x.name}.</b> ` : ''}${x.description} <i>Coût : ${x.cost} ${statLabel(adv, adv.rules.spells.stat)}.${x.requires ? ` Nécessite : ${itemName(adv, x.requires)}.` : ''}</i></p>`)}
      </section>`}
      ${sorted(ui.printSections.filter(x => x.where === 'appendix')).map(x => html`<section class="pr-page"><${x.Section} adv=${adv} /></section>`)}
    </article>
  </div>`;
}

