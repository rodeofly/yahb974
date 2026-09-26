// Onglet « Maths » de l'éditeur : règles d'écriture, essai en direct, exemples à copier,
// vérification de toutes les formules de l'aventure et aperçu du paragraphe en cours.

import { html, useState, useRef } from '../../lib/preact-htm.js';
import { Icon, Prose, markdown, toast } from '../../ui/common.js';
import { extractMath, restoreMath, formulasOf } from './parse.js';
import { renderTex, texError } from './render.js';

/* ---------- exemples (programmes du collège et du lycée) ---------- */
// [nom, code TeX, formule centrée ?]
const GROUPS = [
  ['Nombres et calculs', [
    ['Fraction', '\\frac{3}{4}'],
    ['Grande fraction', '\\dfrac{2x+1}{3}'],
    ['Puissance', '10^{-3}'],
    ['Écriture scientifique', '6,02 \\times 10^{23}'],
    ['Racine carrée', '\\sqrt{2} \\approx 1,414'],
    ['Racine cubique', '\\sqrt[3]{27} = 3'],
    ['Pourcentage', '15\\,\\%'],
  ]],
  ['Équations et systèmes', [
    ['Équation', '2x + 3 = 11'],
    ['Identité remarquable', '(a+b)^2 = a^2 + 2ab + b^2'],
    ['Inégalités', '-2 \\leqslant x < 5'],
    ['Système', '\\begin{cases} x + y = 10 \\\\ x - y = 4 \\end{cases}', true],
  ]],
  ['Fonctions et suites', [
    ['Fonction', 'f(x) = 3x^2 - 2x + 1'],
    ['Flèche « associe »', 'f : x \\mapsto 2x + 3'],
    ['Suite', 'u_{n+1} = 2u_n + 1'],
    ['Somme', '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}', true],
    ['Limite', '\\lim_{x \\to +\\infty} \\frac{1}{x} = 0', true],
  ]],
  ['Géométrie et vecteurs', [
    ['Vecteur', '\\vec{u}'],
    ['Vecteur AB (raccourci \\vect)', '\\vect{AB}'],
    ['Relation de Chasles', '\\vect{AB} + \\vect{BC} = \\vect{AC}'],
    ['Coordonnées', '\\vec{u}\\begin{pmatrix} 2 \\\\ -1 \\end{pmatrix}'],
    ['Norme', '\\|\\vec{u}\\| = 5'],
    ['Angle', '\\widehat{ABC} = 60^\\circ'],
    ['Parallèles, perpendiculaires', '(AB) \\parallel (CD) \\quad (d) \\perp (d\')'],
    ['Pythagore', 'BC^2 = AB^2 + AC^2'],
  ]],
  ['Ensembles et intervalles', [
    ['Appartenance', 'x \\in \\R'],
    ['Ensembles de nombres', '\\N \\subset \\Z \\subset \\D \\subset \\Q \\subset \\R'],
    ['Intervalles (raccourcis \\intff, \\intfo, \\intof, \\intoo)', 'x \\in \\intfo{0}{1} \\cup \\intoo{3}{+\\infty}'],
    ['Entiers de 1 à n', 'k \\in \\llbracket 1 ; n \\rrbracket'],
  ]],
  ['Probabilités', [
    ['Intersection', 'P(A \\cap B) = P(A) \\times P_A(B)'],
    ['Contraire', 'P(\\overline{A}) = 1 - P(A)'],
    ['Coefficient binomial', '\\binom{5}{2} = 10'],
  ]],
  ['Logique et algorithmique', [
    ['Implication, équivalence', 'A \\Rightarrow B \\quad A \\Leftrightarrow B'],
    ['Et, ou, non', 'A \\land B \\quad A \\lor B \\quad \\lnot A'],
    ['Quantificateurs', '\\forall x \\in \\R,\\ \\exists n \\in \\N'],
    ['Affectation', 'x \\leftarrow x + 1'],
    ['Texte et unités', 'AB = 5\\text{ cm}'],
  ]],
];
const wrap = (tex, display) => (display ? `$$${tex}$$` : `$${tex}$`);
const TRIAL = 'Le sphinx vous barre la route : « Combien vaut $\\dfrac{3}{4} + \\dfrac{1}{4}$ ? »\n\n$$x^2 = 16$$\n\nLe passeur demande 5 $ : un dollar isolé reste un montant.';

