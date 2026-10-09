// Greffon « inventaire » — interface.
// - Le sac : onglets (catégories, collections, onglets des greffons : carte du monde, carnet…), une grille de cases
//   qu'on parcourt aussi aux flèches du clavier, et la fiche de l'objet choisi : description, indice selon le mode,
//   actions (Utiliser, Équiper…). Les objets trouvés depuis la dernière ouverture portent la marque « Nouveau ».
// - La feuille tenue par le livre (rules.sheet.locked) : on n'ajoute ni ne retire d'objet soi-même.
// - Le mode triche (rules.sheet.cheat) : un choix délibéré, définitif pour la partie, qui permet de tout débloquer.
// - L'éditeur : catégorie, étiquette et indices de chaque objet ; réglages de la feuille dans l'onglet Règles.
// Le moteur (vue du sac, triche, indices) est dans ./core.js. Voir docs/plugins/inventaire.md.

import { html, useState, useRef, useMemo } from '../../lib/preact-htm.js';
import { Icon, Modal, Prose, toast, confirmBox, loadCSS } from '../../ui/common.js';
import { ui, sorted, registerInventory, registerInventoryTab, registerItemFields, registerRulesSection } from '../../ui/registry.js';
import { Text, Num, Select } from '../../ui/editor.js';
import * as R from '../../core/rules.js';
import * as I from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/** Icône d'onglet : nom d'icône du moteur (« map ») ou émoji (« 🗝️ »). */
const TabIcon = ({ icon }) => (!icon ? null : /^[a-z][a-z-]*$/.test(icon)
  ? html`<${Icon} name=${icon} />` : html`<span class="emoji" aria-hidden="true">${icon}</span>`);

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const modeLabel = (adv, state) => (adv.rules.modes || []).find(m => m.id === state.mode)?.label || '';
/** Nombre minimal de cases d'un onglet d'objets : les cases vides font comprendre qu'il reste de la place. */
const MIN_SLOTS = 12;

/* ------------------------------------------------------------------ */
/* Le sac                                                              */
/* ------------------------------------------------------------------ */

