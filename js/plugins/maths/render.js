// Rendu des formules avec KaTeX (copié dans js/lib/katex/, hors ligne). Aucun DOM : renderToString suffit.
// KaTeX est distribué en UMD : importé comme module, il s'installe sur `self.katex`.

import '../../lib/katex/katex.min.js';
import { frenchDecimal, frenchError } from './parse.js';

const katex = globalThis.katex;

/** Raccourcis utiles au collège et au lycée (\R, \N et \Z existent déjà dans KaTeX). */
export const MACROS = {
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
  '\\D': '\\mathbb{D}',
  '\\K': '\\mathbb{K}',
  '\\vect': '\\overrightarrow{#1}',
  // Intervalles à la française : f = fermé, o = ouvert. \intfo{0}{1} donne [0 ; 1[.
  '\\intff': '\\mathopen{[}#1\\,;\\,#2\\mathclose{]}',
  '\\intfo': '\\mathopen{[}#1\\,;\\,#2\\mathclose{[}',
  '\\intof': '\\mathopen{]}#1\\,;\\,#2\\mathclose{]}',
  '\\intoo': '\\mathopen{]}#1\\,;\\,#2\\mathclose{[}',
};

// Une copie des macros à chaque appel : un \gdef dans une formule ne déborde pas sur les autres.
const options = (display, throwOnError) => ({
  displayMode: display, throwOnError, output: 'htmlAndMathml', strict: 'ignore',
  errorColor: 'var(--loss)', macros: { ...MACROS },
});

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cache = new Map();
const CACHE_MAX = 1000;

/** HTML d'une formule (mis en cache : la lecture réaffiche le même paragraphe à chaque lancer de dés). */
export function renderTex(tex, display = false) {
  const key = (display ? 'D' : 'I') + tex;
  let out = cache.get(key);
  if (out === undefined) {
    try {
      out = katex.renderToString(frenchDecimal(tex), options(display, false));
    } catch (e) {
      out = `<span class="katex-error" title="${escHtml(frenchError(e.message))}">${escHtml(tex)}</span>`;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, out);
  }
  return out;
}

const checks = new Map();
/** Erreur d'une formule en français, ou null si elle est correcte. */
export function texError(tex, display = false) {
  const key = (display ? 'D' : 'I') + tex;
  if (!checks.has(key)) {
    let err = null;
    try { katex.renderToString(frenchDecimal(tex), options(display, true)); } catch (e) { err = frenchError(e.message); }
    if (checks.size >= CACHE_MAX) checks.delete(checks.keys().next().value);
    checks.set(key, err);
  }
  return checks.get(key);
}

export const katexVersion = katex?.version || '';
