// Réunion's vegetation belts, as flat (posterised) tints for the forest.
// Where the forest is comes only from the ESA WorldCover mask; these belts
// only colour it, after the island's well-known stages of vegetation: the
// dry leeward west, the wet windward lowlands, the mountain rainforest, the
// tamarind woods and the heath of the summits. Indicative tints, not a map
// of forest types.

export const FOREST_BELTS = Object.freeze([
  { id: 'semi-seche', name: 'Forêt semi-sèche (côte sous le vent)', colour: '#8a9a3c' },
  { id: 'bois-couleurs-bas', name: 'Bois de couleurs des bas', colour: '#2e7d3a' },
  { id: 'foret-montagne', name: 'Forêt de montagne (bois de couleurs des hauts)', colour: '#1f5e44' },
  { id: 'tamarinaie', name: 'Tamarinaie des Hauts', colour: '#5f8a62' },
  { id: 'ericoide', name: 'Fourrés éricoïdes d’altitude (branles)', colour: '#807a46' },
]);
// Upper limits of the lower belts, metres; the leeward west lies west of
// this longitude (Saint-Paul, Saint-Leu, Saint-Gilles).
export const BELT_LIMITS_M = Object.freeze({ lowlands: 850, mountain: 1550, tamarind: 2000 });
export const LEEWARD_LONGITUDE = 55.42;

/** Index into FOREST_BELTS for ground at `metres` of altitude; `leeward` true on the dry west side. */
export function forestBelt(metres, leeward) {
  if (metres < BELT_LIMITS_M.lowlands) return leeward ? 0 : 1;
  if (metres < BELT_LIMITS_M.mountain) return 2;
  if (metres < BELT_LIMITS_M.tamarind) return 3;
  return 4;
}
