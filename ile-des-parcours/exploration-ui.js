const PREFS_KEY = 'reunion-terrain-v2';

export function initExplorationUI(world, {onStyle=()=>{},onOpenWorkshop=()=>{}}={}) {
  const panel=document.querySelector('.world-panel');
  const canCaptureMouse=!!panel.querySelector('canvas')?.requestPointerLock&&!matchMedia('(pointer: coarse)').matches;
  const root=document.createElement('div');root.className='terrain-hud';
  let active=true,settingsOpen=false,lastMode='orbit';
  let prefs={mode:'orbit',style:'nature',quality:'balanced',precision:250,labels:'auto',speed:'run',flightSpeed:'fast',forestDensity:'balanced',lighting:'tropical',ambiance:'paradis',verticalScale:2,relief:'',rivers:'on',forestTypes:'belts'};
  try{const saved=JSON.parse(localStorage.getItem(PREFS_KEY)||'{}');for(const key of Object.keys(prefs))if(saved[key]!==undefined)prefs[key]=saved[key];
    // Saved before the tropical ambiance existed: offer the new look once.
    if(saved.lighting&&saved.ambiance===undefined)prefs.lighting='tropical';}catch{}
  if(prefs.speed==='travel'){prefs.speed='run';prefs.flightSpeed='fast';}
  // Always offer an overview on a new visit; movement preferences remain local.
  prefs.mode='orbit';
  const save=()=>{try{localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));}catch{}};
  root.innerHTML=`
    <div class="terrain-topline">
      <div class="terrain-identity"><span class="terrain-mark" aria-hidden="true">△</span><div><h1>Les sentiers de La Réunion<span>.</span></h1><span id="terrain-source-mini">RELIEF RÉEL · IGN</span></div></div>
      <nav class="camera-switch" aria-label="Caméra et déplacement"><button data-camera="orbit" class="active" title="Vue d’ensemble">◈ <span>Carte</span></button><button data-camera="rts" title="Vue stratégie : glisser pour déplacer, clic droit pour tourner">♜ <span>Stratégie</span></button><button data-camera="third" title="Suivre le personnage">♙ <span>3e personne</span></button><button data-camera="fps" title="Voir à travers les yeux du personnage">⊙ <span>FPS</span></button><button data-camera="glide" title="Déployer le planeur — G"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 9Q12 1 22 9L12 12 2 9Z M5 10l7 10 7-10M12 12v8"/></svg><span>Planeur</span></button></nav>
      <div class="terrain-tools"><button id="terrain-fullscreen" class="terrain-icon-button" title="Plein écran" aria-label="Plein écran">⛶</button><button id="terrain-settings-toggle" class="terrain-settings-button" aria-expanded="false" aria-controls="terrain-settings">☷ <span>Réglages</span></button></div>
    </div>
    <div class="terrain-compass" id="terrain-compass" hidden><span>N</span><div><i></i><span id="terrain-heading">000°</span></div><span>S</span></div>
    <aside id="terrain-settings" class="terrain-settings" hidden>
      <div class="settings-heading"><div><span class="terrain-eyebrow">AFFICHAGE & EXPLORATION</span><h2>Le paysage à ta mesure</h2></div><button id="terrain-settings-close" class="terrain-icon-button" aria-label="Fermer les réglages">×</button></div>
      <div class="terrain-setting"><span>Style du terrain</span><div class="terrain-pills" id="terrain-style-pills"><button data-terrain-style="nature" class="active">Cartoon</button><button data-terrain-style="voxel">Facettes</button></div></div>
      <label class="terrain-setting"><span>Ambiance</span><select id="terrain-ambiance"><option value="paradis" selected>Île paradisiaque : lagon, plages, verts vifs</option><option value="nature">Naturelle, plus sobre</option></select><small>Couleurs du sol et de la mer ; le relief reste celui de l’IGN.</small></label>
      <label class="terrain-setting"><span>Rivières et cascades</span><select id="terrain-rivers"><option value="on" selected>Qui coulent</option><option value="off">Masquées</option></select><small>Cours d’eau et cascades © contributeurs OpenStreetMap (ODbL) ; l’eau accélère et blanchit là où le relief IGN est raide.</small></label>
      <label class="terrain-setting"><span>Lumière</span><select id="terrain-lighting"><option value="tropical" selected>Tropicale</option><option value="day">Journée</option><option value="golden">Fin d’après-midi</option></select><small>Change l’ambiance et la direction du soleil.</small></label>
      <label class="terrain-setting forest-note"><span>Canopée</span><select id="terrain-forest-density" aria-describedby="terrain-forest-note"><option value="off">Masquée</option><option value="discreet">Discrète</option><option value="balanced" selected>Équilibrée</option><option value="dense">Dense</option></select><small id="terrain-forest-note">Compare le paysage avec ou sans couvert arboré, puis ajuste sa présence visuelle.</small><small id="terrain-forest-status" role="status" hidden>Le couvert arboré est indisponible pour le moment.</small></label>
      <label class="terrain-setting"><span>Types de forêt</span><select id="terrain-forest-types"><option value="belts" selected>Étages de végétation</option><option value="plain">Couleur unique</option></select><small>Teintes indicatives selon l’altitude et la côte : forêt semi-sèche de l’ouest, bois de couleurs des bas, forêt de montagne, tamarinaies, fourrés d’altitude. L’emplacement des forêts reste celui d’ESA WorldCover.</small></label>
      <label class="terrain-setting"><span>Relief chargé</span><select id="terrain-relief"><option value="">Automatique (léger sur téléphone)</option><option value="lite">Léger : maille de 50 m, 4 Mo</option><option value="full">Détaillé : maille de 25 m, 16 Mo</option></select><small>S’applique au prochain chargement de la page.</small></label>
      <label class="terrain-setting"><span>Budget graphique</span><select id="terrain-quality"><option value="eco">Éco — priorité à la fluidité</option><option value="balanced" selected>Équilibré</option><option value="high">Élevé</option></select></label>
      <label class="terrain-setting"><span>Détail à distance</span><select id="terrain-precision"><option value="500">500 m — vue légère</option><option value="250" selected>250 m — équilibré</option><option value="100">100 m — détaillé</option><option value="50">50 m — très détaillé</option><option value="25">25 m — détail maximal disponible</option></select><small id="terrain-precision-note">Le sol proche conserve son détail ; le terrain lointain s’allège pendant le vol.</small></label>
      <label class="terrain-setting"><span>Légendes</span><select id="terrain-labels"><option value="auto">Automatiques et discrètes</option><option value="off">Masquées</option><option value="all">Davantage de repères</option></select><small>Les étiquettes derrière le relief ou qui se chevauchent restent cachées.</small></label>
      <label class="terrain-setting"><span>Exagération du relief <output id="terrain-scale-output">×2</output></span><input id="terrain-vertical-scale" type="range" min="1" max="2" step="0.1" value="2"><small>×1 conserve les proportions réelles. Les autres valeurs accentuent visuellement les hauteurs.</small></label>
      <label class="terrain-setting"><span>Déplacement au sol</span><select id="terrain-speed"><option value="walk">Marche</option><option value="run">Course vive</option></select><small>Maj pour courir, Espace pour bondir. Les destinations rejoignent les autres secteurs de l’île.</small></label><label class="terrain-setting"><span>Vitesse du planeur</span><select id="terrain-flight-speed"><option value="cruise">Croisière</option><option value="fast">Accélérée ×2</option></select><small>Ce réglage agit uniquement pendant le vol.</small></label>
      <details class="terrain-data-details"><summary>Données et performances</summary><dl><div><dt>Terrain</dt><dd id="terrain-data-source">MNT IGN</dd></div><div><dt>Grille des données</dt><dd id="terrain-data-grid">—</dd></div><div><dt>Maille visible</dt><dd id="terrain-data-effective">—</dd></div><div><dt>Triangles</dt><dd id="terrain-data-triangles">—</dd></div><div><dt>Fluidité</dt><dd id="terrain-data-fps">—</dd></div><div><dt>Couvert arboré</dt><dd id="terrain-data-forest">Chargement…</dd></div><div id="terrain-forest-grid-row" hidden><dt>Grille arborée</dt><dd id="terrain-data-forest-grid">—</dd></div></dl><p>La maille règle le niveau de détail ; elle n’est pas une mesure de l’exactitude altimétrique.</p><a id="terrain-elevation-source" href="https://www.data.gouv.fr/datasets/rge-alti-r" target="_blank" rel="noopener">MNT © IGN · Licence Ouverte 2.0 ↗</a><div id="terrain-forest-reference" hidden><p id="terrain-forest-data-note">Zones arborées de 2021 ; cimes représentées de façon illustrative.</p><a id="terrain-forest-source" href="https://doi.org/10.5281/zenodo.7254221" target="_blank" rel="noopener">ESA WorldCover 2021 · CC BY 4.0 ↗</a></div></details>
      <button id="terrain-open-workshop" class="terrain-workshop-link">Ouvrir l’atelier du parcours ↗</button>
    </aside>
    <div class="terrain-bottomline">
      <div class="terrain-location"><span class="terrain-location-dot"></span><div><span class="terrain-eyebrow" id="terrain-place-name">ÎLE DE LA RÉUNION</span><div class="terrain-telemetry"><b id="terrain-altitude">— m</b><span id="terrain-coordinates">55° E · 21° S</span></div></div></div>
      <div class="terrain-help" id="terrain-help"><span id="terrain-input-hint">Glisser pour tourner · Molette pour zoomer</span><button id="terrain-capture" hidden>Capturer la souris</button><span class="terrain-keyhint" id="terrain-keyhint">V · Changer de caméra</span></div>
      <div class="terrain-destination"><label class="sr-only" for="terrain-destination-select">Destination sur l’île</label><select id="terrain-destination-select"><option value="">Rejoindre un lieu…</option></select><button id="terrain-go" title="Rejoindre ce lieu" aria-label="Rejoindre ce lieu">→</button><button id="terrain-overview" title="Revoir toute l’île" aria-label="Vue de toute l’île">⌖</button></div>
    </div>
    <div id="flight-instruments" class="flight-instruments" hidden><span id="flight-kicker" class="flight-kicker">VOL LIBRE</span><div class="flight-readings"><div><b id="flight-speed">—</b><span>km/h</span></div><div><b id="flight-clearance">—</b><span>m au-dessus du sol</span></div></div><div class="flight-actions"><button id="flight-pace" aria-pressed="false">Accélérer le vol ×2</button><button id="flight-fold">Replier le planeur <kbd>G</kbd></button></div></div>
    <div id="terrain-toast" class="terrain-toast" role="status" hidden></div>`;
  panel.appendChild(root);
  const $=s=>root.querySelector(s);
  const $$=s=>[...root.querySelectorAll(s)];
  let messageTimer;
  function message(text){$('#terrain-toast').textContent=text;$('#terrain-toast').hidden=false;clearTimeout(messageTimer);messageTimer=setTimeout(()=>$('#terrain-toast').hidden=true,4300);}
  function setSettings(value){settingsOpen=value;$('#terrain-settings').hidden=!value;$('#terrain-settings-toggle').setAttribute('aria-expanded',String(value));root.classList.toggle('settings-open',value);}
  function syncMode(mode) {
    lastMode=mode;prefs.mode=mode;
    $$('[data-camera]').forEach(b=>{b.classList.toggle('active',b.dataset.camera===mode);b.setAttribute('aria-pressed',String(b.dataset.camera===mode));});
    $('#terrain-compass').hidden=mode==='orbit'||mode==='rts'||mode==='cinema';$('#terrain-capture').hidden=mode!=='fps'||!canCaptureMouse;
    $('#terrain-input-hint').textContent=mode==='orbit'?'Glisser pour tourner · Molette pour zoomer':mode==='cinema'?'Glisser pour regarder autour · Molette pour s’éloigner':mode==='rts'?'Glisser pour déplacer · Clic droit pour tourner · Molette pour zoomer':mode==='glide'?'Souris : tirer à gauche ou à droite pour virer · pousser pour accélérer · tirer vers toi pour freiner':'ZQSD / WASD / flèches · Glisser pour regarder';
    $('#terrain-keyhint').textContent=mode==='orbit'?'V · Caméra   G · Planeur':mode==='cinema'?'Échap · Revenir à la carte':mode==='rts'?'ZQSD · Déplacer   A / E · Tourner   Espace · Marcher   F · Suivre':mode==='glide'?'Clic maintenu ou Espace · Gaz 🚀   Échap · Libérer la souris   G · Replier':'Maj · Courir   Espace · Sauter   G · Planeur';
    $('#flight-instruments').hidden=mode!=='glide';
    root.classList.toggle('camera-walking',!['orbit','rts','cinema'].includes(mode));root.classList.toggle('camera-gliding',mode==='glide');save();
  }
  function setFlightSpeed(value) {
    prefs.flightSpeed=value==='fast'?'fast':'cruise';world.setFlightSpeed?.(prefs.flightSpeed);
    $('#terrain-flight-speed').value=prefs.flightSpeed;
    $('#flight-pace').textContent=prefs.flightSpeed==='fast'?'Revenir à la croisière':'Accélérer le vol ×2';
    $('#flight-pace').setAttribute('aria-pressed',String(prefs.flightSpeed==='fast'));
    $('#flight-kicker').textContent=prefs.flightSpeed==='fast'?'VOL ACCÉLÉRÉ':'VOL LIBRE';save();
  }
  function setMode(mode) {
    if(!['orbit','rts','third','fps','glide'].includes(mode))mode='orbit';
    const previous=lastMode;
    if(world.setCameraMode?.(mode)===false){message('Ce mode de déplacement est indisponible ici.');return;}
    syncMode(world.getInfo().cameraMode||mode);
    if(lastMode==='glide'&&previous!=='glide')message('🚀 Un coup de fusée et le planeur décolle ! La souris pilote (le viseur montre de quel côté tu tires), le clic maintenu met les gaz. L’atterrissage est automatique.');
  }
  const landmarks=world.getLandmarks?.()||[];
  for(const l of landmarks){const o=document.createElement('option');o.value=l.id;o.textContent=l.name||l.title||l.id;$('#terrain-destination-select').append(o);}
  function goToPlace(){const id=$('#terrain-destination-select').value,l=landmarks.find(x=>x.id===id);if(!l)return;
    if(world.teleportTo?.(l.lon,l.lat)===false){message('Le terrain à cet emplacement ne permet pas de se poser. Choisis un autre repère.');return;}
    const actualMode=world.getInfo().cameraMode||lastMode;if(actualMode!==lastMode)syncMode(actualMode);
    $('#terrain-place-name').textContent=l.name||l.title;message(`${l.name||l.title} · ${lastMode==='orbit'?'Choisis FPS, 3e personne ou Planeur pour explorer.':lastMode==='glide'?'Le vol reprend dans ce secteur.':'Tu peux reprendre la marche.'}`);
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.camera)setMode(b.dataset.camera);
    if(b.dataset.terrainStyle){prefs.style=b.dataset.terrainStyle;onStyle(prefs.style);$$('[data-terrain-style]').forEach(x=>x.classList.toggle('active',x.dataset.terrainStyle===prefs.style));save();}
  });
  $('#terrain-settings-toggle').addEventListener('click',()=>setSettings(!settingsOpen));
  $('#terrain-settings-close').addEventListener('click',()=>setSettings(false));
  $('#terrain-relief').addEventListener('change',e=>{prefs.relief=e.target.value;save();message('Relief enregistré : recharge la page pour l’appliquer.');});
  $('#terrain-quality').addEventListener('change',e=>{prefs.quality=e.target.value;world.setQuality(prefs.quality);save();});
  $('#terrain-lighting').addEventListener('change',e=>{prefs.lighting=e.target.value;world.setLighting?.(prefs.lighting);save();});
  $('#terrain-forest-types').addEventListener('change',e=>{prefs.forestTypes=e.target.value;world.setForestTypes?.(prefs.forestTypes!=='plain');save();});
  $('#terrain-rivers').addEventListener('change',e=>{prefs.rivers=e.target.value;world.setRivers?.(prefs.rivers!=='off');save();});
  $('#terrain-ambiance').addEventListener('change',e=>{prefs.ambiance=e.target.value;world.setAmbiance?.(prefs.ambiance);if(prefs.ambiance==='paradis'&&prefs.lighting!=='tropical'){prefs.lighting='tropical';$('#terrain-lighting').value='tropical';world.setLighting?.('tropical');}save();});
  $('#terrain-forest-density').addEventListener('change',e=>{prefs.forestDensity=e.target.value;world.setForestDensity?.(prefs.forestDensity);save();});
  $('#terrain-precision').addEventListener('change',e=>{prefs.precision=Number(e.target.value);world.setPrecision?.(prefs.precision);save();message(`Maille à distance demandée : ${prefs.precision} m. Le terrain proche s’adapte à l’exploration.`);});
  $('#terrain-labels').addEventListener('change',e=>{prefs.labels=e.target.value;world.setLabelMode?.(prefs.labels);save();});
  $('#terrain-speed').addEventListener('change',e=>{prefs.speed=e.target.value;world.setSpeed?.(prefs.speed);save();});
  $('#terrain-flight-speed').addEventListener('change',e=>setFlightSpeed(e.target.value));
  $('#flight-pace').addEventListener('click',()=>setFlightSpeed(prefs.flightSpeed==='fast'?'cruise':'fast'));
  let scaleTimer;
  $('#terrain-vertical-scale').addEventListener('input',e=>{$('#terrain-scale-output').textContent=`×${Number(e.target.value).toLocaleString('fr-FR')}`;clearTimeout(scaleTimer);scaleTimer=setTimeout(()=>{prefs.verticalScale=Number(e.target.value);world.setVerticalScale?.(prefs.verticalScale);save();},160);});
  $('#terrain-go').addEventListener('click',goToPlace);
  $('#terrain-destination-select').addEventListener('change',goToPlace);
  $('#terrain-overview').addEventListener('click',()=>{setMode('orbit');world.resetView();});
  $('#flight-fold').addEventListener('click',()=>setMode('third'));
  $('#terrain-capture').addEventListener('click',async()=>{if(await world.requestPointerLock?.()===false)message('La capture de souris est indisponible ici. Tu peux glisser sur la scène pour orienter la vue.');});
  $('#terrain-fullscreen').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(panel.requestFullscreen)await panel.requestFullscreen();else message('La vue utilise déjà tout l’écran disponible dans ce navigateur.');}catch{message('Le navigateur ne permet pas le plein écran dans ce contexte.');}
  });
  $('#terrain-open-workshop').addEventListener('click',()=>{setSettings(false);onOpenWorkshop();});
  function keyboard(e){if(!active||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,[contenteditable="true"]'))return;
    if(e.code==='KeyV'){e.preventDefault();setMode(lastMode==='glide'?'third':['orbit','third','fps'][(['orbit','third','fps'].indexOf(lastMode)+1)%3]);}
    if(e.code==='KeyG'){e.preventDefault();setMode(lastMode==='glide'?'third':'glide');}
    if(e.key==='Escape'&&settingsOpen)setSettings(false);
  }
  document.addEventListener('keydown',keyboard);
  function update() {
    if(!active)return;
    const info=world.getInfo();
    const mode=info.cameraMode||lastMode;
    const player=info.player||{};
    if(['walk','run'].includes(player.speedMode)&&player.speedMode!==prefs.speed){prefs.speed=player.speedMode;$('#terrain-speed').value=prefs.speed;save();}
    if(mode!==lastMode){const previous=lastMode;syncMode(mode);if(previous==='glide'&&player.flight?.landed)message(player.flight.landingReason==='water'?'Vol terminé au bord de l’eau · Retour au dernier point terrestre.':'Atterrissage · Tu peux reprendre la marche.');}
    if(mode==='glide'){const speed=player.flight?.speedMetersPerSecond??player.speedMetersPerSecond??0;$('#flight-speed').textContent=Math.round(speed*3.6);$('#flight-clearance').textContent=Math.max(0,Math.round(player.flight?.clearanceMeters??player.clearanceMeters??0));}
    const lat=Number(player.lat),lon=Number(player.lon),alt=Number(player.altitudeM);
    if(Number.isFinite(alt))$('#terrain-altitude').textContent=`${Math.round(alt).toLocaleString('fr-FR')} m`;
    if(Number.isFinite(lat)&&Number.isFinite(lon))$('#terrain-coordinates').textContent=`${Math.abs(lat).toFixed(4)}° ${lat<0?'S':'N'} · ${Math.abs(lon).toFixed(4)}° ${lon<0?'O':'E'}`;
    const heading=Number(player.headingDegrees)||0;$('#terrain-heading').textContent=`${String(Math.round(heading)%360).padStart(3,'0')}°`;
    $('#terrain-compass i').style.transform=`rotate(${-heading}deg)`;
    root.classList.toggle('is-moving',!!player.moving&&!settingsOpen);
    root.classList.toggle('pointer-locked',!!player.pointerLocked);
    const metadata=info.metadata||info.terrain?.metadata||{};
    const source=info.sourceResolutionM||metadata.sampleSpacingM||metadata.resolutionM||25;
    $('#terrain-source-mini').textContent=`MNT IGN · GRILLE ${source} M`;
    $('#terrain-data-source').textContent=metadata.shortName||metadata.title||'RGE ALTI · IGN';
    $('#terrain-data-grid').textContent=`${source} m`;
    const range=info.precisionRangeM;
    const localPrecision=info.terrain?.localPrecisionM;
    $('#terrain-data-effective').textContent=!['orbit','rts','cinema'].includes(mode)&&typeof localPrecision==='number'?`${localPrecision} m sous le personnage`:range?`${range.min} à ${range.max} m`:`${info.precisionM||prefs.precision} m`;
    $('#terrain-data-triangles').textContent=Number(info.triangles||0).toLocaleString('fr-FR');
    $('#terrain-data-fps').textContent=info.fps?`${info.fps} images/s`:'Calcul en cours';
    const forest=info.forest||{},forestMetadata=forest.metadata||{},forestAvailable=!!forest.available;
    const forestYear=Number(forestMetadata.observationYear)||2021;
    $('#terrain-data-forest').textContent=forestAvailable?`ESA WorldCover · ${forestYear}`:forest.error?'Indisponible':'Chargement…';
    $('#terrain-forest-status').hidden=forestAvailable||!forest.error;
    $('#terrain-forest-reference').hidden=!forestAvailable;
    const forestSpacing=Number(forestMetadata.sampleSpacingM),forestNative=Number(forestMetadata.sourceNominalResolutionM);
    $('#terrain-forest-grid-row').hidden=!forestAvailable||!Number.isFinite(forestSpacing)||forestSpacing<=0;
    $('#terrain-data-forest-grid').textContent=Number.isFinite(forestSpacing)?`${forestSpacing} m${Number.isFinite(forestNative)&&forestNative>0?` (source ${forestNative} m)`:''}`:'—';
    $('#terrain-forest-data-note').textContent=`Zones arborées de ${forestYear} ; cimes représentées de façon illustrative.`;
    $('#terrain-forest-source').textContent=`ESA WorldCover ${forestYear} · CC BY 4.0 ↗`;
    const forestSourceURL=forestMetadata.doi||forestMetadata.sourceDescriptionUrl;
    if(typeof forestSourceURL==='string'&&forestSourceURL.startsWith('https://'))$('#terrain-forest-source').href=forestSourceURL;
    if(['off','discreet','balanced','dense'].includes(info.forestDensity)&&info.forestDensity!==prefs.forestDensity){prefs.forestDensity=info.forestDensity;$('#terrain-forest-density').value=prefs.forestDensity;save();}
    const sourceURL=metadata.officialDescriptionUrl||metadata.catalogUrl||metadata.sourceURL||metadata.url;
    if(typeof sourceURL==='string'&&sourceURL.startsWith('https://'))$('#terrain-elevation-source').href=sourceURL;
  }
  ['quality','precision','labels','speed','lighting','ambiance','relief','rivers'].forEach(key=>{const el=$(`#terrain-${key}`);if([...el.options].some(o=>o.value===String(prefs[key])))el.value=String(prefs[key]);else prefs[key]=el.value;});
  if(prefs.forestTypes!=='plain')prefs.forestTypes='belts';$('#terrain-forest-types').value=prefs.forestTypes;
  for(const [key,id] of [['flightSpeed','terrain-flight-speed'],['forestDensity','terrain-forest-density']]){const el=$(`#${id}`);if([...el.options].some(o=>o.value===String(prefs[key])))el.value=String(prefs[key]);else prefs[key]=el.value;}
  if(!['nature','voxel'].includes(prefs.style))prefs.style='nature';
  prefs.verticalScale=Math.max(1,Math.min(2,Number(prefs.verticalScale)||1));
  $('#terrain-vertical-scale').value=prefs.verticalScale;$('#terrain-scale-output').textContent=`×${prefs.verticalScale}`;
  onStyle(prefs.style);world.setQuality(prefs.quality);world.setLighting?.(prefs.lighting);world.setAmbiance?.(prefs.ambiance);world.setRivers?.(prefs.rivers!=='off');world.setForestTypes?.(prefs.forestTypes!=='plain');world.setPrecision?.(Number(prefs.precision));world.setLabelMode?.(prefs.labels);world.setSpeed?.(prefs.speed);setFlightSpeed(prefs.flightSpeed);world.setForestDensity?.(prefs.forestDensity);world.setVerticalScale?.(prefs.verticalScale);world.setNarrativeVisible?.(false);
  $$('[data-terrain-style]').forEach(b=>b.classList.toggle('active',b.dataset.terrainStyle===prefs.style));if(world.getView?.().view==='skydive')syncMode('cinema');else setMode('orbit');
  document.body.classList.add('terrain-focus');update();
  const interval=setInterval(update,200);
  return {
    setActive(value){active=!!value;root.hidden=!active;document.body.classList.toggle('terrain-focus',active);if(active){update();world.setVisible(true);requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}else{world.setVisible(false);if(document.pointerLockElement)document.exitPointerLock?.();}},
    setMode,
    dispose(){clearInterval(interval);clearTimeout(messageTimer);clearTimeout(scaleTimer);document.removeEventListener('keydown',keyboard);root.remove();document.body.classList.remove('terrain-focus');}
  };
}
