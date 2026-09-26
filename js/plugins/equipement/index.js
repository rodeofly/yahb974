// Greffon « equipement » — interface : feuille d'aventure, actions du sac, combat, éditeur, impression.

import './core.js';
import { html, useState } from '../../lib/preact-htm.js';
import { Icon, loadCSS, confirmBox, toast } from '../../ui/common.js';
import { Text, Num, Select } from '../../ui/editor.js';
import { itemName, slug } from '../../core/rules.js';
import {
  registerSheetPanel, registerItemAction, registerItemFields, registerRulesSection, registerEffectUI,
  registerConditionUI, registerCombatPanel, registerPrintSection, registerCreatorPanel,
} from '../../ui/registry.js';
import {
  defaults, isOn, slotsOf, slotLabel, itemSlot, capacityOf, penaltyOf, weaponSlotOf, resolve, equippedOf, isEquipped,
  bagOf, bonuses, bonusText, equip, unequip, drop, pickUp, droppedHere,
} from './core.js';

loadCSS(new URL('./style.css', import.meta.url));

/* ---------- petits tracés propres au greffon (pas d'émoji) ---------- */
const G = {
  shield: '<path d="M12 3l8 3v6c0 4.6-3.4 8.2-8 9-4.6-.8-8-4.4-8-9V6z"/><path d="M12 3v18"/>',
  pack: '<path d="M7 7h10a3 3 0 0 1 3 3v10H4V10a3 3 0 0 1 3-3z"/><path d="M9 7V5a3 3 0 0 1 6 0v2M4 14h16M10 14v2h4v-2"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".8" fill="currentColor"/>',
};
const Glyph = ({ name }) => html`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: G[name] }}></svg>`;

