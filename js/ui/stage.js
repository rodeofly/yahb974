// Moments plein écran des greffons (badge gagné, voyage sur le plateau…) : l'un après l'autre, jamais superposés.
// Pendant un moment, <html> porte la classe `lh-stage` : l'encre du paragraphe attend (css/app.css), puis se dévoile.
//
//   onStage((host, done) => { render(…, host); … done(); })
// `host` est un élément ajouté à <body> pour ce moment, retiré après `done()`.

import { render } from '../lib/preact-htm.js';

let chain = Promise.resolve();
let waiting = 0;

export function onStage(show) {
  waiting++;
  document.documentElement.classList.add('lh-stage');
  chain = chain.then(() => new Promise(resolve => {
    const host = document.createElement('div');
    host.className = 'stage-portal';
    document.body.append(host);
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      render(null, host); host.remove();
      if (--waiting === 0) document.documentElement.classList.remove('lh-stage');
      resolve();
    };
    try { show(host, done); } catch (e) { console.warn('[scène]', e); done(); }
  }));
  return chain;
}