function Inventory({ adv, source, state, update, onClose, tab: wanted }) {
  const view = I.inventoryView(adv, state);
  const extra = sorted(ui.inventoryTabs).filter(t => { try { return !!t.show(adv, state); } catch { return false; } });
  const tabs = [...view, ...extra.map(t => ({ id: 'x-' + t.id, kind: 'extra', label: t.label, icon: t.icon, def: t }))];
  const [tabId, setTabId] = useState(() => (tabs.find(t => t.id === wanted) || tabs.find(t => t.kind === 'category' && t.found) || tabs[0])?.id);
  const tab = tabs.find(t => t.id === tabId) || tabs[0];
  const [sel, setSel] = useState(null);
  // Les marques « Nouveau » restent affichées tant que le sac est ouvert ; elles disparaissent à la fermeture.
  const fresh = useMemo(() => new Set(I.newItems(state)), []);
  const edit = I.canEditItems(adv, state) && !state.ended;
  const gridRef = useRef();
  const slots = tab?.slots || [];
  const current = slots.find(s => s.id === sel) || slots.find(s => s.owned) || slots[0] || null;

  const close = () => { if (I.newItems(state).length) update(I.markSeen(state), null); onClose(); };
  const act = r => { if (!r) return; update(r.state, r.messages || []); (r.messages || []).forEach(m => toast(m.text)); };
  const pickTab = id => { setTabId(id); setSel(null); };

  const onKey = e => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'down', ArrowUp: 'up', Home: 'home', End: 'end' }[e.key];
    if (step === undefined || !slots.length || !gridRef.current) return;
    e.preventDefault();
    const cols = Math.max(1, getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').filter(Boolean).length);
    const i = Math.max(0, slots.findIndex(s => s.id === current?.id));
    let j = step === 'down' ? i + cols : step === 'up' ? i - cols : step === 'home' ? 0 : step === 'end' ? slots.length - 1 : i + step;
    j = Math.max(0, Math.min(slots.length - 1, j));
    setSel(slots[j].id);
    gridRef.current.querySelectorAll('.inv-slot:not(.filler)')[j]?.focus();
  };

  const count = Object.values(state.inventory || {}).filter(q => q > 0).length;
  return html`<${Modal} title=${`Ton sac · ${plural(count, 'objet', 'objets')}`} onClose=${close} wide>
    <div class="inv-sac" lang="fr">
      ${state.cheat && html`<p class="inv-cheat-banner" role="status"><span aria-hidden="true">🃏</span> Partie en mode triche : elle ne compte pas pour les succès.</p>`}
      <div class="inv-tabs" role="tablist" aria-label="Rangements du sac">
        ${tabs.map(t => html`<button role="tab" key=${t.id} class="inv-tab" aria-selected=${t.id === tab?.id ? 'true' : 'false'} onClick=${() => pickTab(t.id)}>
          <${TabIcon} icon=${t.icon} /><span>${t.label}</span>
          ${t.kind === 'collection' && html`<span class="inv-count mono">${t.found}/${t.total}</span>`}
          ${t.kind === 'category' && t.found > 0 && html`<span class="inv-count mono">${t.found}</span>`}
          ${t.kind !== 'extra' && t.slots.some(s => s.owned && fresh.has(s.id)) && html`<span class="inv-dot" aria-label="nouveau"></span>`}
        </button>`)}
      </div>

      ${tab?.kind === 'extra' ? html`<div class="inv-panel" role="tabpanel" aria-label=${tab.label}>
          <${tab.def.Tab} adv=${adv} source=${source} state=${state} update=${update} />
        </div>`
      : html`<div class="inv-panel inv-layout" role="tabpanel" aria-label=${tab?.label}>
          <div class="stack" style="gap:10px;min-width:0">
            ${tab?.message && html`<p class="inv-message" aria-label=${`Message : ${tab.message.map(m => (m.shown ? m.char : ' ')).join('')}`}>
              ${tab.message.map((m, k) => html`<span key=${k} class=${m.letter ? (m.shown ? 'on' : 'off') : 'gap'} aria-hidden="true">${m.letter ? (m.shown ? m.char : '·') : m.char}</span>`)}
            </p>`}
            ${slots.length || tab?.kind === 'category' ? html`<div class=${'inv-grid' + (tab?.kind === 'collection' ? ' coll' : '')} role="listbox" aria-label=${tab?.label} ref=${gridRef} onKeyDown=${onKey}>
              ${slots.map(s => { const it = adv.items[s.id] || { name: s.id }; const on = s.id === current?.id; return html`<button key=${s.id} role="option" aria-selected=${on ? 'true' : 'false'} tabindex=${on ? 0 : -1}
                  class=${'inv-slot' + (s.owned ? '' : ' missing') + (on ? ' sel' : '')} onClick=${() => setSel(s.id)}
                  aria-label=${s.owned ? `${it.name}${s.qty > 1 ? `, ${s.qty} exemplaires` : ''}${fresh.has(s.id) ? ', nouveau' : ''}` : `Case ${s.index + 1} : pas encore trouvé`}>
                  ${s.owned ? html`<span class="inv-ico" aria-hidden="true">${it.icon || '•'}</span>` : html`<span class="inv-ico" aria-hidden="true">?</span>`}
                  ${tab.kind === 'collection' && html`<span class="inv-num mono" aria-hidden="true">${s.index + 1}</span>`}
                  ${s.owned && it.tag && html`<span class="inv-tag" aria-hidden="true">${it.tag}</span>`}
                  ${s.qty > 1 && html`<span class="inv-qty mono" aria-hidden="true">×${s.qty}</span>`}
                  ${s.owned && fresh.has(s.id) && html`<span class="inv-new" aria-hidden="true">Nouveau</span>`}
                </button>`; })}
              ${tab?.kind === 'category' && Array.from({ length: Math.max(0, MIN_SLOTS - slots.length) }, (_, k) => html`<span key=${'f' + k} class="inv-slot filler" aria-hidden="true"></span>`)}
            </div>` : null}
            ${tab?.kind === 'category' && !slots.length && html`<p class="subtle" style="margin:0">Rien ici pour l'instant.</p>`}
            ${edit && html`<${AddItem} adv=${adv} state=${state} act=${act} />`}
          </div>
          <${Detail} key=${current?.id || 'vide'} adv=${adv} state=${state} slot=${current} kind=${tab?.kind} edit=${edit} act=${act} isNew=${current && fresh.has(current.id)} />
        </div>`}

      <${CheatPanel} adv=${adv} state=${state} act=${act} />
    </div>
  <//>`;
}

