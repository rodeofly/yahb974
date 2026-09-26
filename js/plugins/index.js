// Greffons chargés par l'application (interface + moteur).
// Chaque greffon vit dans js/plugins/<nom>/ : core.js (moteur pur, testable dans Node) et index.js (interface).
// Une ligne par greffon, séparées par une ligne vide pour que les fusions git ne se gênent pas.

import './equipement/index.js';

import './compteurs/index.js';

import './compagnons/index.js';

import './defis/index.js';

import './zefor/index.js';

import './maths/index.js';

import './carte/index.js';

import './succes/index.js';

import './echanges/index.js';

import './partage/index.js';

import './accessibilite/index.js';