/* ---------- formules de l'aventure ---------- */
const byNumber = (a, b) => (Number(a) || 1e9) - (Number(b) || 1e9) || a.localeCompare(b);
/** Toutes les chaînes d'un objet (blocs des greffons : questions, indices…). */
const stringsOf = (x, out = []) => {
  if (typeof x === 'string') { if (x.includes('$')) out.push(x); }
  else if (x && typeof x === 'object') Object.values(x).forEach(v => stringsOf(v, out));
  return out;
};
const scans = new WeakMap();
/** [{ section, where, tex, display, error }] pour toute l'aventure (mis en cache par version de l'aventure). */
export function adventureFormulas(adv) {
  if (scans.has(adv)) return scans.get(adv);
  const list = [];
  const add = (section, where, text) => formulasOf(text).forEach(f => list.push({ section, where, ...f, error: texError(f.tex, f.display) }));
  for (const sid of Object.keys(adv.sections || {}).sort(byNumber)) {
    const s = adv.sections[sid];
    add(sid, 'Texte', s.text);
    (s.choices || []).forEach((c, i) => add(sid, `Choix n°${i + 1}`, c.text));
    (s.blocks || []).forEach((b, i) => stringsOf(b).forEach(t => add(sid, `Bloc ${i + 1} (${b.type})`, t)));
  }
  scans.set(adv, list);
  return list;
}

export function mathsTabLabel(adv) {
  const n = adventureFormulas(adv).filter(f => f.error).length;
  return n ? `Maths (${n})` : 'Maths';
}

/* ---------- petits outils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Texte d'une ligne (choix) avec ses formules. */
const inlineHtml = text => { const { src, parts } = extractMath(text); return restoreMath(esc(src), parts, renderTex); };

async function copyText(text) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? `Copié : ${text}` : 'Copie impossible : sélectionnez le code à la main.');
}

