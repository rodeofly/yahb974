// Parties « moteur » des greffons, sans interface : importé par les tests Node (et par index.js via chaque greffon).
// Une ligne par greffon, séparées par une ligne vide pour que les fusions git ne se gênent pas.
import './modes/core.js'; // [modes] (en tête : pas de ligne réservée pour ce greffon)

import './equipement/core.js';

import './compteurs/core.js';

import './compagnons/core.js';

import './defis/core.js';

import './zefor/core.js';

import './carte/core.js';

import './succes/core.js';

import './echanges/core.js';
