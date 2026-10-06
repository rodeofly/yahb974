// Greffon « objets » — interface : bloc « actions » (boutons en un clic : prendre un objet, payer, encaisser,
// perdre ou gagner des points) et emoji des objets. Voir docs/plugins/objets.md.
import { html } from '../../lib/preact-htm.js';
import { Icon, loadCSS } from '../../ui/common.js';
import { Text, EffectsEditor, ConditionEditor } from '../../ui/editor.js';
import { registerBlockUI, registerItemFields } from '../../ui/registry.js';
import { applyEffects, check, describeEffect, describeCondition } from '../../core/rules.js';
import { sfx } from '../../ui/audio.js';
import { TYPE, actionsOf, doAction } from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

function fxText(a, adv) { return (a.effects || []).map(e => describeEffect(e, adv)).join(' · '); }

function Player({ adv, state, index, block, update }) {
  const list = actionsOf(block, state, adv, index, check);
  if (!list.length) return null;
  const run = a => {
    const r = doAction(state, adv, index, a.i, applyEffects);
    if ((a.effects || []).some(e => e.op === 'gold')) sfx.coin?.();
    update(r.state, r.messages);
  };
  return html`<section class="block objets">
    <h3><${Icon} name="bag" />${block.label || 'Sur votre Feuille d’Aventure'}</h3>
    ${block.text && html`<p class="subtle" style="margin:0">${block.text}</p>`}
    <div class="actions-list">${list.map(a => html`<button type="button" key=${a.i}
        class=${'action-btn' + (a.done ? ' done' : '') + (!a.available ? ' locked' : '')}
        disabled=${(a.done && a.once !== false) || !a.available || !!state.ended}
        title=${!a.available && a.if ? `Il faut : ${describeCondition(a.if, adv)}` : fxText(a, adv)}
        aria-label=${`${a.label}${a.done ? ' (fait)' : ''}`}
        onClick=${() => run(a)}>
      <span class="emoji" aria-hidden="true">${a.icon || '•'}</span>
      <span><span>${a.label}</span><br/><span class="fx">${a.done && a.once !== false ? 'Fait' : fxText(a, adv)}</span></span>
    </button>`)}</div>
  </section>`;
}

function speech(block, { adv }) {
  return [block.label || 'Sur votre Feuille d’Aventure', ...(block.actions || []).map(a => `${a.label} : ${fxText(a, adv)}.`)].join(' ');
}

function Editor({ adv, block, set }) {
  const acts = block.actions || [];
  const upd = (i, patch) => set({ actions: acts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return html`<div class="stack" style="gap:10px">
    <${Text} label="Titre du bloc" value=${block.label || ''} onChange=${v => set({ label: v })} placeholder="Sur votre Feuille d’Aventure" />
    ${acts.map((a, i) => html`<div class="stack" key=${i} style="gap:6px;border:1px solid var(--line);border-radius:8px;padding:8px">
      <div class="row" style="align-items:flex-end">
        <div style="width:80px"><${Text} label="Emoji" value=${a.icon || ''} onChange=${v => upd(i, { icon: v })} placeholder="🗝️" /></div>
        <div style="flex:1"><${Text} label="Libellé" value=${a.label || ''} onChange=${v => upd(i, { label: v })} placeholder="Prendre la clé" /></div>
        <label class="row" style="gap:4px;padding-bottom:8px"><input type="checkbox" checked=${a.once !== false} onChange=${e => upd(i, { once: e.target.checked })} />Une seule fois</label>
        <button type="button" class="btn small danger" aria-label="Retirer l'action" onClick=${() => set({ actions: acts.filter((_, j) => j !== i) })}><${Icon} name="x" /></button>
      </div>
      <${EffectsEditor} value=${a.effects || []} onChange=${v => upd(i, { effects: v })} adv=${adv} />
      <${ConditionEditor} value=${a.if} onChange=${v => upd(i, { if: v || undefined })} adv=${adv} />
    </div>`)}
    <div><button type="button" class="btn small" onClick=${() => set({ actions: [...acts, { label: '', icon: '', effects: [], once: true }] })}><${Icon} name="plus" />Action</button></div>
  </div>`;
}

registerBlockUI(TYPE, {
  label: 'Objets et effets (un clic)', icon: 'bag', order: 15,
  create: () => ({ label: '', actions: [{ label: '', icon: '', effects: [], once: true }] }),
  Player, Editor, speech,
});

registerItemFields({
  id: 'objets-emoji', order: 5,
  Fields: ({ it, set }) => html`<div style="width:120px"><${Text} label="Emoji" value=${it.icon || ''} onChange=${v => set({ icon: v })} placeholder="🗝️" /></div>`,
});
