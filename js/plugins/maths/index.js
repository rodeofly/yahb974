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
    return { src: out, after: html => { if (parts.some(p => 'tex' in p)) warmFonts(); return restoreMath(html, parts, renderTex); } };
  },
});

registerEditorTab({ id: 'maths', order: 60, label: mathsTabLabel, Tab: MathsTab });

/* Hors ligne : le navigateur ne télécharge une police KaTeX qu'à sa première utilisation. Dès qu'une formule
   s'affiche, on demande toutes les polices (≈ 300 Ko) pour que le service worker les garde en cache. */
const FONTS = ['AMS-Regular', 'Caligraphic-Bold', 'Caligraphic-Regular', 'Fraktur-Bold', 'Fraktur-Regular', 'Main-Bold',
  'Main-BoldItalic', 'Main-Italic', 'Main-Regular', 'Math-BoldItalic', 'Math-Italic', 'SansSerif-Bold', 'SansSerif-Italic',
  'SansSerif-Regular', 'Script-Regular', 'Size1-Regular', 'Size2-Regular', 'Size3-Regular', 'Size4-Regular', 'Typewriter-Regular'];
let warmed = false;
function warmFonts() {
  if (warmed || typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;
  warmed = true;
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1500));
  idle(() => FONTS.forEach(f => fetch(new URL(`../../lib/katex/fonts/KaTeX_${f}.woff2`, import.meta.url)).catch(() => {})));
}
