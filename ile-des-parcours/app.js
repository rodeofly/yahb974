import {sampleGraph} from './sample.js';
import {initExplorationUI} from './exploration-ui.js';
import {validateGraph,createState,availableEdges,traverse,undoState,analyzeGraph,bfs,dfs,shortestPath,cloneGraph,removeNode,addNode,addEdge} from './graph-engine.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'ile-des-parcours-v1';
let graph = cloneGraph(sampleGraph), state = createState(graph), selected = graph.start;
let view = 'explorer', style = 'nature', quality = 'balanced', world = null;
let explorationUI=null;
let highlighted = [], editHistory = [], toastTimer, installPrompt, worldError = false;
const titles = {explorer:'L’île des possibles',graphe:'L’atelier du graphe',journal:'Ton chemin, ton histoire',projet:'Un monde de possibilités'};
const iconFor = kind => ({départ:'⌁',observation:'◎',aide:'✧',choix:'⑂',raisonnement:'◇',bilan:'▤',défi:'△',arrivée:'⚑'}[kind] || '◈');
const nodeOf = id => graph.nodes.find(n=>n.id===id);
const nodeTitle = id => nodeOf(id)?.title || id;
const niceVar = key => ({observation:'Observation',raisonnement:'Raisonnement',autonomie:'Autonomie',score:'Points de démo'}[key] || key);