const plural = (n, one, many = one + 's') => `${n} ${Math.abs(n) > 1 ? many : one}`;
const wearables = adv => Object.entries(adv.items).filter(([id]) => itemSlot(adv, id)).map(([id, it]) => [id, `${it.name} (${slotLabel(adv, it.slot)})`]);
const slotOptions = adv => slotsOf(adv).map(s => [s.id, s.label]);
const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Total des bonus en une ligne : « +1 Force d'Attaque · +1 dégât infligé · −1 dégât subi ». */
function totalText(b) {
  const out = [];
  if (b.attack) out.push(`${signed(b.attack)} Force d'Attaque`);
  if (b.damage) out.push(`${signed(b.damage)} dégât${Math.abs(b.damage) > 1 ? 's' : ''} infligé${Math.abs(b.damage) > 1 ? 's' : ''}`);
  if (b.armor) out.push(`${signed(-b.armor)} dégât${Math.abs(b.armor) > 1 ? 's' : ''} subi${Math.abs(b.armor) > 1 ? 's' : ''}`);
  return out.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Feuille d'aventure                                                  */
/* ------------------------------------------------------------------ */

/** Jauge du sac : une case par place (pleine, vide, ou hachurée au-delà de la capacité) + les chiffres. */
function BagMeter({ bag }) {
  const { load, capacity, over } = bag;
  const cells = capacity <= 24;
  const label = `Sac à dos : ${load} place${load > 1 ? 's' : ''} occupée${load > 1 ? 's' : ''} sur ${capacity}`;
  return html`<div class=${'eq-cap' + (over ? ' over' : '')}>
    <div class="eq-cap-head"><span class="row" style="gap:6px"><${Glyph} name="pack" />Place dans le sac</span><b class="mono">${load} / ${plural(capacity, 'place')}</b></div>
    <div class="eq-meter" role="meter" aria-valuemin="0" aria-valuemax=${capacity} aria-valuenow=${load} aria-label=${label}>
      ${cells ? html`
        ${Array.from({ length: capacity }, (_, i) => html`<i class=${i < load ? 'on' : ''}></i>`)}
        ${over > 0 && html`<span class="eq-sep" aria-hidden="true"></span>${Array.from({ length: over }, () => html`<i class="x"></i>`)}`}`
      : html`<span class="eq-fill" style=${`width:${Math.min(100, (100 * load) / capacity)}%`}></span>`}
    </div>
    ${over ? html`<p class="eq-warn" role="alert"><${Glyph} name="warn" />Sac trop plein : abandonnez ${plural(over, 'objet')} pour pouvoir continuer.</p>`
      : load === capacity ? html`<p class="subtle" style="margin:0">Sac plein : le prochain objet ne rentrera pas.</p>` : null}
  </div>`;
}

function EquipPanel({ adv, state, update }) {
  if (!isOn(adv)) return null;
  const eq = equippedOf(state, adv);
  const b = bonuses(state, adv);
  const bag = bagOf(state, adv);
  const dropped = droppedHere(state);
  const run = r => update(r.state, r.messages);
  const total = totalText(b);
  return html`<section class="eq-panel" aria-labelledby="eq-title">
    <span class="eyebrow" id="eq-title">Équipement</span>
    <ul class="eq-slots">
      ${slotsOf(adv).map(s => {
        const id = eq[s.id];
        const bonus = id ? bonusText(adv.items[id]) : '';
        return html`<li class=${'eq-slot' + (id ? '' : ' empty')} key=${s.id}>
          <span class="eq-label">${s.label}</span>
          ${id ? html`<span class="eq-item">${itemName(adv, id)}</span>` : html`<span class="eq-item" aria-label="aucun objet">—</span>`}
          ${id && !state.ended ? html`<button class="btn small" aria-label=${`Ranger ${itemName(adv, id)} dans le sac`} onClick=${() => run(unequip(state, adv, s.id))}>Ranger</button>` : html`<span></span>`}
          ${bonus && html`<span class="eq-bonus">${bonus}</span>`}
        </li>`;
      })}
    </ul>
    ${total && html`<p class="eq-total"><${Glyph} name="shield" /><span>En combat : <b>${total}</b></span></p>`}
    ${b.unarmed && html`<p class="eq-warn"><${Glyph} name="warn" />Sans ${slotLabel(adv, weaponSlotOf(adv)).toLowerCase()} : −${penaltyOf(adv)} Force d'Attaque en combat.</p>`}
    ${bag.capacity > 0 && html`<${BagMeter} bag=${bag} />`}
    ${dropped.length > 0 && !state.ended && html`<div class="eq-dropped">
      <span class="subtle">Laissé${dropped.length > 1 ? 's' : ''} ici, vous pouvez encore le${dropped.length > 1 ? 's' : ''} reprendre :</span>
      <div class="row" style="gap:4px">${dropped.map(([id, q]) => html`<button class="btn small" onClick=${() => run(pickUp(state, adv, id))}>
        <${Icon} name="up" />Reprendre ${itemName(adv, id)}${q > 1 ? ` (${q})` : ''}</button>`)}</div>
    </div>`}
  </section>`;
}

registerSheetPanel({ id: 'equipement', order: 10, Panel: EquipPanel });

/* ---------- boutons à côté des objets du sac ---------- */
registerItemAction({
  id: 'equipement-equiper',
  show: (it, state, adv, id) => isOn(adv) && !!itemSlot(adv, id) && !isEquipped(state, adv, id),
  label: () => 'Équiper',
  run: (state, adv, id) => equip(state, adv, id),
});
registerItemAction({
  id: 'equipement-ranger',
  show: (it, state, adv, id) => isOn(adv) && isEquipped(state, adv, id),
  label: () => 'Ranger',
  run: (state, adv, id) => unequip(state, adv, Object.entries(equippedOf(state, adv)).find(([, x]) => x === id)?.[0]),
});
registerItemAction({
  id: 'equipement-abandonner',
  show: (it, state, adv) => isOn(adv) && capacityOf(adv) > 0,
  label: () => 'Abandonner',
  run: (state, adv, id) => drop(state, adv, id),
});

/* ---------- combat : détail des bonus ---------- */
registerCombatPanel({
  id: 'equipement', order: 10,
  Panel({ adv, state }) {
    if (!isOn(adv)) return null;
    const b = bonuses(state, adv);
    if (!b.lines.length) return null;
    return html`<div class="eq-combat" aria-label="Bonus de l'équipement">
      <span class="eq-combat-title"><${Glyph} name="shield" />Équipement</span>
      <ul>${b.lines.map(l => html`<li class=${l.kind}>${l.kind === 'unarmed' ? html`<${Glyph} name="warn" />` : html`<${Icon} name="check" />`}<span><b>${l.label}</b> : ${l.text}</span></li>`)}</ul>
    </div>`;
  },
});

/* ---------- création du héros : équipement de départ ---------- */
registerCreatorPanel({
  id: 'equipement', order: 20,
  Panel({ adv, classId, hero }) {
    if (!isOn(adv)) return null;
    let st = hero?.state;
    if (!st) {
      const cls = (adv.rules.classes || []).find(c => c.id === classId) || adv.rules.classes?.[0];
      const inventory = {};
      for (const it of [...(adv.rules.startItems || []), ...(cls?.items || [])]) inventory[it] = (inventory[it] || 0) + 1;
      st = { inventory };
    }
    const eq = resolve(st, adv).equipped;
    const worn = slotsOf(adv).filter(s => eq[s.id]).map(s => `${itemName(adv, eq[s.id])} (${s.label})`);
    const cap = capacityOf(adv);
    return html`<div class="rollrow eq-start">
      <b>Équipement</b>
      <span>${worn.length ? worn.join(', ') : 'aucun objet porté'}${cap ? html`<span class="subtle"> · sac de ${plural(cap, 'place')}</span>` : ''}</span>
      <${Glyph} name="shield" />
    </div>`;
  },
});

/* ------------------------------------------------------------------ */
/* Éditeur                                                             */
/* ------------------------------------------------------------------ */

registerItemFields({
  id: 'equipement', order: 20,
  Fields({ it, set, adv }) {
    if (!isOn(adv)) return null;
    const lost = it.slot && !slotsOf(adv).some(s => s.id === it.slot);
    const n = v => (v ? v : undefined);
    const preview = bonusText(it);
    return html`<fieldset class="eq-fields">
      <legend>Équipement</legend>
      <div class="grid2">
        <${Select} label="Se porte à l'emplacement" value=${lost ? '' : it.slot || ''} onChange=${v => set({ slot: v || undefined })} options=${[['', 'ne se porte pas'], ...slotOptions(adv)]} />
        <${Num} label="Force d'Attaque (+/−)" value=${it.attack} onChange=${v => set({ attack: n(v) })} />
        <${Num} label="Dégâts infligés (+/−)" value=${it.damage} onChange=${v => set({ damage: n(v) })} />
        <${Num} label="Armure (dégâts subis en moins)" value=${it.armor} min="0" onChange=${v => set({ armor: n(v) })} />
      </div>
      <label class="row subtle"><input type="checkbox" checked=${!!it.small} onChange=${e => set({ small: e.target.checked || undefined })} /> Petit objet : ne prend pas de place dans le sac (clé, bague, pièce…)</label>
      ${lost && html`<p class="eq-warn" style="margin:0"><${Glyph} name="warn" />L'emplacement « ${it.slot} » n'existe plus dans les Règles : choisissez-en un autre.</p>`}
      ${preview && html`<span class="subtle">${it.slot ? 'Porté' : 'Une fois porté'}, cet objet donne : ${preview}.${!it.slot ? ' Choisissez un emplacement pour qu’il compte.' : ''}</span>`}
    </fieldset>`;
  },
});

function SlotsEditor({ eq, upd, adv }) {
  const [name, setName] = useState('');
  const slots = eq.slots || [];
  const users = id => Object.values(adv.items).filter(it => it.slot === id).length;
  const add = () => {
    const label = name.trim();
    if (!label) { toast('Donnez un nom à l’emplacement (ex. Ceinture).'); return; }
    let id = slug(label), k = 2;
    while (slots.some(s => s.id === id)) id = `${slug(label)}-${k++}`;
    upd({ slots: [...slots, { id, label }] });
    setName('');
  };
  const remove = async (s, i) => {
    const n = users(s.id);
    if (n && !(await confirmBox(`${plural(n, 'objet')} se porte${n > 1 ? 'nt' : ''} à l'emplacement « ${s.label} ». Le supprimer quand même ? Ces objets ne pourront plus être portés.`, 'Supprimer'))) return;
    upd({ slots: slots.filter((_, j) => j !== i) });
  };
  const move = (i, d) => { const k = i + d; if (k < 0 || k >= slots.length) return; const l = [...slots]; [l[i], l[k]] = [l[k], l[i]]; upd({ slots: l }); };
  return html`<div class="stack" style="gap:6px">
    <b>Emplacements (${slots.length})</b>
    ${slots.map((s, i) => html`<div class="rowline eq-slotline" key=${s.id}>
      <${Text} label="Nom" value=${s.label} onChange=${v => upd({ slots: slots.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
      <label class="field">Identifiant<input type="text" value=${s.id} disabled /></label>
      <span class="subtle">${plural(users(s.id), 'objet')}</span>
      <span class="row" style="gap:4px;justify-content:end">
        <button type="button" class="btn small" aria-label=${`Monter ${s.label}`} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} name="up" /></button>
        <button type="button" class="btn small" aria-label=${`Descendre ${s.label}`} disabled=${i === slots.length - 1} onClick=${() => move(i, 1)}><${Icon} name="down" /></button>
        <button type="button" class="btn small danger" aria-label=${`Supprimer l'emplacement ${s.label}`} onClick=${() => remove(s, i)}><${Icon} name="x" /></button>
      </span>
    </div>`)}
    <div class="row" style="align-items:end">
      <${Text} label="Nouvel emplacement" value=${name} onChange=${setName} placeholder="Ceinture, Casque, Monture…" />
      <button type="button" class="btn small" onClick=${add}><${Icon} name="plus" />Emplacement</button>
    </div>
  </div>`;
}

registerRulesSection({
  id: 'equipement', order: 20,
  Section({ adv, set }) {
    const eq = { ...defaults(), ...(adv.rules.equipment || {}) };
    const upd = patch => set({ equipment: { ...eq, ...patch } });
    return html`<section class="panel"><header><h3>Équipement et sac à dos</h3></header>
      <label class="row"><input type="checkbox" checked=${!!eq.enabled} onChange=${e => upd({ enabled: e.target.checked })} /> Activer l'équipement porté (arme, armure…) et la capacité du sac</label>
      ${eq.enabled && html`
        <p class="subtle" style="margin:0">Chaque objet peut se porter dans un emplacement (onglet Objets). Seuls les objets portés comptent en combat.
          Un objet reçu va de lui-même dans son emplacement s'il est libre ; le joueur peut ensuite équiper, ranger ou abandonner ses objets depuis sa Feuille d'Aventure.</p>
        <${SlotsEditor} eq=${eq} upd=${upd} adv=${adv} />
        <div class="grid2">
          <${Num} label="Capacité du sac (objets, 0 = illimitée)" value=${eq.capacity} min="0" onChange=${v => upd({ capacity: Math.max(0, v || 0) })} />
          <${Select} label="Emplacement de l'arme" value=${eq.weaponSlot || ''} onChange=${v => upd({ weaponSlot: v })} options=${[['', 'aucun'], ...slotsOf(adv).map(s => [s.id, s.label])]} />
          <${Num} label="Malus de Force d'Attaque sans arme" value=${eq.unarmedPenalty} min="0" onChange=${v => upd({ unarmedPenalty: Math.abs(v || 0) })} />
        </div>
        <p class="subtle" style="margin:0">Capacité : les objets portés et les petits objets ne comptent pas. Quand le sac déborde, les choix sont bloqués jusqu'à ce que le joueur abandonne un objet.
          Malus sans arme : ${!weaponSlotOf(adv) ? 'aucun, faute d’emplacement de l’arme.' : penaltyOf(adv) ? `−${penaltyOf(adv)} à la Force d'Attaque si l'emplacement « ${slotLabel(adv, weaponSlotOf(adv))} » est vide (règle de Sorcellerie ! : 4).` : 'aucun (mettez 4 pour la règle de Sorcellerie !).'}</p>`}
    </section>`;
  },
});

/* ---------- effets ---------- */
registerEffectUI('equip', {
  label: 'Équiper un objet', order: 60,
  blank: adv => ({ op: 'equip', item: wearables(adv)[0]?.[0] || '' }),
  Fields({ e, upd, adv }) {
    const list = wearables(adv);
    return html`<${Select} label="Objet à porter" value=${e.item} onChange=${v => upd({ item: v })} options=${[['', '—'], ...list]} />
      ${!list.length && html`<span class="subtle">Aucun objet n'a d'emplacement : réglez-le dans l'onglet Objets.</span>`}
      ${!isOn(adv) && html`<span class="subtle">Activez l'équipement dans les Règles.</span>`}`;
  },
});
registerEffectUI('unequip', {
  label: 'Ranger ou perdre l’objet porté', order: 61,
  blank: adv => ({ op: 'unequip', slot: slotsOf(adv)[0]?.id || 'arme' }),
  Fields({ e, upd, adv }) {
    return html`<${Select} label="Emplacement" value=${e.slot} onChange=${v => upd({ slot: v })} options=${slotOptions(adv)} />
      <label class="chk eq-chk"><input type="checkbox" checked=${!!e.take} onChange=${ev => upd({ take: ev.target.checked || undefined })} /> Le héros perd l'objet (confisqué, brisé…)</label>
      ${!isOn(adv) && html`<span class="subtle">Activez l'équipement dans les Règles.</span>`}`;
  },
});

/* ---------- conditions ---------- */
const isObj = x => x && typeof x === 'object';
const itemCond = (t, label, negate) => ({
  t, label, order: 60,
  match: c => ('equipped' in c && !!c.negate === negate ? { v: c.equipped }
    : negate && isObj(c.not) && 'equipped' in c.not && !c.not.negate ? { v: c.not.equipped } : null),
  toCond: r => (negate ? { equipped: r.v, negate: true } : { equipped: r.v }),
  blank: adv => ({ v: wearables(adv)[0]?.[0] || '' }),
  Fields: ({ row, upd, adv }) => html`<${Select} label="Objet porté" value=${row.v} onChange=${v => upd({ v })} options=${[['', '—'], ...wearables(adv)]} />`,
});
const slotCond = (t, label, negate) => ({
  t, label, order: 61,
  match: c => ('equippedSlot' in c && !!c.negate === negate ? { v: c.equippedSlot }
    : negate && isObj(c.not) && 'equippedSlot' in c.not && !c.not.negate ? { v: c.not.equippedSlot } : null),
  toCond: r => (negate ? { equippedSlot: r.v, negate: true } : { equippedSlot: r.v }),
  blank: adv => ({ v: slotsOf(adv)[0]?.id || 'arme' }),
  Fields: ({ row, upd, adv }) => html`<${Select} label="Emplacement" value=${row.v} onChange=${v => upd({ v })} options=${slotOptions(adv)} />`,
});
registerConditionUI(itemCond('equipement-porte', 'porte l’objet', false));
registerConditionUI(itemCond('equipement-porte-pas', 'ne porte pas l’objet', true));
registerConditionUI(slotCond('equipement-occupe', 'porte quelque chose à l’emplacement', false));
registerConditionUI(slotCond('equipement-vide', 'n’a rien à l’emplacement', true));

/* ------------------------------------------------------------------ */
/* Version imprimable                                                  */
/* ------------------------------------------------------------------ */

registerPrintSection({
  where: 'rules', order: 20,
  Section({ adv }) {
    if (!isOn(adv)) return null;
    const slots = slotsOf(adv);
    const cap = capacityOf(adv), pen = penaltyOf(adv), w = weaponSlotOf(adv);
    const list = Object.entries(adv.items).filter(([id, it]) => itemSlot(adv, id) || it.small || bonusText(it));
    return html`<div class="eq-print">
      <h3>L'équipement</h3>
      <p>Votre Feuille d'Aventure comporte une case pour chaque objet que vous portez : ${slots.map(s => s.label).join(', ')}.
        Quand vous obtenez un objet qui se porte et que sa case est vide, inscrivez-le dans cette case ; sinon, rangez-le dans votre sac.
        Vous pouvez à tout moment échanger un objet porté contre un objet du même type rangé dans votre sac.</p>
      <p>En combat, seuls les objets portés comptent : ajoutez leurs bonus à votre Force d'Attaque et aux dégâts que vous infligez ; l'armure réduit les dégâts que vous subissez, sans jamais descendre sous 1 point.</p>
      ${w && pen > 0 && html`<p>Si la case « ${slotLabel(adv, w)} » est vide, vous combattez à mains nues : retirez ${plural(pen, 'point')} à votre Force d'Attaque.</p>`}
      ${cap > 0 && html`<p>Votre sac à dos ne peut contenir que <b>${plural(cap, 'objet')}</b>. Les objets portés et les petits objets ne comptent pas. S'il déborde, rayez des objets (ils restent sur place) avant de choisir votre prochain paragraphe.</p>`}
      ${list.length > 0 && html`<table class="pr-table eq-pr-items"><tbody>
        <tr><th>Objet</th><th>Case</th><th>Effet</th></tr>
        ${list.map(([id, it]) => html`<tr><td>${it.name}</td><td>${itemSlot(adv, id) ? slotLabel(adv, it.slot) : '—'}</td><td>${[bonusText(it), it.small ? 'petit objet' : ''].filter(Boolean).join(' ; ') || '—'}</td></tr>`)}
      </tbody></table>`}
    </div>`;
  },
});

registerPrintSection({
  where: 'sheet', order: 20,
  Section({ adv }) {
    if (!isOn(adv)) return null;
    const cap = capacityOf(adv);
    return html`<div class="eq-print-sheet">
      <div class="pr-box pr-wide"><b>OBJETS PORTÉS</b>
        <div class="eq-pr-slots">${slotsOf(adv).map(s => html`<div class="eq-pr-slot"><span>${s.label.toUpperCase()}</span></div>`)}</div>
      </div>
      ${cap > 0 && html`<div class="pr-box pr-wide"><b>SAC À DOS <span class="pr-small">— ${plural(cap, 'place')} (objets portés et petits objets non compris)</span></b>
        <ol class="eq-pr-bag">${Array.from({ length: cap }, () => html`<li></li>`)}</ol>
      </div>`}
    </div>`;
  },
});
