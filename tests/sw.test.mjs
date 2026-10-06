// Hors ligne : sw.js doit précharger tous les fichiers de l'application (cœur, interface, greffons, bibliothèques)
// et toutes les polices citées par les feuilles FONT_SHEETS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const list = name => [...sw.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const SHELL = list('SHELL');
const FONT_SHEETS = list('FONT_SHEETS');

const walk = dir => readdirSync(join(ROOT, dir)).flatMap(f => {
  const p = posix.join(dir, f);
  return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
});

test('sw.js : chaque fichier listé existe', () => {
  for (const f of [...SHELL, ...FONT_SHEETS]) if (f !== './') assert.ok(existsSync(join(ROOT, f)), `absent : ${f}`);
});

test('sw.js : tous les scripts et feuilles de style sont préchargés', () => {
  const needed = [...walk('js'), ...walk('css')].filter(f => /\.(js|css)$/.test(f));
  const missing = needed.filter(f => !SHELL.includes(f));
  assert.deepEqual(missing, [], 'à ajouter à SHELL dans sw.js');
});

test('sw.js : les polices citées par les feuilles existent', () => {
  let n = 0;
  for (const sheet of FONT_SHEETS) {
    const css = readFileSync(join(ROOT, sheet), 'utf8');
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/g)) {
      const p = posix.normalize(posix.join(posix.dirname(sheet), m[1]));
      assert.ok(existsSync(join(ROOT, p)), `police absente : ${p} (citée par ${sheet})`);
      n++;
    }
  }
  assert.ok(n > 20);
});

test('sw.js : le paquet zefor (vendor/zefor/) n’est pas préchargé, et un fichier absent hors ligne n’est pas remplacé par la page d’accueil', () => {
  assert.ok(!SHELL.some(f => f.startsWith('vendor/')), 'vendor/zefor/ ne doit pas être dans SHELL (mis en cache à la première utilisation)');
  assert.match(sw, /req\.mode === 'navigate' && \(await cache\.match\('index\.html'\)\)/);
});

test('sw.js et js/version.js annoncent la même version', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)[1];
  const app = readFileSync(join(ROOT, 'js/version.js'), 'utf8').match(/VERSION = '([^']+)'/)[1];
  assert.equal(app, sw);
});