/** Fiche de l'objet choisi : grande icône, nom, description, indice selon le mode, actions. */
function Detail({ adv, state, slot, kind, edit, act, isNew }) {
  const [hintOpen, setHintOpen] = useState(false);
  if (!slot) return html`<aside class="inv-detail empty"><p class="subtle" style="margin:0">Choisis une case pour regarder l'objet de plus près.</p></aside>`;
  const it = adv.items[slot.id] || { name: slot.id };
  if (!slot.owned) {
    return html`<aside class="inv-detail" aria-live="polite">
      <span class="inv-big missing" aria-hidden="true">?</span>
      <h3>${kind === 'collection' ? `Case n° ${slot.index + 1}` : it.name}</h3>
      <p class="subtle" style="margin:0">Pas encore trouvé. Continue d'explorer…</p>
    </aside>`;
  }
  const hint = I.hintFor(it, state.mode);
  const mode = modeLabel(adv, state);
  const actions = state.ended ? [] : ui.itemActions.filter(a => { try { return a.show(it, state, adv, slot.id); } catch { return false; } });
  return html`<aside class="inv-detail" aria-live="polite">
    <span class="inv-big" aria-hidden="true">${it.icon || '•'}</span>
    <h3>${it.name}${slot.qty > 1 ? ` ×${slot.qty}` : ''}${isNew && html` <span class="badge">Nouveau</span>`}</h3>
    ${it.description ? html`<${Prose} text=${it.description} />` : html`<p class="subtle" style="margin:0">Pas de description.</p>`}
    ${hint && (hintOpen
      ? html`<div class="inv-hint" role="note"><span class="eyebrow"><span aria-hidden="true">💡</span> Indice${mode ? ` · ${mode}` : ''}</span><${Prose} text=${hint} /></div>`
      : html`<button class="btn small inv-hint-btn" onClick=${() => setHintOpen(true)}><span aria-hidden="true">💡</span>Un indice : à quoi peut-il servir ?</button>`)}
    ${(it.use?.length > 0 && !state.ended) || actions.length || edit ? html`<div class="row" style="gap:6px">
      ${it.use?.length > 0 && !state.ended && html`<button class="btn small primary" onClick=${() => act(R.useItem(state, adv, slot.id))}>Utiliser</button>`}
      ${actions.map(a => html`<button class="btn small" onClick=${() => act(a.run(state, adv, slot.id))}>${a.label(it, state, adv, slot.id)}</button>`)}
      ${edit && html`<button class="btn small ghost" title="Retirer du sac" onClick=${() => act(R.applyEffects(state, adv, [{ op: 'take', item: slot.id }]))}><${Icon} name="x" />Retirer</button>`}
    </div>` : null}
  </aside>`;
}

/** Ajouter un objet soi-même : feuille libre, ou partie en mode triche. */
function AddItem({ adv, state, act }) {
  const missing = Object.entries(adv.items || {}).filter(([id]) => !(state.inventory?.[id] > 0));
  if (!missing.length) return null;
  return html`<form class="row inv-add" style="gap:6px" onSubmit=${e => { e.preventDefault(); const id = new FormData(e.target).get('item'); if (id && adv.items[id]) act(R.applyEffects(state, adv, [{ op: 'give', item: id }])); }}>
    <select name="item" aria-label="Objet à ajouter au sac" style="flex:1;min-width:0">
      ${missing.map(([id, it]) => html`<option value=${id}>${it.icon ? it.icon + ' ' : ''}${it.name}</option>`)}
    </select>
    <button class="btn small" type="submit" title="Ajouter un objet que le texte vous donne"><${Icon} name="plus" />Ajouter</button>
  </form>`;
}

/** Mode triche : un choix délibéré, définitif pour la partie. */
function CheatPanel({ adv, state, act }) {
  if (!I.cheatAllowed(adv) || state.ended) return null;
  if (!state.cheat) {
    const ask = async () => {
      const ok = await confirmBox('Passer cette partie en mode triche ? Tu pourras ajouter des objets toi-même et tout débloquer. Mais la partie ne comptera plus : les succès ne seront pas enregistrés, et ton passeport dira que tu as triché. On ne peut pas revenir en arrière.', 'Activer la triche');
      if (ok) act(I.startCheat(state));
    };
    return html`<details class="inv-cheat"><summary>Mode triche</summary>
      <p class="subtle">Pour les grands qui veulent tout essayer, ou pour tester le livre. La partie ne comptera plus pour les succès.</p>
      <button class="btn small danger" onClick=${ask}>Activer le mode triche…</button>
    </details>`;
  }
  return html`<div class="inv-cheat on row">
    <span><span aria-hidden="true">🃏</span> <b>Mode triche</b> <span class="subtle">${state.cheat.unlocked ? '· tout est débloqué' : '· tu peux ajouter des objets, ou tout débloquer d\'un coup'}</span></span>
    <button class="btn small" onClick=${() => act(I.unlockAll(state, adv))}><${Icon} name="star" />Tout débloquer</button>
  </div>`;
}