/* ---------- l'onglet ---------- */
export function MathsTab({ adv, change, open, current }) {
  const [trial, setTrial] = useState(TRIAL);
  const trialRef = useRef();
  const sec = adv.sections[current];
  const all = adventureFormulas(adv);
  const errors = all.filter(f => f.error);
  const tryIt = code => { setTrial(code); trialRef.current?.focus(); trialRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const append = () => {
    if (!sec || !trial.trim()) return;
    change(a => { const s = a.sections[current]; s.text = s.text?.trim() ? `${s.text.trimEnd()}\n\n${trial.trim()}` : trial.trim(); return a; });
    toast(`Ajouté à la fin du paragraphe ${current}.`);
  };

  return html`<div class="ed-form maths-aide">
    <section class="panel" aria-labelledby="maths-regles">
      <header><h3 id="maths-regles"><${Icon} name="book" /> Écrire des formules</h3></header>
      <ul class="maths-rules">
        <li>Dans le texte : entre deux dollars, <code class="maths-code">$\\frac{1}{2}$</code> donne ${html`<span dangerouslySetInnerHTML=${{ __html: renderTex('\\frac{1}{2}') }}></span>`}.</li>
        <li>Formule centrée sur sa ligne : entre deux doubles dollars, <code class="maths-code">$$x^2 = 16$$</code>.</li>
        <li>Un dollar isolé reste un montant (« 5 $ », « 12$ ») ; <code class="maths-code">\\$</code> écrit un dollar collé à du texte.</li>
        <li>La virgule décimale est à la française : <code class="maths-code">$3,14$</code> s'affiche sans espace. Pour une liste, mettez une espace : <code class="maths-code">$\\{1, 2, 3\\}$</code>.</li>
        <li>Formules possibles dans le texte des paragraphes, les choix et les blocs qui affichent du texte mis en forme. Raccourcis : <code class="maths-code">\\R \\N \\Z \\D \\Q \\C</code>, <code class="maths-code">\\vect{AB}</code>, intervalles <code class="maths-code">\\intfo{0}{1}</code> pour ${html`<span dangerouslySetInnerHTML=${{ __html: renderTex('\\intfo{0}{1}') }}></span>`} (f : fermé, o : ouvert).</li>
      </ul>
    </section>

    <section class="panel" aria-labelledby="maths-verif">
      <header><h3 id="maths-verif"><${Icon} name="check" /> Formules de l'aventure</h3></header>
      ${!all.length ? html`<p class="subtle" style="margin:0">Aucune formule pour l'instant.</p>`
        : !errors.length ? html`<p class="outcome ok" style="margin:0">${all.length === 1 ? 'La formule de l’aventure est correcte.' : `Les ${all.length} formules de l’aventure sont correctes.`}</p>`
        : html`<p class="outcome ko" style="margin:0">${errors.length} formule${errors.length > 1 ? 's' : ''} à corriger sur ${all.length}</p>
          <ul class="problems">${errors.map(f => html`<li>
            <span class="lvl error">Erreur</span>
            <button class="btn small mono" onClick=${() => open(f.section)} aria-label=${`Ouvrir le paragraphe ${f.section}`}>${f.section}</button>
            <span>${f.where} : <code class="maths-code">${wrap(f.tex, f.display)}</code><br />${f.error}</span>
          </li>`)}</ul>`}
    </section>

    ${sec && html`<section class="panel" aria-labelledby="maths-apercu">
      <header><h3 id="maths-apercu"><${Icon} name="sheet" /> Aperçu du paragraphe ${current}</h3>
        <button class="btn small" onClick=${() => open(current)}><${Icon} name="edit" />Modifier</button></header>
      <div class="maths-preview" lang="fr">
        ${sec.text?.trim() ? html`<${Prose} text=${sec.text} />` : html`<p class="subtle" style="margin:0">Texte vide.</p>`}
        ${(sec.choices || []).length > 0 && html`<ul class="maths-choices" aria-label="Choix">${sec.choices.map(c => html`<li>
          <span dangerouslySetInnerHTML=${{ __html: inlineHtml(c.text || 'Continuer') }}></span><span class="mono">→ ${c.to || '?'}</span></li>`)}</ul>`}
      </div>
    </section>`}

    <section class="panel" aria-labelledby="maths-essai">
      <header><h3 id="maths-essai"><${Icon} name="edit" /> Essayer</h3></header>
      <label class="field" for="maths-trial">Texte d'essai, écrit comme dans un paragraphe
        <textarea id="maths-trial" rows="5" ref=${trialRef} value=${trial} onInput=${e => setTrial(e.target.value)} spellcheck="false"></textarea></label>
      <div class="maths-preview" lang="fr" aria-live="polite" aria-label="Aperçu de l'essai">
        <div class="prose" dangerouslySetInnerHTML=${{ __html: markdown(trial) }}></div>
      </div>
      <div class="row">
        <button class="btn small" onClick=${() => copyText(trial)}>Copier le texte</button>
        ${sec && html`<button class="btn small" disabled=${!trial.trim()} onClick=${append}><${Icon} name="plus" />Ajouter à la fin du paragraphe ${current}</button>`}
        <button class="btn small ghost" onClick=${() => setTrial('')}>Effacer</button>
      </div>
    </section>

    <section class="panel" aria-labelledby="maths-exemples">
      <header><h3 id="maths-exemples"><${Icon} name="star" /> Exemples à copier</h3></header>
      <p class="subtle" style="margin:0">« Copier » met le code, dollars compris, dans le presse-papiers : collez-le dans le texte d'un paragraphe.</p>
      ${GROUPS.map(([title, items]) => html`<div class="maths-group">
        <h4>${title}</h4>
        <div class="maths-grid">${items.map(([name, tex, display]) => { const code = wrap(tex, display); return html`<div class="maths-ex">
          <span class="nom">${name}</span>
          <div class="rendu" dangerouslySetInnerHTML=${{ __html: renderTex(tex, !!display) }}></div>
          <code class="maths-code">${code}</code>
          <div class="row">
            <button class="btn small" onClick=${() => copyText(code)} aria-label=${`Copier le code : ${name}`}>Copier</button>
            <button class="btn small ghost" onClick=${() => tryIt(code)} aria-label=${`Essayer : ${name}`}>Essayer</button>
          </div>
        </div>`; })}</div>
      </div>`)}
    </section>
  </div>`;
}
