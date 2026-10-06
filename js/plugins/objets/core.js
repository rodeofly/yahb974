// Greffon « objets » — moteur pur : bloc « actions » (boutons en un clic qui appliquent des effets :
// prendre un objet, payer, encaisser de l'or, perdre ou gagner des points). Voir docs/plugins/objets.md.
import { registerBlock, ext } from '../../core/plugins.js';

export const TYPE = 'actions';

/** Actions disponibles d'un bloc (celles dont la condition est remplie), avec leur état « déjà faite ». */
export function actionsOf(block, state, adv, index, check) {
  const done = (state.blocks?.[index] || {}).done || {};
  return (block.actions || []).map((a, i) => ({
    ...a, i,
    done: !!done[i],
    available: !a.if || check(a.if, state, adv),
  }));
}

/** Applique l'action i : effets puis marque « faite » (si once ≠ false). */
export function doAction(state, adv, index, i, applyEffects) {
  const block = adv.sections[state.section].blocks[index];
  const a = (block.actions || [])[i];
  if (!a) return { state, messages: [] };
  const prev = state.blocks?.[index] || {};
  if (a.once !== false && prev.done?.[i]) return { state, messages: [] };
  const r = applyEffects(state, adv, a.effects || []);
  const done = { ...(prev.done || {}), [i]: true };
  return { state: { ...r.state, blocks: { ...r.state.blocks, [index]: { ...prev, done } } }, messages: r.messages };
}

export function validateActions(b, adv, report, where, h) {
  if (!(b.actions || []).length) report('warning', `${where} : aucune action.`);
  (b.actions || []).forEach((a, i) => {
    if (!a.label?.trim()) report('warning', `${where} : l'action n°${i + 1} n'a pas de libellé.`);
    if (!(a.effects || []).length) report('warning', `${where} : l'action « ${a.label || i + 1} » n'a aucun effet.`);
    h?.checkEffects?.(a.effects, adv, report, `${where}, action n°${i + 1}`);
    if (a.if) h?.checkCondition?.(a.if, adv, report, `${where}, action n°${i + 1}`);
  });
}

registerBlock(TYPE, {
  targets: () => [],
  remap: (b, m, remapCond) => ({ ...b, actions: (b.actions || []).map(a => (a.if ? { ...a, if: remapCond(a.if) } : a)) }),
  validate: validateActions,
  print: (b, adv, h) => `<div class="print-actions"><b>${h.esc(b.label || 'Sur votre Feuille d’Aventure')}</b><ul>${(b.actions || []).map(a =>
    `<li>${a.icon ? h.esc(a.icon) + ' ' : ''}${h.esc(a.label)}${(a.effects || []).length ? ' : ' + h.esc((a.effects || []).map(e => h.effectText(e)).join(', ')) : ''}${a.if ? ' (' + h.esc(h.condText(a.if)) + ')' : ''}</li>`).join('')}</ul></div>`,
});
export { ext };