function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4500);
}
function persist() {
  try {localStorage.setItem(KEY,JSON.stringify({graph,state,style,quality}));}
  catch {$('#storage-status').textContent='Stockage limité : pensez à exporter';}
}
function restore() {
  try {
    const raw=localStorage.getItem(KEY); if(!raw) return;
    const saved=JSON.parse(raw); if(!validateGraph(saved.graph).valid) return;
    let replay=createState(saved.graph);
    if(Array.isArray(saved.state?.history) && saved.state.history.length<=1000) {
      for(const event of saved.state.history) replay=traverse(saved.graph,replay,event.edgeId);
    }
    graph=saved.graph; state=replay; selected=state.current;
    if(['nature','voxel','map'].includes(saved.style)) style=saved.style;
    if(['eco','balanced','high'].includes(saved.quality)) quality=saved.quality;
  } catch { /* A malformed or unavailable local save never blocks the app. */ }
}
function download(name, data, mime='application/json') {
  const content=typeof data==='string'?data:JSON.stringify(data,null,2);
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function resetRun() {
  state=createState(graph); selected=state.current; highlighted=[]; persist(); renderAll();world?.resetView();
}
function updateProgress() {
  $('#side-title').textContent=graph.title;
  $('#journal-count').textContent=state.history.length;
  $('#side-progress').style.width=`${state.visited.length/graph.nodes.length*100}%`;
  $('#side-completion').textContent=`${state.visited.length} / ${graph.nodes.length} lieux découverts`;
  const skills=[['observation','◎',1],['raisonnement','◇',2],['autonomie','↗',1],['visited','◈',graph.nodes.length]];
  $('#skills-strip').innerHTML=skills.map(([key,icon,cap])=>{
    const value=key==='visited'?state.visited.length:(state.variables[key]||0);
    return `<div class="skill-tile"><span class="skill-icon">${icon}</span><div class="skill-data"><span class="mini-label">${key==='visited'?'LIEUX DÉCOUVERTS':niceVar(key).toUpperCase()}</span><div class="skill-number">${esc(value)}<small>${key==='visited'?`/ ${graph.nodes.length}`:'repère'+(value>1?'s':'')}</small></div><div class="skill-bar"><span style="width:${Math.min(100,Math.max(0,value/cap*100))}%"></span></div></div>`;
  }).join('');
}
function visibleChoices() {
  const groups=new Map();
  for(const edge of availableEdges(graph,state)) {
    const key=JSON.stringify([edge.source,edge.target,edge.label]);
    if(!groups.has(key) || edge.available) groups.set(key,edge);
  }
  return [...groups.values()];
}
function renderStory() {
  const node=nodeOf(state.current); if(!node)return;
  const choices=visibleChoices();
  const paragraphs=node.body.split(/\n\s*\n/).map(t=>`<p>${esc(t).replace(/\n/g,'<br>')}</p>`).join('');
  $('#story-panel').innerHTML=`<div class="story-head"><div class="scene-count"><span class="kind-badge">${esc(node.kind.toUpperCase())}</span><span>ÉTAPE ${state.history.length+1}</span></div><div class="scene-icon" aria-hidden="true">${iconFor(node.kind)}</div><h2>${esc(node.title)}</h2></div><div class="story-scroll"><div class="story-body">${paragraphs}</div>${choices.length?`<div class="choice-heading">À TOI DE CHOISIR</div><div class="choices">${choices.map((e,i)=>`<button class="choice" data-edge="${esc(e.id)}" ${!e.available?'disabled':''}><span class="choice-num">${e.available?i+1:'⌁'}</span><span class="choice-label">${esc(e.label)}${!e.available?`<span class="choice-reason">${esc(e.reason)}</span>`:''}</span><span class="choice-arrow">${e.available?'→':''}</span></button>`).join('')}</div>`:`<div class="choice-heading">UNE HISTOIRE À RACONTER</div><button class="button primary" data-action="journal">Voir mon parcours →</button><p class="quiet" style="margin-top:15px">${node.kind==='arrivée'?'Bravo pour cette exploration.':'Ce lieu n’a pas de choix sortant dans le scénario.'}</p>`}</div><div class="story-nav"><button class="link-button" data-action="undo" ${state.history.length?'':'disabled'}>← Revenir au choix précédent</button><button class="link-button" data-action="reset">Recommencer</button></div>`;
}
function doTransition(edgeId) {
  try {
    state=traverse(graph,state,edgeId);selected=state.current;highlighted=[];persist();
    $('#landmark-preview').hidden=true;renderStory();updateProgress();renderJournal();renderGraph();world?.setState(state);
    const effects=state.history.at(-1).effects;
    const labels=Object.entries(effects).filter(([k])=>k!=='score').map(([k,v])=>`${niceVar(k)} ${v>0?'+':''}${v}`);
    if(labels.length)notify(labels.join(' · '));
  } catch(e) {notify(e.message);}
}
function showLandmark(id) {
  const n=nodeOf(id);if(!n)return;
  const isCurrent=id===state.current;
  $('#landmark-preview').innerHTML=`<button data-action="close-landmark" aria-label="Fermer">×</button><span class="eyebrow">${esc(n.kind)}</span><strong>${esc(n.title)}</strong><p>${isCurrent?'Tu es ici. Choisis une action dans le carnet.':state.visited.includes(id)?'Un lieu déjà exploré.':'Un lieu à découvrir au fil de tes décisions.'}</p>`;
  $('#landmark-preview').hidden=false;
}
function switchView(next) {
  if(!titles[next])next='explorer';view=next;
  $$('.view').forEach(el=>{el.hidden=el.id!==`${next}-view`;el.classList.toggle('active',!el.hidden);});
  $$('.nav-item').forEach(b=>{b.classList.toggle('active',b.dataset.view===next); if(b.dataset.view===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#page-title').innerHTML=`${esc(next==='explorer'?graph.title:titles[next])}<span class="title-dot">.</span>`;
  $('#view-breadcrumb').textContent=({explorer:'EXPLORATION',graphe:'ATELIER',journal:'JOURNAL',projet:'PROJET'})[next];
  world?.setVisible?.(next==='explorer'&&style!=='map');
  explorationUI?.setActive(next==='explorer');
  if(!explorationUI)document.body.classList.toggle('terrain-focus',next==='explorer');
  if(next==='graphe'){renderGraph();renderEditor();renderAnalysisSelectors();}
  if(next==='journal')renderJournal();
  if(next==='explorer'){if(style==='map')renderMap();requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}
  try{history.replaceState(null,'',`#${next}`);}catch{}
}
function switchStyle(next) {
  style=next;
  $$('.segmented button').forEach(b=>b.classList.toggle('active',b.dataset.style===style));
  $('#world-container').hidden=style==='map';$('#world-map').hidden=style!=='map';
  $('#quality-select').disabled=style==='map';
  world?.setVisible?.(view==='explorer'&&style!=='map');
  if(style==='map') {renderMap();$('#renderer-status').textContent='Mode léger';$('#world-instructions').textContent='Sélectionner un lieu · Choisir une action dans le carnet';}
  else {
    world?.setStyle(style);$('#renderer-status').textContent='WebGL2';$('#world-instructions').textContent='Glisser pour tourner · Molette / pincement pour zoomer';
    if(worldError){style='map';switchStyle('map');notify('La 3D n’est pas disponible sur cet appareil. Le parcours reste jouable en 2D.');}
  }
  persist();
}
function layoutNodes(width=720,height=450) {
  const xs=graph.nodes.map(n=>n.x),zs=graph.nodes.map(n=>n.z);
  const minX=Math.min(-35,...xs),maxX=Math.max(35,...xs),minZ=Math.min(-35,...zs),maxZ=Math.max(35,...zs);
  const padX=82,padY=48;
  return new Map(graph.nodes.map(n=>[n.id,{x:padX+(n.x-minX)/(maxX-minX)*(width-padX*2),y:padY+(n.z-minZ)/(maxZ-minZ)*(height-padY*2)}]));
}
function renderMap() {
  const layout=layoutNodes(640,410);
  const edgePaths=graph.edges.map(e=>{const a=layout.get(e.source),b=layout.get(e.target);return `<path d="M${a.x},${a.y} L${b.x},${b.y}" stroke="#849e74" stroke-width="2" fill="none" ${e.condition?'stroke-dasharray="5 5"':''} opacity=".55"/>`;}).join('');
  const nodes=graph.nodes.map(n=>{const p=layout.get(n.id),c=n.id===state.current?'#e98c51':state.visited.includes(n.id)?'#416f58':'#f8fbef';return `<g class="map-node" role="button" tabindex="0" data-landmark="${esc(n.id)}" aria-label="${esc(n.title)}"><circle cx="${p.x}" cy="${p.y}" r="11" fill="${c}" stroke="#648b64" stroke-width="2"/><circle cx="${p.x}" cy="${p.y}" r="3" fill="#285345"/><text class="map-label" x="${p.x}" y="${p.y+27}" text-anchor="middle">${esc(n.title.length>27?n.title.slice(0,25)+'…':n.title)}</text></g>`;}).join('');
  $('#world-map').innerHTML=`<svg viewBox="0 0 640 430" role="group" aria-label="Carte accessible des lieux du parcours">${edgePaths}${nodes}</svg>`;
}
function renderGraph() {
  const analysis=analyzeGraph(graph);
  $('#graph-stats').innerHTML=`<span><b>${analysis.stats.nodes}</b> sommets</span><span><b>${analysis.stats.edges}</b> arêtes</span><span><b>${analysis.cycles.length}</b> composante${analysis.cycles.length>1?'s':''} cyclique${analysis.cycles.length>1?'s':''}</span>`;
  $('#undo-edit').disabled=!editHistory.length;
  const layout=layoutNodes();const pairs=new Map();
  const paths=graph.edges.map(e=>{
    const a=layout.get(e.source),b=layout.get(e.target),key=e.source+'|'+e.target;
    const count=pairs.get(key)||0;pairs.set(key,count+1);
    const isHi=highlighted.some((id,i)=>id===e.source&&highlighted[i+1]===e.target);
    let d;
    if(e.source===e.target)d=`M${a.x+30} ${a.y} C${a.x+90} ${a.y-80},${a.x-90} ${a.y-80},${a.x-30} ${a.y}`;
    else {
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
      const start={x:a.x+dx/len*23,y:a.y+dy/len*19};
      const end={x:b.x-dx/len*23,y:b.y-dy/len*23};
      const offset=12+count*14;const cx=(a.x+b.x)/2-dy/len*offset,cy=(a.y+b.y)/2+dx/len*offset;
      d=`M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`;
    }
    return `<path class="graph-edge ${e.condition?'condition':''} ${isHi?'highlight':''}" d="${d}" marker-end="url(#arrow${isHi?'-hi':''})"><title>${esc(e.label)} · coût ${e.weight}${e.condition?' · avec prérequis':''}</title></path>`;
  }).join('');
  const nodes=graph.nodes.map(n=>{
    const p=layout.get(n.id),isCurrent=n.id===state.current;
    const words=n.title.split(' ');let line1='',line2='';
    for(const word of words) {if((line1+' '+word).trim().length<=22&&!line2)line1=(line1+' '+word).trim();else line2=(line2+' '+word).trim();}
    if(line2.length>24)line2=line2.slice(0,22)+'…';
    return `<g class="graph-node ${isCurrent?'current':state.visited.includes(n.id)?'visited':''} ${selected===n.id?'selected':''} ${highlighted.includes(n.id)?'highlight':''}" transform="translate(${p.x},${p.y})" data-select="${esc(n.id)}" role="button" tabindex="0" aria-label="Modifier ${esc(n.title)}"><rect x="-70" y="-26" width="140" height="57" rx="9"/><text class="graph-kind" text-anchor="middle" y="-11">${esc(n.kind.toUpperCase())}${n.id===graph.start?' · DÉPART':''}</text><text class="graph-title" text-anchor="middle" y="4">${esc(line1)}</text><text class="graph-title" text-anchor="middle" y="17">${esc(line2)}</text></g>`;
  }).join('');
  $('#graph-canvas').innerHTML=`<svg viewBox="0 0 720 450" role="group" aria-label="Graphe de décisions"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#b2c0a5"/></marker><marker id="arrow-hi" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#e88d4f"/></marker></defs>${paths}${nodes}</svg>`;
  if(style==='map')renderMap();
}
function selectOptions(value) {return graph.nodes.map(n=>`<option value="${esc(n.id)}" ${n.id===value?'selected':''}>${esc(n.title)}</option>`).join('');}
function renderEditor() {
  let node=nodeOf(selected);if(!node){selected=graph.start;node=nodeOf(selected);}
  const edges=graph.edges.filter(e=>e.source===node.id);
  $('#node-editor').innerHTML=`<span class="eyebrow">SOMMET · ${esc(node.id)}</span><h3>Modifier ce lieu</h3><form id="node-form"><label class="field">Titre<input name="title" value="${esc(node.title)}" maxlength="200" required></label><label class="field">Type<select name="kind">${[...new Set(['départ','observation','aide','choix','raisonnement','bilan','défi','arrivée',node.kind])].map(k=>`<option ${k===node.kind?'selected':''}>${esc(k)}</option>`).join('')}</select></label><label class="field">Texte de la scène<textarea name="body" maxlength="16000">${esc(node.body)}</textarea></label><div class="field-row"><label class="field">Position X<input name="x" type="number" step="any" value="${node.x}" min="-1000000" max="1000000" required></label><label class="field">Position Z<input name="z" type="number" step="any" value="${node.z}" min="-1000000" max="1000000" required></label></div><div class="editor-buttons"><button class="button primary small" type="submit">Enregistrer</button><button class="button secondary small danger" type="button" data-delete-node="${esc(node.id)}" ${graph.nodes.length<=1?'disabled':''}>Supprimer</button></div></form><button class="link-button" data-start-node="${esc(node.id)}" ${node.id===graph.start?'disabled':''}>Définir comme point de départ</button><p class="quiet" style="font-size:10px;margin-top:12px">Une modification redémarre la simulation. Le bouton Annuler restaure aussi le parcours précédent.</p><div class="editor-section"><h4>${edges.length} choix sortant${edges.length>1?'s':''}</h4>${edges.map(e=>`<div class="edge-item"><div><p>${esc(e.label)}</p><span>→ ${esc(nodeTitle(e.target))} · coût ${e.weight}</span><details><summary>Modifier la règle</summary><form class="edge-edit-form" data-id="${esc(e.id)}"><label class="field">Choix<input name="label" value="${esc(e.label)}" maxlength="300" required></label><label class="field">Destination<select name="target">${selectOptions(e.target)}</select></label><label class="field">Coût<input name="weight" type="number" min="0" step="any" value="${e.weight}" required></label><label class="field">Condition JSON (facultative)<textarea name="condition" placeholder='{"variable":"observation","op":"gte","value":1}'>${e.condition?esc(JSON.stringify(e.condition,null,2)):''}</textarea></label><label class="field">Effets JSON (incréments)<textarea name="effects" placeholder='{"observation":1}'>${e.effects?esc(JSON.stringify(e.effects,null,2)):''}</textarea></label><button class="button secondary small" type="submit">Enregistrer le choix</button></form></details></div><button data-delete-edge="${esc(e.id)}" aria-label="Supprimer le choix ${esc(e.label)}">×</button></div>`).join('')}</div><details class="editor-section"><summary style="font-size:11px;cursor:pointer">＋ Ajouter un choix</summary><form id="edge-form"><label class="field">Texte du choix<input name="label" maxlength="300" placeholder="Continuer l’aventure" required></label><label class="field">Destination<select name="target">${selectOptions(graph.nodes.find(n=>n.id!==selected)?.id||selected)}</select></label><label class="field">Coût<input name="weight" type="number" min="0" step="any" value="1" required></label><label class="field">Condition JSON (facultative)<textarea name="condition" placeholder='{"variable":"observation","op":"gte","value":1}'></textarea></label><label class="field">Effets JSON (facultatifs)<textarea name="effects" placeholder='{"observation":1}'></textarea></label><button class="button primary small" type="submit">Ajouter ce choix</button></form></details>`;
}
function updateGraph(next, message='Scénario mis à jour. La simulation recommence.') {
  const result=validateGraph(next);
  if(!result.valid){notify(result.errors.slice(0,3).join(' '));return false;}
  editHistory.push({graph:cloneGraph(graph),state:JSON.parse(JSON.stringify(state)),selected});
  if(editHistory.length>20)editHistory.shift();
  graph=next;state=createState(graph);if(!nodeOf(selected))selected=graph.start;highlighted=[];
  persist();renderAll();notify(message);return true;
}
function renderAnalysisSelectors(){
  const from=$('#analysis-start').value||graph.start,to=$('#analysis-end').value||graph.nodes.at(-1).id;
  $('#analysis-start').innerHTML=selectOptions(from);$('#analysis-end').innerHTML=selectOptions(to);
}
function pathMarkup(ids) {return `<div class="path-list">${ids.map((id,i)=>`${i?' → ':''}<span>${esc(nodeTitle(id))}</span>`).join('')}</div>`;}
function runAnalysis(type) {
  const from=$('#analysis-start').value,to=$('#analysis-end').value,out=$('#analysis-output');
  highlighted=[];
  try{
    const a=analyzeGraph(graph,from);
    if(type==='bfs'||type==='dfs') {
      const ids=type==='bfs'?bfs(graph,from):dfs(graph,from);
      out.innerHTML=`<b>${type==='bfs'?'Parcours en largeur (BFS)':'Parcours en profondeur (DFS)'}</b>${pathMarkup(ids)}${ids.length} sommet(s) accessible(s) structurellement sur ${graph.nodes.length}. Cet ordre de visite n’est pas nécessairement un chemin continu entre chaque paire affichée.`;
    } else if(type==='shortest') {
      const result=shortestPath(graph,from,to);highlighted=result.path;
      out.innerHTML=result.path.length?`<b>Plus court chemin structurel · coût ${esc(result.distance)}</b>${pathMarkup(result.path)}Dijkstra additionne les coûts non négatifs. Les prérequis et les effets ne sont pas évalués : ce chemin n’est pas une recommandation pédagogique.`:`Aucun chemin orienté ne relie ces deux lieux, même sans tenir compte des prérequis.`;
    } else if(type==='cycles') {
      out.innerHTML=`<b>${a.scc.length} composante(s) fortement connexe(s), dont ${a.cycles.length} avec un cycle</b><p>Dans chaque composante, tous les sommets peuvent se rejoindre par des chemins orientés. Une boucle peut représenter un détour d’aide.</p>${a.cycles.map(ids=>pathMarkup(ids)).join('')||'Aucune composante cyclique.'}<p>${a.unreachable.length?`Sommets inaccessibles depuis le départ choisi : ${a.unreachable.map(nodeTitle).map(esc).join(', ')}.`:'Tous les sommets sont accessibles structurellement depuis le départ choisi.'}</p><span class="quiet">Composantes cycliques, sans énumération de tous les cycles simples.</span>`;
    } else if(type==='topological') {
      out.innerHTML=a.topological?`<b>Ordre topologique</b>${pathMarkup(a.topological)}Chaque arête va d’un sommet antérieur à un sommet ultérieur dans cet ordre.`:`<b>Le tri topologique n’est pas défini pour ce graphe cyclique.</b><p>Les boucles d’aide font partie du scénario. Un ordre topologique s’applique à un graphe orienté sans cycle.</p>`;
    } else if(type==='matrix') {
      if(a.order.length>60) {out.textContent='La matrice visuelle est limitée à 60 sommets. Les calculs du moteur restent disponibles jusqu’à 500 sommets.';renderGraph();return;}
      out.innerHTML=`<b>Matrice d’adjacence A</b><p>Aᵢⱼ est le nombre d’arêtes du sommet i vers le sommet j. Les multiarêtes sont conservées.</p><table class="matrix"><thead><tr><th>i → j</th>${a.order.map((id,i)=>`<th title="${esc(nodeTitle(id))}">${i+1}</th>`).join('')}</tr></thead><tbody>${a.matrix.map((row,i)=>`<tr><th title="${esc(nodeTitle(a.order[i]))}">${i+1}</th>${row.map(n=>`<td>${n||'·'}</td>`).join('')}</tr>`).join('')}</tbody></table><p>${a.order.map((id,i)=>`${i+1}. ${esc(nodeTitle(id))}`).join(' · ')}</p>`;
    }
    renderGraph();
  }catch(e){out.textContent=e.message;}
}
function renderJournal() {
  const cost=state.history.reduce((sum,event)=>sum+(graph.edges.find(e=>e.id===event.edgeId)?.weight||0),0);
  const intro=`<div class="journal-summary"><div><span class="mini-label">CHOIX EFFECTUÉS</span><strong>${state.history.length}</strong><span class="quiet">Étapes de ton histoire</span></div><div><span class="mini-label">LIEUX DÉCOUVERTS</span><strong>${state.visited.length}<small style="font-size:15px;color:#89997e"> / ${graph.nodes.length}</small></strong><span class="quiet">Visites distinctes</span></div><div><span class="mini-label">COÛT DU PARCOURS</span><strong>${esc(cost)}</strong><span class="quiet">Poids cumulés, sans note scolaire</span></div></div>`;
  const timeline=state.history.length?`<div class="timeline">${state.history.map((e,i)=>`<article class="timeline-item"><span class="timeline-index">${i+1}</span><div><h3>${esc(nodeTitle(e.source))} → ${esc(nodeTitle(e.target))}</h3><p>${esc(e.label)}</p><span class="quiet">${Object.entries(e.effects).filter(([k])=>k!=='score').map(([k,v])=>`${esc(niceVar(k))} ${v>0?'+':''}${v}`).join(' · ')||'Une étape de ton exploration'}</span></div></article>`).join('')}</div>`:`<div class="empty-state"><h3>Ton histoire commence ici.</h3><p>Ton premier choix apparaîtra dans ce journal.</p><button class="button primary" data-action="explorer">Commencer l’exploration →</button></div>`;
  $('#journal-content').innerHTML=intro+timeline;
}
function renderAll() {
  renderStory();updateProgress();renderGraph();renderEditor();renderAnalysisSelectors();renderJournal();
  world?.setGraph(graph);world?.setState(state);
  $('#page-title').innerHTML=`${esc(view==='explorer'?graph.title:titles[view])}<span class="title-dot">.</span>`;
  $('#analysis-output').textContent='Choisissez une opération pour examiner ce graphe.';
}
function uniqueId(prefix) {let i=graph.nodes.length+graph.edges.length;while(graph.nodes.some(n=>n.id===`${prefix}${i}`)||graph.edges.some(e=>e.id===`${prefix}${i}`))i++;return `${prefix}${i}`;}
function readRuleForm(form) {
  const d=new FormData(form);const condition=String(d.get('condition')||'').trim(),effects=String(d.get('effects')||'').trim();
  return {label:String(d.get('label')),target:String(d.get('target')),weight:Number(d.get('weight')),...(condition?{condition:JSON.parse(condition)}:{}),...(effects?{effects:JSON.parse(effects)}:{})};
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button,a,[data-select],[data-landmark]');if(!b)return;
  if(b.dataset.view)switchView(b.dataset.view);
  if(b.dataset.style)switchStyle(b.dataset.style);
  if(b.dataset.edge)doTransition(b.dataset.edge);
  if(b.dataset.select){selected=b.dataset.select;renderGraph();renderEditor();}
  if(b.dataset.landmark)showLandmark(b.dataset.landmark);
  if(b.dataset.analysis)runAnalysis(b.dataset.analysis);
  if(b.dataset.deleteNode){try{updateGraph(removeNode(graph,b.dataset.deleteNode),'Lieu supprimé. Annuler permet de le restaurer.');}catch(e){notify(e.message);}}
  if(b.dataset.deleteEdge){const next=cloneGraph(graph);next.edges=next.edges.filter(e=>e.id!==b.dataset.deleteEdge);updateGraph(next,'Choix supprimé.');}
  if(b.dataset.startNode){const next=cloneGraph(graph);next.start=b.dataset.startNode;updateGraph(next,'Nouveau point de départ défini.');}
  const action=b.dataset.action;
  if(action==='journal'||action==='explorer')switchView(action);
  if(action==='close-landmark')$('#landmark-preview').hidden=true;
  if(action==='undo'){try{state=undoState(state);selected=state.current;persist();renderAll();}catch(e){notify(e.message);}}
  if(action==='reset'){resetRun();notify('Une nouvelle exploration commence.');}
});
document.addEventListener('keydown',event=>{
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-select],[data-landmark]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(!['node-form','edge-form'].includes(form.id)&&!form.classList.contains('edge-edit-form'))return;
  event.preventDefault();
  try{
    if(form.id==='node-form') {
      const d=new FormData(form),next=cloneGraph(graph),node=next.nodes.find(n=>n.id===selected);
      Object.assign(node,{title:String(d.get('title')),kind:String(d.get('kind')),body:String(d.get('body')),x:Number(d.get('x')),z:Number(d.get('z'))});updateGraph(next);
    } else if(form.id==='edge-form') {
      const edge={id:uniqueId('choix'),source:selected,...readRuleForm(form)};updateGraph(addEdge(graph,edge),'Nouveau choix ajouté au graphe.');
    } else {
      const next=cloneGraph(graph),i=next.edges.findIndex(e=>e.id===form.dataset.id);
      next.edges[i]={id:next.edges[i].id,source:next.edges[i].source,...readRuleForm(form)};updateGraph(next,'Choix et règles mis à jour.');
    }
  }catch(e){notify(e instanceof SyntaxError?'Le JSON de la condition ou des effets est invalide.':e.message);}
});
$('#quality-select').addEventListener('change',e=>{quality=e.target.value;world?.setQuality(quality);persist();});
$('#reset-view').addEventListener('click',()=>{world?.resetView();$('#landmark-preview').hidden=true;});
$('#focus-player').addEventListener('click',()=>{world?.focusNode(state.current);showLandmark(state.current);});
$('#open-graph').addEventListener('click',()=>{selected=state.current;switchView('graphe');});
$('#help-btn').addEventListener('click',()=>$('#help-dialog').showModal());
$('#close-help').addEventListener('click',()=>$('#help-dialog').close());
$('#start-help').addEventListener('click',()=>$('#help-dialog').close());
$('#export-btn').addEventListener('click',()=>download('ile-des-parcours-graphe.json',graph));
$('#export-journal').addEventListener('click',()=>download('ile-des-parcours-journal.json',{version:1,scenario:graph.title,exportedAt:new Date().toISOString(),state,notice:'Indicateurs de démonstration. Ne constituent pas une évaluation de compétences validée.'}));
$('#import-btn').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(file.size>4_000_000)throw new Error('Le fichier dépasse la limite de 4 Mo.');
    const next=JSON.parse(await file.text());
    if(updateGraph(next,'Parcours importé. Les modifications peuvent être annulées.')){selected=graph.start;renderEditor();}
  }catch(e){notify(e instanceof SyntaxError?'Ce fichier ne contient pas un JSON valide.':e.message);}
  event.target.value='';
});
$('#add-node').addEventListener('click',()=>{
  const id=uniqueId('lieu'),base=nodeOf(selected);try{
    const next=addNode(graph,{id,title:'Un nouveau lieu',kind:'choix',body:'Décris ici la scène, la question ou les indices à découvrir.',x:Math.max(-34,Math.min(34,(base?.x||0)+8)),z:Math.max(-30,Math.min(30,(base?.z||0)+6))});
    if(updateGraph(next,'Lieu ajouté. Reliez-le au parcours avec un choix.')){selected=id;renderEditor();renderGraph();}
  }catch(e){notify(e.message);}
});
$('#undo-edit').addEventListener('click',()=>{
  const prev=editHistory.pop();if(!prev)return;({graph,state,selected}=prev);highlighted=[];persist();renderAll();notify('Modification annulée ; progression restaurée.');
});
$('#restore-demo').addEventListener('click',()=>{updateGraph(cloneGraph(sampleGraph),'Scénario de démonstration rechargé.');});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install-app').hidden=false;});
$('#install-app').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install-app').hidden=true;}});
window.addEventListener('appinstalled',()=>{notify('L’application est installée.');$('#install-app').hidden=true;});

