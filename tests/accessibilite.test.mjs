import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS, DYSLEXIA, FONTS, CHOICES, normalizePrefs, isDefault, a11yAttributes,
  PALETTES, TEXT_PAIRS, luminance, contrastRatio, contrastCss, lineBand, rulerMasks,
} from '../js/plugins/accessibilite/core.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

test('accessibilité : préférences absentes, anciennes ou abîmées → réglages par défaut', () => {
  assert.deepEqual(normalizePrefs(undefined), DEFAULTS);
  assert.deepEqual(normalizePrefs(null), DEFAULTS);
  assert.deepEqual(normalizePrefs('texte'), DEFAULTS);
  assert.deepEqual(normalizePrefs([1, 2]), DEFAULTS);
  const p = normalizePrefs({ font: 'comic-sans', scope: 'tout', leading: 'airy', contrast: 'bw', motion: 'oui', guide: 'ruler', print: 1, inconnu: 3 });
  assert.equal(p.font, 'alegreya');
  assert.equal(p.scope, 'reading');
  assert.equal(p.leading, 'airy');
  assert.equal(p.contrast, 'bw');
  assert.equal(p.motion, false, 'seul true active la réduction des animations');
  assert.equal(p.guide, 'ruler');
  assert.equal(p.print, false);
  assert.ok(!('inconnu' in p));
  assert.ok(isDefault({}));
  assert.ok(!isDefault({ spacing: 'wide' }));
});

test('accessibilité : normalizePrefs ne modifie pas l’objet reçu', () => {
  const raw = Object.freeze({ font: 'atkinson', guide: 'line' });
  const p = normalizePrefs(raw);
  assert.notEqual(p, raw);
  assert.equal(p.font, 'atkinson');
});

test('accessibilité : réglages par défaut → aucun attribut (application inchangée)', () => {
  const attrs = a11yAttributes(DEFAULTS);
  assert.ok(Object.keys(attrs).every(k => k.startsWith('data-a11y-')));
  assert.ok(Object.values(attrs).every(v => v === null));
});

test('accessibilité : attributs calculés à partir des préférences', () => {
  const a = a11yAttributes({ font: 'opendyslexic', scope: 'all', leading: 'airy', spacing: 'wide', contrast: 'yb', motion: true, guide: 'line', print: true });
  assert.deepEqual(a, {
    'data-a11y-font': 'opendyslexic', 'data-a11y-scope': 'all', 'data-a11y-leading': 'airy', 'data-a11y-spacing': 'wide',
    'data-a11y-contrast': 'yb', 'data-a11y-motion': 'reduce', 'data-a11y-guide': 'line', 'data-a11y-print': 'on',
  });
  // Portée et impression n'ont de sens que si la typographie change.
  const b = a11yAttributes({ scope: 'all', print: true, contrast: 'bw' });
  assert.equal(b['data-a11y-scope'], null);
  assert.equal(b['data-a11y-print'], null);
  assert.equal(b['data-a11y-contrast'], 'bw');
  assert.equal(a11yAttributes({ leading: 'airy', scope: 'all' })['data-a11y-scope'], 'all');
});

test('accessibilité : réglage conseillé pour la dyslexie', () => {
  const p = normalizePrefs({ ...DEFAULTS, contrast: 'yb', ...DYSLEXIA });
  assert.equal(p.font, 'opendyslexic');
  assert.equal(p.contrast, 'yb', 'le contraste choisi est conservé');
  const a = a11yAttributes(p);
  assert.equal(a['data-a11y-leading'], 'airy');
  assert.equal(a['data-a11y-spacing'], 'wide');
});

test('accessibilité : chaque choix proposé est accepté tel quel', () => {
  for (const f of FONTS) assert.equal(normalizePrefs({ font: f.id }).font, f.id);
  for (const [k, list] of Object.entries(CHOICES)) for (const [v, label] of list) {
    assert.equal(normalizePrefs({ [k]: v })[k], v);
    assert.ok(label.length > 2);
  }
});

test('accessibilité : contraste WCAG (valeurs de référence)', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#FFFFFF'), 1);
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(Math.round(contrastRatio('#767676', '#FFFFFF') * 10) / 10, 4.5);
  assert.throws(() => luminance('rouge'));
});

