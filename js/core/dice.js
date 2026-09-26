// Dés et générateur aléatoire à graine (mulberry32).
// L'état du générateur est un simple entier : il se sauvegarde avec la partie.

export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.state = () => s;
  return rng;
}

/** "2d6+3" → { count: 2, sides: 6, mod: 3 } ; un nombre seul → { count: 0, sides: 6, mod: n } */
export function parseDice(expr) {
  const e = String(expr).replace(/\s+/g, '').toLowerCase();
  if (/^[+-]?\d+$/.test(e)) return { count: 0, sides: 6, mod: Number(e) };
  const m = e.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!m) throw new Error(`Formule de dés invalide : « ${expr} »`);
  return { count: Number(m[1] || 1), sides: Number(m[2]), mod: Number(m[3] || 0) };
}

export function isDice(expr) {
  try { parseDice(expr); return true; } catch { return false; }
}

/** Lance une formule. Renvoie { total, dice: [valeurs], mod, expr }. */
export function roll(expr, rng) {
  const { count, sides, mod } = parseDice(expr);
  const dice = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
  return { total: dice.reduce((a, b) => a + b, 0) + mod, dice, mod, expr: String(expr) };
}

/** Bornes d'une formule, utile pour l'éditeur et la validation. */
export function range(expr) {
  const { count, sides, mod } = parseDice(expr);
  return { min: count + mod, max: count * sides + mod };
}