// A link to a zarboutan (#z07) or a door (#sentier-3), from the gamebook: kept before the view replaces the address.
const startLink=/^(z\d{2}|sentier-\d)$/.test(location.hash.slice(1))?location.hash.slice(1):null;
// The gamebook's television (?tele=1): the book, around this page, sends a cue per paragraph.
const teleMode=new URLSearchParams(location.search).has('tele');
// Without menus from the very first picture (the relief takes a while to load).
if(teleMode)document.body.classList.add('tele-mode');
function listenTele(ui){
  window.addEventListener('message',event=>{
    if(event.source!==window.parent)return;
    if(event.data?.type==='livre-heros:tele-view'){ui.teleView?.(String(event.data.id||''));return;}
    if(event.data?.type!=='livre-heros:tele')return;
    const {cue,choices,section,paused,legend,top,places,visited}=event.data;ui.tele({cue:String(cue||''),choices:Array.isArray(choices)?choices:[],section:section??null,paused:!!paused,legend:Number(legend)||0,top:Number(top)||0,places:Array.isArray(places)?places.map(String):[],visited:Array.isArray(visited)?visited.map(String):[]});
  });
  // Ready at last (the relief takes a while): the book sends the cue of its current paragraph again.
  if(window.parent!==window)window.parent.postMessage({type:'livre-heros:tele-ready'},'*');
}
restore();$('#quality-select').value=quality;renderAll();switchView(location.hash.slice(1)||'explorer');switchStyle(style);

