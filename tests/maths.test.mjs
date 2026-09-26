// Greffon « maths » : extraction des formules ($…$, $$…$$) et rendu KaTeX, sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMath, restoreMath, formulasOf, frenchDecimal, frenchError } from '../js/plugins/maths/parse.js';

// KaTeX est distribué en UMD : dans Node, il s'installe sur `self` si on le lui fournit.
globalThis.self ??= globalThis;
const { renderTex, texError, MACROS } = await import('../js/plugins/maths/render.js');

const texs = s => extractMath(s).parts.filter(p => 'tex' in p).map(p => p.tex);
/** Chaîne complète comme dans common.js : extraction, échappement + gras/italique, réinsertion. */
function pipeline(src, render = (tex, d) => `[${d ? 'D' : 'I'}:${tex}]`) {
  const { src: s, parts } = extractMath(src);
  const esc = x => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const inline = x => x.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/_(.+?)_/g, '<em>$1</em>');
  const html = esc(s).split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => `<p>${inline(b).replace(/\n/g, '<br>')}</p>`).join('');
  return restoreMath(html, parts, render);
}

test('formule en ligne', () => {
  const r = extractMath('Si $x^2 = 4$, alors x vaut 2 ou −2.');
  assert.equal(r.parts.length, 1);
  assert.deepEqual(r.parts[0], { tex: 'x^2 = 4', display: false });
  assert.ok(!r.src.includes('$'));
  assert.equal(pipeline('Si $x^2 = 4$, alors'), '<p>Si [I:x^2 = 4], alors</p>');
});

test('formule centrée, seule dans son paragraphe ou au milieu du texte', () => {
  assert.deepEqual(texs('$$\\frac{a}{b}$$'), ['\\frac{a}{b}']);
  assert.equal(extractMath('$$ x+1 $$').parts[0].display, true);
  assert.equal(pipeline('Résolvez :\n\n$$x + 1 = 3$$\n\nPuis continuez.'),
    '<p>Résolvez :</p><div class="maths-bloc">[D:x + 1 = 3]</div><p>Puis continuez.</p>');
  assert.equal(pipeline('Soit $$a=b$$ ici'), '<p>Soit [D:a=b] ici</p>');
  // Sur plusieurs lignes (système), avec \\ à l'intérieur.
  const sys = '$$\\begin{cases}\nx + y = 10 \\\\\nx - y = 4\n\\end{cases}$$';
  assert.deepEqual(texs(sys), ['\\begin{cases}\nx + y = 10 \\\\\nx - y = 4\n\\end{cases}']);
});

test('les dollars isolés (montants) restent du texte', () => {
  for (const s of ['Le repas coûte 5 $ et la chambre 10 $.', 'Il a 12$ et moi 30$.', 'Entre $20 et $30 par nuit.',
    'Prix : 3$, puis 4$.', 'Un seul $ ici.', '$ x$', '$x $', '$$', '$$ $$', 'Fin de phrase $', '$5']) {
    const r = extractMath(s);
    assert.equal(r.parts.length, 0, s);
    assert.equal(r.src, s, s);
  }
  // Un montant à côté d'une vraie formule.
  assert.deepEqual(texs('Il paie $20 puis calcule $x+1$.'), ['x+1']);
  assert.deepEqual(texs('Coût 5 $ ; aire $a^2$'), ['a^2']);
});

test('\\$ échappé : un vrai dollar, et pas une formule', () => {
  assert.equal(pipeline('Il reste \\$5 et \\$10.'), '<p>Il reste $5 et $10.</p>');
  assert.equal(pipeline('\\$x\\$'), '<p>$x$</p>');
  assert.equal(extractMath('\\$x\\$').parts.filter(p => 'tex' in p).length, 0);
  // Dans une formule, \$ reste à KaTeX.
  assert.deepEqual(texs('Total : $5\\$ + 3\\$$'), ['5\\$ + 3\\$']);
});

