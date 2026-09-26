// Greffon « accessibilite » — partie pure (aucun DOM, testable dans Node).
// Préférences de confort de lecture → attributs data-* posés sur <html>, palettes « très contrasté »
// (jetons CSS de app.css redéfinis, contraste texte/fond ≥ 7:1 vérifié par les tests),
// géométrie du guide de lecture. L'interface (index.js) applique ces résultats au document.

/** Réglages par défaut : rien ne change par rapport à l'application sans greffon. */
export const DEFAULTS = Object.freeze({
  font: 'alegreya',   // alegreya | atkinson | opendyslexic
  scope: 'reading',   // reading (paragraphes et choix) | all (toute l'interface)
  leading: 'normal',  // normal | airy
  spacing: 'normal',  // normal | wide
  contrast: 'off',    // off | bw (noir sur blanc) | yb (jaune sur noir)
  motion: false,      // true : animations réduites même si l'appareil ne le demande pas
  guide: 'off',       // off | line (ligne survolée surlignée) | ruler (règle de lecture)
  print: false,       // true : police et espacements aussi dans la version imprimable
});

/** Choix proposés dans la fenêtre Réglages (valeur, libellé, précision). */
export const FONTS = [
  { id: 'alegreya', label: 'Alegreya', hint: 'La police du livre, avec empattements.', family: '"Alegreya", "Palatino Linotype", Georgia, serif' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', hint: 'Lettres très différentes les unes des autres (I, l, 1 ; O, 0).', family: '"Atkinson Hyperlegible", "Alegreya Sans", "Segoe UI", system-ui, sans-serif' },
  { id: 'opendyslexic', label: 'OpenDyslexic', hint: 'Lettres lestées vers le bas, pensée pour les lecteurs dyslexiques.', family: '"OpenDyslexic", "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif' },
];
export const CHOICES = {
  scope: [['reading', 'Texte de l’aventure'], ['all', 'Toute l’interface']],
  leading: [['normal', 'Normal'], ['airy', 'Aéré']],
  spacing: [['normal', 'Normal'], ['wide', 'Élargi']],
  contrast: [['off', 'Non'], ['bw', 'Noir sur blanc'], ['yb', 'Jaune sur noir']],
  guide: [['off', 'Aucun'], ['line', 'Ligne survolée'], ['ruler', 'Règle de lecture']],
};

/** Réglage conseillé pour les lecteurs dyslexiques (le texte est aussi aligné à gauche : voir index.js). */
export const DYSLEXIA = Object.freeze({ font: 'opendyslexic', leading: 'airy', spacing: 'wide' });

const VALID = {
  font: FONTS.map(f => f.id),
  scope: CHOICES.scope.map(c => c[0]),
  leading: CHOICES.leading.map(c => c[0]),
  spacing: CHOICES.spacing.map(c => c[0]),
  contrast: CHOICES.contrast.map(c => c[0]),
  guide: CHOICES.guide.map(c => c[0]),
};

/** Préférences lues du stockage (éventuellement anciennes, partielles ou abîmées) → objet complet et valide. */
export function normalizePrefs(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULTS };
  for (const k of Object.keys(VALID)) if (VALID[k].includes(src[k])) out[k] = src[k];
  out.motion = src.motion === true;
  out.print = src.print === true;
  return out;
}

export const isDefault = p => { const n = normalizePrefs(p); return Object.keys(DEFAULTS).every(k => n[k] === DEFAULTS[k]); };

/**
 * Attributs à poser sur <html> : { 'data-a11y-font': 'opendyslexic', … }.
 * Une valeur null signifie « retirer l'attribut » : avec les réglages par défaut, tout est null
 * et la page est exactement celle de l'application sans greffon.
 */
export function a11yAttributes(prefs) {
  const p = normalizePrefs(prefs);
  const typo = p.font !== 'alegreya' || p.leading !== 'normal' || p.spacing !== 'normal';
  return {
    'data-a11y-font': p.font !== 'alegreya' ? p.font : null,
    'data-a11y-scope': typo && p.scope === 'all' ? 'all' : null,
    'data-a11y-leading': p.leading === 'airy' ? 'airy' : null,
    'data-a11y-spacing': p.spacing === 'wide' ? 'wide' : null,
    'data-a11y-contrast': p.contrast !== 'off' ? p.contrast : null,
    'data-a11y-motion': p.motion ? 'reduce' : null,
    'data-a11y-guide': p.guide !== 'off' ? p.guide : null,
    'data-a11y-print': typo && p.print ? 'on' : null,
  };
}