async function startWorld() {
  try {
    const {createWorld}=await import('./world.js');
    // Phones and tablets load the 50 m relief (4 MB) unless the explorer chose otherwise.
    let terrainDetail=matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<1000?'lite':'full';
    try{const saved=JSON.parse(localStorage.getItem('reunion-terrain-v2')||'{}');if(saved.relief==='lite'||saved.relief==='full')terrainDetail=saved.relief;}catch{}
    world=await createWorld($('#world-container'),{terrainDetail,opening:'skydive',onNodeSelect:showLandmark,onProgress:progress=>{
      const loading=$('#world-loading');if(!loading)return;
      let text=loading.querySelector('.terrain-loading-text');if(!text){text=document.createElement('span');text.className='terrain-loading-text';for(const node of [...loading.childNodes])if(node.nodeType===3)node.remove();loading.append(text);}
      text.textContent=progress.retry?`Connexion interrompue · nouvelle tentative (${progress.retry})…`:`Chargement du relief IGN${terrainDetail==='lite'?' (version légère)':''} · ${(progress.loaded/1000000).toLocaleString('fr-FR',{maximumFractionDigits:1})} Mo reçus`;
    }});
    world.setGraph(graph);world.setState(state);world.setQuality(quality);world.setStyle(style==='map'?'nature':style);
    world.setVisible?.(view==='explorer'&&style!=='map');
    $('#world-loading')?.remove();
    if(style!=='map')$('#renderer-status').textContent='WebGL2';
    explorationUI=initExplorationUI(world,{onStyle:switchStyle,onOpenWorkshop:()=>switchView('graphe')});
    explorationUI.setActive(view==='explorer');
    // Without the Fil d'Ariane, nobody would pick a trail: back to the map.
    import('./fil-ariane-ui.js').then(({initFilAriane})=>initFilAriane(world,{container:$('#world-container'),link:startLink,tele:teleMode})).then(ui=>{if(!ui)world?.resetView?.();else if(teleMode)listenTele(ui);}).catch(error=>{console.warn('Fil d’Ariane indisponible :',error.message);world?.resetView?.();});
  } catch(error) {
    worldError=true;explorationUI?.dispose();explorationUI=null;world?.dispose();world=null;
    const container=$('#world-container');container.hidden=false;$('#world-map').hidden=true;
    document.body.classList.toggle('terrain-focus',view==='explorer');
    const card=document.createElement('div');card.className='world-start-error';
    const title=document.createElement('h2');title.textContent='Le paysage n’a pas pu être chargé.';
    const detail=document.createElement('p');detail.textContent=error.message||'Le rendu 3D ou les données du relief sont indisponibles.';
    const retry=document.createElement('button');retry.className='button primary';retry.textContent='Réessayer';
    retry.addEventListener('click',()=>{worldError=false;container.innerHTML='<div id="world-loading" class="world-loading"><span class="loader"></span>Chargement du relief réel de La Réunion…</div>';startWorld();},{once:true});
    const workshop=document.createElement('button');workshop.className='button secondary';workshop.textContent='Ouvrir l’atelier';workshop.addEventListener('click',()=>switchView('graphe'));
    card.append(title,detail,retry,workshop);container.replaceChildren(card);
    console.warn('Rendu 3D indisponible:',error.message);
  }
}
startWorld();
if('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !globalThis.Capacitor?.isNativePlatform?.()) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{/* Private hosting can restrict caching. */});
}
