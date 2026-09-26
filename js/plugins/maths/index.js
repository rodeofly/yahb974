// Greffon « maths » : écriture mathématique dans les textes ($…$ en ligne, $$…$$ centré), rendue par KaTeX.
// Tout est hors ligne : KaTeX et ses polices sont copiés dans js/lib/katex/. Voir docs/plugins/maths.md.

import { registerMarkdown, registerEditorTab } from '../../ui/registry.js';
import { loadCSS } from '../../ui/common.js';
import { extractMath, restoreMath } from './parse.js';
import { renderTex } from './render.js';
import { MathsTab, mathsTabLabel } from './aide.js';

loadCSS(new URL('../../lib/katex/katex.min.css', import.meta.url));
loadCSS(new URL('./style.css', import.meta.url));

/* Le texte passe ici avant l'échappement HTML : les formules sont mises de côté, puis réinsérées rendues. */
registerMarkdown({
  before(src) {
    const { src: out, parts } = extractMath(src);
    if (!parts.length) return { src: out };
    return { src: out, after: html => restoreMath(html, parts, renderTex) };
  },
});

registerEditorTab({ id: 'maths', order: 60, label: mathsTabLabel, Tab: MathsTab });

/* Hors ligne : les polices KaTeX sont préchargées par le service worker (FONT_SHEETS de sw.js). */
