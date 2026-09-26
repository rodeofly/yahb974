// Formules mathématiques dans les textes : $…$ (en ligne) et $$…$$ (formule centrée).
// Partie pure, sans DOM ni KaTeX : testable dans Node (tests/maths.test.mjs).
//
// Règles (celles de Pandoc, plus une précaution pour les montants) :
//  - $$…$$ : formule centrée ; elle ne traverse pas une ligne vide.
//  - $…$   : le $ ouvrant est suivi d'un caractère non blanc et n'est pas précédé d'un chiffre ;
//            le $ fermant est précédé d'un caractère non blanc et n'est pas suivi d'un chiffre.
//            Ainsi « 5 $ », « 12$ », « $20 et $30 » restent des montants.
//  - \$    : un vrai signe dollar, hors formule. Dans une formule, \$ est laissé à KaTeX.

const OPEN = '\uE000m', CLOSE = '\uE001';
const MARK = /\uE000m(\d+)\uE001/g;
const LONE_BLOCK = /<p>\uE000m(\d+)\uE001<\/p>/g;

const isBlank = c => c === undefined || /\s/.test(c);
const isDigit = c => c !== undefined && c >= '0' && c <= '9';
/** Une ligne vide commence-t-elle au saut de ligne s[j] ? */
const blankLineAt = (s, j) => s[j] === '\n' && /^[ \t]*\r?\n/.test(s.slice(j + 1, j + 64));

/** Fin d'une formule centrée ouverte avant `from` : indice du $$ fermant, ou -1. */
function displayEnd(s, from) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (blankLineAt(s, j)) return -1;
    if (s[j] === '$' && s[j + 1] === '$') return j;
  }
  return -1;
}

/** Fin d'une formule en ligne ouverte en `i` : indice du $ fermant, ou -1. */
function inlineEnd(s, i) {
  if (isBlank(s[i + 1]) || isDigit(s[i - 1])) return -1;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (blankLineAt(s, j)) return -1;
    if (s[j] === '$') return !isBlank(s[j - 1]) && !isDigit(s[j + 1]) ? j : -1;
  }
  return -1;
}

/**
 * Met de côté les formules d'un texte avant la mise en forme Markdown.
 * @param {string} input texte de l'auteur
 * @returns {{ src: string, parts: Array<{ tex: string, display: boolean } | { text: string }> }}
 *   `src` contient des marqueurs uniques (caractères d'usage privé) ; `parts[n]` est le morceau du marqueur n.
 */
export function extractMath(input) {
  const s = String(input ?? '');
  const parts = [];
  let out = '';
  const mark = part => { out += OPEN + parts.length + CLOSE; parts.push(part); };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '$') { mark({ text: '$' }); i += 2; continue; }
    if (c !== '$') { out += c; i++; continue; }
    if (s[i + 1] === '$') {
      const end = displayEnd(s, i + 2);
      const tex = end > 0 ? s.slice(i + 2, end).trim() : '';
      if (tex) { mark({ tex, display: true }); i = end + 2; } else { out += '$$'; i += 2; }
      continue;
    }
    const end = inlineEnd(s, i);
    if (end > 0) { mark({ tex: s.slice(i + 1, end), display: false }); i = end + 1; } else { out += '$'; i++; }
  }
  return { src: out, parts };
}

/**
 * Réinsère les formules dans le HTML produit à partir de `extractMath(…).src`.
 * Un paragraphe qui ne contient qu'une formule centrée devient un bloc <div class="maths-bloc">.
 * @param {string} html
 * @param {Array} parts
 * @param {(tex: string, display: boolean) => string} render HTML d'une formule
 */
export function restoreMath(html, parts, render) {
  if (!parts.length) return html;
  const put = n => { const p = parts[n]; return !p ? '' : 'text' in p ? p.text : render(p.tex, p.display); };
  return html
    .replace(LONE_BLOCK, (m, n) => (parts[n]?.display ? `<div class="maths-bloc">${put(+n)}</div>` : m))
    .replace(MARK, (m, n) => put(+n));
}

/** Formules d'un texte, dans l'ordre : [{ tex, display }]. */
export const formulasOf = text => extractMath(text).parts.filter(p => 'tex' in p);

/**
 * Virgule décimale à la française (comme le paquet LaTeX icomma) : « 3,14 » s'écrit sans espace après la virgule.
 * Une virgule suivie d'une espace reste une ponctuation : $\{1, 2, 3\}$.
 */
export const frenchDecimal = tex => String(tex).replace(/(\d),(?=\d)/g, '$1{,}');

/** Message d'erreur KaTeX (anglais) → phrase courte en français pour l'auteur. */
export function frenchError(message) {
  const m = String(message || '').replace(/^KaTeX parse error:\s*/, '');
  const pos = m.match(/at position (\d+)/)?.[1];
  const where = pos ? ` (caractère ${pos})` : '';
  const rules = [
    [/Undefined control sequence: (\\\S+?)(?= at|$)/, x => `Commande inconnue : ${x[1]}`],
    [/Unexpected end of input in a macro argument, expected '\}'/, () => 'Accolade fermante « } » manquante'],
    [/Expected 'EOF', got '\}'/, () => 'Accolade fermante « } » en trop'],
    [/Expected '\}', got 'EOF'/, () => 'Accolade fermante « } » manquante'],
    [/Expected group after '(.+?)'/, x => `Il manque ce qui suit ${x[1]} (entre accolades)`],
    [/Double superscript/, () => 'Deux exposants de suite : ajoutez des accolades, par exemple x^{2^3}'],
    [/Double subscript/, () => 'Deux indices de suite : ajoutez des accolades, par exemple u_{n_1}'],
    [/Missing \\right|Expected '\\right'/, () => '\\left sans \\right correspondant'],
    [/No such environment: (\S+)/, x => `Environnement inconnu : ${x[1]}`],
    [/Mismatch: \\begin\{(\S+?)\} matched by \\end\{(\S+?)\}/, x => `\\begin{${x[1]}} fermé par \\end{${x[2]}}`],
    [/Expected '(.+?)', got '(.+?)'/, x => `« ${x[1]} » attendu à la place de « ${x[2]} »`],
  ];
  for (const [re, fr] of rules) { const x = m.match(re); if (x) return fr(x) + where; }
  return m.replace(/ at position \d+:[\s\S]*$/, '') + where;
}