test('plusieurs formules, dans l\'ordre, et formules dans le gras ou l\'italique', () => {
  assert.deepEqual(texs('$a$, $b$ et $$c$$ puis $d_1$'), ['a', 'b', 'c', 'd_1']);
  assert.equal(pipeline('**Calculez $x^2$ pour $x = 3$**'), '<p><strong>Calculez [I:x^2] pour [I:x = 3]</strong></p>');
  assert.equal(pipeline('*Indice : $u_n$ et $v_n$*'), '<p><em>Indice : [I:u_n] et [I:v_n]</em></p>');
  // Les _ et * d'une formule ne deviennent pas de l'italique.
  assert.equal(pipeline('$a_1 * b_2$ et $x_n$'), '<p>[I:a_1 * b_2] et [I:x_n]</p>');
  // Les < et & d'une formule ne sont pas échappés deux fois.
  assert.equal(pipeline('$a < b$ & $c > d$'), '<p>[I:a < b] &amp; [I:c > d]</p>');
});

test('une formule ne traverse pas un paragraphe', () => {
  assert.equal(extractMath('Coût $5\n\net $x$').parts.length, 1);
  assert.equal(extractMath('$$a\n\nb$$').parts.length, 0);
  assert.deepEqual(texs('$a +\nb$'), ['a +\nb']);
});

test('texte vide ou absent, et marqueurs rendus sans formule', () => {
  assert.deepEqual(extractMath(undefined), { src: '', parts: [] });
  assert.deepEqual(extractMath(null), { src: '', parts: [] });
  assert.equal(restoreMath('<p>rien</p>', [], () => 'X'), '<p>rien</p>');
  assert.deepEqual(formulasOf('$a$ et $$b$$ et \\$'), [{ tex: 'a', display: false }, { tex: 'b', display: true }]);
});

test('virgule décimale à la française', () => {
  assert.equal(frenchDecimal('\\pi \\approx 3,14'), '\\pi \\approx 3{,}14');
  assert.equal(frenchDecimal('\\{1, 2, 3\\}'), '\\{1, 2, 3\\}');
  assert.equal(frenchDecimal('f(x,y)'), 'f(x,y)');
});

test('messages d\'erreur en français', () => {
  assert.equal(frenchError('KaTeX parse error: Undefined control sequence: \\fracc at position 1: \\̲f̲r̲a̲c̲c̲'), 'Commande inconnue : \\fracc (caractère 1)');
  assert.match(frenchError("KaTeX parse error: Expected 'EOF', got '}' at position 4: x^2}̲"), /en trop/);
  assert.match(frenchError('KaTeX parse error: Double superscript at position 4: x^2^̲3'), /exposants/);
});

test('rendu KaTeX : HTML + MathML, couleur héritée, macros françaises, erreurs douces', () => {
  const h = renderTex('\\frac{1}{2}');
  assert.match(h, /class="katex"/);
  assert.match(h, /<math/);                       // MathML pour les lecteurs d'écran
  assert.doesNotMatch(h, /color:/);               // aucune couleur imposée : le texte garde celle du thème
  assert.match(renderTex('x = 1', true), /katex-display/);
  assert.equal(texError('\\D \\subset \\Q'), null);
  assert.equal(texError('\\vect{AB}'), null);
  for (const m of ['\\intff', '\\intfo', '\\intof', '\\intoo']) assert.equal(texError(`x \\in ${m}{0}{+\\infty}`), null, m);
  assert.match(renderTex('\\intfo{0}{1}'), /<mo[^>]*>\[<\/mo>[\s\S]*<mo[^>]*>\[<\/mo>/); // [0 ; 1[
  assert.ok(MACROS['\\D']);
  assert.match(texError('\\fracc{1}{2}'), /Commande inconnue/);
  assert.match(renderTex('\\frac{1}{'), /katex-error/); // formule cassée : pas d'exception
  assert.match(renderTex('3,14'), /<mn>3,14<\/mn>/);  // un seul nombre : pas d'espace après la virgule
  assert.equal(renderTex('\\sqrt{2}'), renderTex('\\sqrt{2}'));
  assert.match(pipeline('Aire : $\\pi r^2$', renderTex), /class="katex"/);
});