registerInventory(Inventory);

/* ------------------------------------------------------------------ */
/* Onglet « Carnet » : les notes de la partie                          */
/* ------------------------------------------------------------------ */

registerInventoryTab({
  id: 'carnet', order: 90, label: 'Carnet', icon: 'book',
  show: () => true,
  Tab: ({ state, update }) => html`<div class="stack" style="gap:8px">
    <p class="subtle" style="margin:0">Ce que le livre t'a fait noter, et tes propres notes.</p>
    <label class="field" for="inv-notes">Notes<textarea id="inv-notes" rows="10" value=${state.notes || ''} onChange=${e => update({ ...state, notes: e.target.value }, null)}></textarea></label>
  </div>`,
});

/* ------------------------------------------------------------------ */
/* Éditeur                                                             */
/* ------------------------------------------------------------------ */

registerItemFields({
  id: 'inventaire', order: 30,
  Fields: ({ it, set, adv }) => {
    const cats = I.categoriesOf(adv);
    const modes = (adv.rules.modes || []).filter(m => m?.id);
    return html`<details class="inv-ed"><summary>Dans le sac : catégorie, étiquette, indice</summary>
      <div class="stack" style="gap:8px">
        ${cats.length > 1 && html`<${Select} label="Onglet du sac" value=${it.category || ''} onChange=${v => set({ category: v || undefined })}
          options=${[['', `Par défaut (${cats[0].label})`], ...cats.map(c => [c.id, c.label])]} />`}
        <${Text} label="Étiquette sur la case (une lettre, un numéro : facultatif)" value=${it.tag} onChange=${v => set({ tag: v.trim() || undefined })} placeholder="A" />
        <${Text} area rows="2" label="Indice : à quoi l'objet peut-il servir, sans tout dévoiler ?" value=${it.hint} onChange=${v => set({ hint: v || undefined })} placeholder="Ce que la nuit cache, elle le montre." />
        ${modes.map(m => html`<${Text} area rows="2" label=${`Indice pour le mode « ${m.label || m.id} » (vide = l'indice ci-dessus)`} value=${it.hints?.[m.id]}
          onChange=${v => { const h = { ...(it.hints || {}), [m.id]: v || undefined }; set({ hints: Object.values(h).some(Boolean) ? h : undefined }); }} />`)}
      </div>
    </details>`;
  },
});

registerRulesSection({
  id: 'inventaire', order: 35,
  Section: ({ adv, set }) => {
    const s = I.sheetRules(adv);
    const upd = patch => set({ sheet: { ...(adv.rules.sheet || {}), ...patch } });
    const problems = I.inventoryProblems(adv);
    return html`<details class="panel inv-rules" open=${s.locked || s.cheat}>
      <summary><b>Feuille et sac</b> <span class="subtle">— qui tient l'inventaire, mode triche</span></summary>
      <label class="row"><input type="checkbox" checked=${s.locked} onChange=${e => upd({ locked: e.target.checked })} /> Feuille tenue par le livre : le joueur n'ajoute ni ne retire d'objet lui-même</label>
      <label class="row"><input type="checkbox" checked=${s.cheat} onChange=${e => upd({ cheat: e.target.checked })} /> Permettre le mode triche (ajouter des objets, tout débloquer ; la partie ne compte plus pour les succès)</label>
      ${s.cheat && html`<div class="grid2">
        <${Num} label="Tout débloquer : pièces d'or en plus" value=${s.unlock.gold || ''} onChange=${v => upd({ unlock: { ...s.unlock, gold: Number(v) || 0 } })} />
      </div>`}
      <p class="subtle" style="margin:0">Les onglets du sac (catégories) et les collections se règlent dans le fichier de l'aventure : <code>rules.inventory</code> (voir docs/plugins/inventaire.md). La catégorie, l'étiquette et l'indice de chaque objet se règlent dans l'onglet Objets.</p>
      ${problems.length > 0 && html`<ul class="problems">${problems.map(p => html`<li><span class=${'lvl ' + p.level}>${p.level === 'error' ? 'Erreur' : 'Attention'}</span><span></span><span>${p.message}</span></li>`)}</ul>`}
    </details>`;
  },
});