test('accessibilité : palettes très contrastées ≥ 7:1 pour tout texte sur tout fond', () => {
  for (const [id, pal] of Object.entries(PALETTES)) {
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = contrastRatio(pal.tokens[fg], pal.tokens[bg]);
      assert.ok(r >= 7, `${id} : ${fg} sur ${bg} = ${r.toFixed(2)} (< 7)`);
    }
    // Étiquettes blanches (numéros) du graphe sur les couleurs de catégorie, et étiquette sombre de la victoire.
    for (const k of ['--combat', '--spell', '--normal']) assert.ok(contrastRatio('#FFFFFF', pal.tokens[k]) >= 6.99, `${id} : blanc sur ${k}`);
    assert.ok(contrastRatio('#1E1E1E', pal.tokens['--gold']) >= 7, `${id} : étiquette de victoire`);
    // Bordures (repères de forme) : au moins 3:1 contre le fond (WCAG 1.4.11).
    assert.ok(contrastRatio(pal.tokens['--line'], pal.tokens['--ground']) >= 3, `${id} : bordures`);
  }
});

test('accessibilité : les palettes redéfinissent tous les jetons de couleur de app.css', () => {
  const css = read('css/app.css');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const colorTokens = [...rootBlock.matchAll(/(--[a-z-]+):\s*#[0-9A-Fa-f]{6}/g)].map(m => m[1]);
  assert.ok(colorTokens.length >= 15, 'jetons trouvés dans app.css');
  for (const [id, pal] of Object.entries(PALETTES)) {
    for (const t of colorTokens) assert.ok(pal.tokens[t], `${id} : ${t} manquant`);
    assert.ok(['light', 'dark'].includes(pal.scheme));
  }
});

test('accessibilité : feuille des palettes, plus spécifique que les thèmes clair/sombre', () => {
  const css = contrastCss();
  assert.match(css, /:root:root\[data-a11y-contrast="bw"\] \{/);
  assert.match(css, /:root:root\[data-a11y-contrast="yb"\] \{/);
  assert.match(css, /color-scheme: dark;/);
  assert.match(css, /--ink: #FFFF00;/);
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});

test('accessibilité : guide de lecture (bande de ligne et caches de la règle)', () => {
  // Caractère de 20 px de haut dans une ligne de 32 px : la bande est centrée sur le caractère.
  assert.deepEqual(lineBand({ top: 100, bottom: 120 }, 32), { top: 94, height: 32 });
  // Interlignage inconnu ou plus petit que le caractère : la bande couvre au moins le caractère.
  assert.deepEqual(lineBand({ top: 10, bottom: 30 }, 0), { top: 10, height: 20 });
  const m = rulerMasks({ top: 94, height: 32 }, 800);
  assert.deepEqual(m.above, { top: 0, height: 90 });
  assert.deepEqual(m.window, { top: 90, height: 40 });
  assert.deepEqual(m.below, { top: 130, height: 670 });
  // Bornée à l'écran.
  const edge = rulerMasks({ top: -10, height: 30 }, 800);
  assert.equal(edge.above.height, 0);
  assert.ok(edge.window.top >= 0);
  const low = rulerMasks({ top: 790, height: 30 }, 800);
  assert.equal(low.below.height, 0);
});

test('accessibilité : polices incluses avec leur licence et déclarées dans style.css', () => {
  const css = read('js/plugins/accessibilite/style.css');
  const urls = [...css.matchAll(/url\(\.\.\/\.\.\/\.\.\/(fonts\/accessibilite\/[^)]+)\)/g)].map(m => m[1]);
  assert.equal(urls.length, 12);
  for (const u of urls) assert.ok(existsSync(fileURLToPath(new URL(u, root))), `${u} absent`);
  for (const f of ['LICENSE-AtkinsonHyperlegible', 'LICENSE-OpenDyslexic']) assert.match(read(`fonts/accessibilite/${f}`), /SIL Open Font License/);
  assert.match(read('THIRD_PARTY.md'), /fonts\/accessibilite/);
});