/* ------------------------------------------------------------------ */
/* Palettes « très contrasté »                                         */
/* ------------------------------------------------------------------ */

/**
 * Chaque palette redéfinit TOUS les jetons de couleur de css/app.css (vérifié par les tests).
 * Texte (--ink, --muted, --accent, --loss, --gain) sur fonds (--ground, --surface, --paper, --sunk) : ≥ 7:1.
 * Les couleurs de catégorie du graphe (--combat, --spell, --normal) portent des étiquettes blanches.
 */
export const PALETTES = {
  bw: {
    scheme: 'light',
    tokens: {
      '--ground': '#FFFFFF', '--surface': '#FFFFFF', '--paper': '#FFFFFF', '--sunk': '#E6E6E6',
      '--ink': '#000000', '--muted': '#2E2E2E', '--line': '#000000',
      '--accent': '#00307A', '--accent-ink': '#FFFFFF',
      '--gold': '#FFC20A', '--death': '#000000', '--death-ink': '#FFFFFF',
      '--combat': '#8F3300', '--spell': '#00468C', '--normal': '#474747',
      '--loss': '#990000', '--gain': '#00552A',
    },
  },
  yb: {
    scheme: 'dark',
    tokens: {
      '--ground': '#000000', '--surface': '#000000', '--paper': '#000000', '--sunk': '#1C1C1C',
      '--ink': '#FFFF00', '--muted': '#F0F0F0', '--line': '#D6D600',
      '--accent': '#00FFFF', '--accent-ink': '#000000',
      '--gold': '#FFD700', '--death': '#FFFFFF', '--death-ink': '#000000',
      '--combat': '#9A3B00', '--spell': '#1050C7', '--normal': '#595959',
      '--loss': '#FF8C8C', '--gain': '#5CFF94',
    },
  },
};

/** Paires (texte, fond) qui doivent dépasser 7:1 dans chaque palette. */
export const TEXT_PAIRS = [
  ...['--ink', '--muted', '--accent', '--loss', '--gain'].flatMap(t => ['--ground', '--surface', '--paper', '--sunk'].map(b => [t, b])),
  ['--accent-ink', '--accent'], ['--death-ink', '--death'], ['--surface', '--ink'],
];

/** Luminance relative WCAG d'une couleur #RRGGBB. */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Couleur invalide : ${hex}`);
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Rapport de contraste WCAG entre deux couleurs (de 1 à 21). */
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Feuille de style des palettes, injectée une fois par index.js.
 * `:root:root[…]` l'emporte sur les thèmes clair/sombre de app.css, quel que soit l'ordre des feuilles.
 */
export function contrastCss(palettes = PALETTES) {
  return Object.entries(palettes).map(([id, p]) => `:root:root[data-a11y-contrast="${id}"] {\n  color-scheme: ${p.scheme};\n`
    + Object.entries(p.tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n') + '\n}').join('\n');
}

/* ------------------------------------------------------------------ */
/* Guide de lecture                                                    */
/* ------------------------------------------------------------------ */

/**
 * Bande d'une ligne de texte : la boîte d'un caractère (top, bottom) est centrée dans la hauteur de ligne
 * du paragraphe, pour couvrir exactement la ligne (interlignage compris).
 */
export function lineBand(glyph, lineHeight) {
  const h = Math.max(Number(lineHeight) || 0, glyph.bottom - glyph.top);
  const mid = (glyph.top + glyph.bottom) / 2;
  return { top: Math.round(mid - h / 2), height: Math.round(h) };
}

/** Règle de lecture : deux caches (au-dessus, au-dessous) laissant voir la bande, bornés à l'écran. */
export function rulerMasks(band, viewportHeight, pad = 4) {
  const top = Math.max(0, band.top - pad);
  const bottom = Math.min(viewportHeight, band.top + band.height + pad);
  return { above: { top: 0, height: top }, below: { top: bottom, height: Math.max(0, viewportHeight - bottom) }, window: { top, height: Math.max(0, bottom - top) } };
}
