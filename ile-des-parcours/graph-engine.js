/**
 * Moteur indépendant des graphismes et du réseau.
 *
 * Graphes orientés pondérés, éventuellement multiples et cycliques. Les
 * algorithmes mathématiques travaillent sur toutes les arêtes structurelles :
 * ils n'évaluent ni les conditions ni les effets pédagogiques. Seul traverse()
 * fait évoluer l'état pédagogique; availableEdges() indique ses possibilités.
 * Tous les identifiants de nœuds sont traités comme des identifiants opaques.
 */

export const GRAPH_LIMITS = Object.freeze({ nodes: 500, edges: 2000, conditionDepth: 16, conditionTerms: 256 });
export const INITIAL_VARIABLES = Object.freeze({ score: 0, observation: 0, raisonnement: 0, autonomie: 0 });

const UNSAFE_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
const OP_LABELS = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const safeVariable = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
  && !UNSAFE_NAMES.has(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 80
  && /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u.test(value);
const copy = value => JSON.parse(JSON.stringify(value));

function jsonData(value, depth = 0, budget = { count: 0 }, ancestors = new Set()) {
  budget.count += 1;
  if (depth > 64 || budget.count > 250000) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if ((!Array.isArray(value) && !record(value)) || ancestors.has(value)
    || Object.getOwnPropertySymbols(value).length) return false;
  ancestors.add(value);
  for (const child of Object.values(value)) {
    if (!jsonData(child, depth + 1, budget, ancestors)) { ancestors.delete(value); return false; }
  }
  ancestors.delete(value);
  return true;
}

function checkString(value, path, errors, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    errors.push(`${path} doit être un texte ${allowEmpty ? '' : 'non vide '}de ${maximum} caractères au maximum.`);
  }
}

function checkCondition(condition, path, errors, depth = 0, budget = { count: 0 }, ancestors = new Set()) {
  budget.count += 1;
  if (depth > GRAPH_LIMITS.conditionDepth || budget.count > GRAPH_LIMITS.conditionTerms) {
    errors.push(`${path} dépasse la taille ou la profondeur maximale des conditions.`);
    return;
  }
  if (!record(condition) || ancestors.has(condition)) {
    errors.push(`${path} doit être un objet de condition sans référence circulaire.`);
    return;
  }
  const keys = Object.keys(condition);
  const logical = own(condition, 'all') ? 'all' : own(condition, 'any') ? 'any' : null;
  if (logical) {
    if (keys.length !== 1 || !Array.isArray(condition[logical]) || !condition[logical].length
      || condition[logical].length > GRAPH_LIMITS.conditionTerms) {
      errors.push(`${path} doit contenir uniquement ${logical}, une liste non vide de conditions (maximum ${GRAPH_LIMITS.conditionTerms}).`);
      return;
    }
    ancestors.add(condition);
    condition[logical].forEach((child, index) => checkCondition(child, `${path}.${logical}[${index}]`, errors, depth + 1, budget, ancestors));
    ancestors.delete(condition);
    return;
  }
  if (keys.length !== 3 || !['variable', 'op', 'value'].every(key => own(condition, key))) {
    errors.push(`${path} doit contenir exactement variable, op et value, ou une composition all/any.`);
    return;
  }
  if (!safeVariable(condition.variable)) errors.push(`${path}.variable n'est pas un nom de variable autorisé.`);
  if (!OPS.has(condition.op)) errors.push(`${path}.op doit être eq, ne, gt, gte, lt ou lte.`);
  if (!finite(condition.value)) errors.push(`${path}.value doit être un nombre fini.`);
}

/** Valide sans modifier le graphe. Les erreurs et avertissements sont en français. */
export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  if (!record(graph)) return { valid: false, errors: ['Le graphe doit être un objet JSON.'], warnings };
  if (graph.version !== 1) errors.push('La version du format doit être 1.');
  checkString(graph.title, 'title', errors, 200);
  if (!validId(graph.start)) errors.push('start doit être un identifiant de nœud valide.');
  if (!Array.isArray(graph.nodes) || !graph.nodes.length || graph.nodes.length > GRAPH_LIMITS.nodes) {
    errors.push(`nodes doit contenir de 1 à ${GRAPH_LIMITS.nodes} nœuds.`);
  }
  if (!Array.isArray(graph.edges) || graph.edges.length > GRAPH_LIMITS.edges) {
    errors.push(`edges doit être une liste de ${GRAPH_LIMITS.edges} arêtes au maximum.`);
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
    || graph.nodes.length > GRAPH_LIMITS.nodes || graph.edges.length > GRAPH_LIMITS.edges) {
    return { valid: false, errors, warnings };
  }

  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!record(node)) { errors.push(`${path} doit être un objet.`); return; }
    if (!validId(node.id)) errors.push(`${path}.id doit contenir de 1 à 80 lettres, chiffres, _, -, . ou : et commencer par une lettre ou un chiffre.`);
    else if (nodeIds.has(node.id)) errors.push(`Identifiant de nœud en double : ${node.id}.`);
    else nodeIds.add(node.id);
    checkString(node.title, `${path}.title`, errors, 200);
    checkString(node.kind, `${path}.kind`, errors, 60);
    checkString(node.body, `${path}.body`, errors, 16000, true);
    for (const coordinate of ['x', 'z']) {
      if (!finite(node[coordinate]) || Math.abs(node[coordinate]) > 1000000) {
        errors.push(`${path}.${coordinate} doit être un nombre fini compris entre −1 000 000 et 1 000 000.`);
      }
    }
  });
  if (!nodeIds.has(graph.start)) errors.push('Le nœud de départ start est absent de nodes.');

  const edgeIds = new Set();
  graph.edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    if (!record(edge)) { errors.push(`${path} doit être un objet.`); return; }
    if (!validId(edge.id)) errors.push(`${path}.id n'est pas un identifiant valide.`);
    else if (edgeIds.has(edge.id)) errors.push(`Identifiant d'arête en double : ${edge.id}.`);
    else edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) errors.push(`${path}.source désigne un nœud absent.`);
    if (!nodeIds.has(edge.target)) errors.push(`${path}.target désigne un nœud absent.`);
    checkString(edge.label, `${path}.label`, errors, 300);
    if (!finite(edge.weight) || edge.weight < 0) errors.push(`${path}.weight doit être un coût fini positif ou nul.`);
    if (own(edge, 'condition')) checkCondition(edge.condition, `${path}.condition`, errors);
    if (own(edge, 'effects')) {
      if (!record(edge.effects) || Object.keys(edge.effects).length > 64) {
        errors.push(`${path}.effects doit être un dictionnaire de 64 incréments numériques au maximum.`);
      } else {
        for (const [variable, value] of Object.entries(edge.effects)) {
          if (!safeVariable(variable)) errors.push(`${path}.effects contient une variable interdite : ${variable}.`);
          if (!finite(value)) errors.push(`${path}.effects.${variable} doit être un incrément numérique fini.`);
        }
      }
    }
  });

  // Refuse les métadonnées non JSON, trop volumineuses ou circulaires, y compris
  // dans des champs additionnels que le moteur doit pouvoir conserver à l'export.
  if (!errors.length) {
    try {
      if (!jsonData(graph)) errors.push('Le graphe doit contenir uniquement des données JSON finies, sans code ni référence circulaire (profondeur maximale : 64).');
      else if (JSON.stringify(graph).length > 4000000) errors.push('Le graphe dépasse la limite de 4 millions de caractères JSON.');
    } catch {
      errors.push('Le graphe doit être sérialisable en JSON sans référence circulaire.');
    }
  }
  if (!errors.length) {
    const reached = walk(graph, graph.start, false);
    if (reached.length < graph.nodes.length) {
      warnings.push(`${graph.nodes.length - reached.length} nœud(s) inaccessible(s) depuis le départ dans le graphe structurel.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function assertGraph(graph) {
  const result = validateGraph(graph);
  if (!result.valid) throw new Error(`Graphe invalide : ${result.errors.join(' ')}`);
}

function assertNode(graph, id) {
  if (!graph.nodes.some(node => node.id === id)) throw new Error(`Nœud inconnu : ${String(id)}.`);
}

function adjacency(graph, reversed = false) {
  const result = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) result.get(reversed ? edge.target : edge.source).push(reversed ? edge.source : edge.target);
  return result;
}

function collectVariables(condition, variables) {
  if (!condition) return;
  if (condition.all || condition.any) (condition.all || condition.any).forEach(child => collectVariables(child, variables));
  else if (!own(variables, condition.variable)) variables[condition.variable] = 0;
}

/** Variables numériques déclarées initialisées à zéro; le départ est déjà visité. */
export function createState(graph) {
  assertGraph(graph);
  const variables = { ...INITIAL_VARIABLES };
  for (const edge of graph.edges) {
    collectVariables(edge.condition, variables);
    for (const name of Object.keys(edge.effects || {})) if (!own(variables, name)) variables[name] = 0;
  }
  return { current: graph.start, variables, visited: [graph.start], history: [] };
}

function assertSnapshot(state) {
  if (!record(state) || !validId(state.current) || !record(state.variables)
    || !Array.isArray(state.visited) || !state.visited.includes(state.current)
    || state.visited.some(id => !validId(id)) || new Set(state.visited).size !== state.visited.length) {
    throw new Error('État de parcours invalide.');
  }
  for (const [name, value] of Object.entries(state.variables)) {
    if (!safeVariable(name) || !finite(value)) throw new Error(`Variable d'état invalide : ${name}.`);
  }
}

function assertState(state, graph) {
  assertSnapshot(state);
  if (!Array.isArray(state.history)) throw new Error("L'historique de l'état doit être une liste.");
  if (graph) {
    assertNode(graph, state.current);
    const ids = new Set(graph.nodes.map(node => node.id));
    if (state.visited.some(id => !ids.has(id))) throw new Error("L'état contient un nœud visité absent du graphe.");
  }
}

function evaluate(condition, variables) {
  if (!condition) return { available: true, reason: '' };
  if (condition.all) {
    const parts = condition.all.map(child => evaluate(child, variables));
    return { available: parts.every(part => part.available), reason: parts.filter(part => !part.available).map(part => part.reason).join(' ET ') };
  }
  if (condition.any) {
    const parts = condition.any.map(child => evaluate(child, variables));
    const available = parts.some(part => part.available);
    return { available, reason: available ? '' : parts.map(part => `(${part.reason})`).join(' OU ') };
  }
  const actual = own(variables, condition.variable) ? variables[condition.variable] : 0;
  const expected = condition.value;
  const matches = {
    eq: () => actual === expected, ne: () => actual !== expected,
    gt: () => actual > expected, gte: () => actual >= expected,
    lt: () => actual < expected, lte: () => actual <= expected,
  };
  const available = matches[condition.op]();
  return { available, reason: available ? '' : `${condition.variable} ${OP_LABELS[condition.op]} ${expected} requis (actuel : ${actual})` };
}

/** Toutes les sorties du nœud courant, enrichies de available et reason. */
export function availableEdges(graph, state) {
  assertGraph(graph);
  assertState(state, graph);
  return graph.edges.filter(edge => edge.source === state.current)
    .map(edge => ({ ...copy(edge), ...evaluate(edge.condition, state.variables) }));
}

/** Transition atomique : condition avant effets, visite distincte, historique réversible. */
export function traverse(graph, state, edgeId) {
  assertGraph(graph);
  assertState(state, graph);
  const edge = graph.edges.find(candidate => candidate.id === edgeId);
  if (!edge || edge.source !== state.current) throw new Error("Cette arête n'est pas une sortie du nœud courant.");
  const permission = evaluate(edge.condition, state.variables);
  if (!permission.available) throw new Error(`Transition verrouillée : ${permission.reason}.`);
  const next = copy(state);
  const before = { current: next.current, variables: { ...next.variables }, visited: [...next.visited] };
  for (const [variable, increment] of Object.entries(edge.effects || {})) {
    const value = (own(next.variables, variable) ? next.variables[variable] : 0) + increment;
    if (!Number.isFinite(value)) throw new Error(`Dépassement numérique pour la variable ${variable}.`);
    next.variables[variable] = value;
  }
  next.current = edge.target;
  if (!next.visited.includes(edge.target)) next.visited.push(edge.target);
  next.history.push({
    step: next.history.length + 1,
    edgeId: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    effects: { ...(edge.effects || {}) },
    before,
  });
  return next;
}

/** Annule la dernière transition; sans historique, renvoie une copie inchangée. */
export function undoState(state) {
  assertState(state);
  if (!state.history.length) return copy(state);
  const next = copy(state);
  const last = next.history.pop();
  if (!record(last)) throw new Error("L'événement à annuler est invalide.");
  assertSnapshot(last.before);
  return { current: last.before.current, variables: { ...last.before.variables }, visited: [...last.before.visited], history: next.history };
}

function walk(graph, start, depthFirst) {
  const neighbours = adjacency(graph);
  const discovered = new Set();
  const order = [];
  const queue = [start];
  let index = 0;
  while (depthFirst ? queue.length > 0 : index < queue.length) {
    const id = depthFirst ? queue.pop() : queue[index++];
    if (discovered.has(id)) continue;
    discovered.add(id);
    order.push(id);
    const targets = neighbours.get(id);
    if (depthFirst) {
      for (let i = targets.length - 1; i >= 0; i--) if (!discovered.has(targets[i])) queue.push(targets[i]);
    } else {
      for (const target of targets) if (!discovered.has(target)) queue.push(target);
    }
  }
  return order;
}

/** Parcours en largeur structurel; ordre stable suivant la liste d'arêtes. */
export function bfs(graph, start = graph.start) {
  assertGraph(graph);
  assertNode(graph, start);
  return walk(graph, start, false);
}

/** Parcours en profondeur structurel; ordre stable suivant la liste d'arêtes. */
export function dfs(graph, start = graph.start) {
  assertGraph(graph);
  assertNode(graph, start);
  return walk(graph, start, true);
}

/** Dijkstra structurel; poids >= 0. Absence de chemin : {path: [], distance: Infinity}. */
export function shortestPath(graph, from, to) {
  assertGraph(graph);
  assertNode(graph, from);
  assertNode(graph, to);
  const distances = new Map(graph.nodes.map(node => [node.id, Infinity]));
  const previous = new Map();
  const pending = new Set(graph.nodes.map(node => node.id));
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) outgoing.get(edge.source).push(edge);
  distances.set(from, 0);
  while (pending.size) {
    let current = null;
    let best = Infinity;
    for (const id of pending) if (distances.get(id) < best) { best = distances.get(id); current = id; }
    if (current === null) break;
    pending.delete(current);
    if (current === to) break;
    for (const edge of outgoing.get(current)) {
      if (!pending.has(edge.target)) continue;
      const candidate = best + edge.weight;
      if (!Number.isFinite(candidate)) throw new Error('Le coût du chemin dépasse la capacité numérique du moteur.');
      if (candidate < distances.get(edge.target)) {
        distances.set(edge.target, candidate);
        previous.set(edge.target, current);
      }
    }
  }
  const distance = distances.get(to);
  if (!Number.isFinite(distance)) return { path: [], distance: Infinity };
  const path = [to];
  while (path[0] !== from) path.unshift(previous.get(path[0]));
  return { path, distance };
}

function components(graph) {
  // Tarjan : O(V + E). La validation borne V à 500.
  const neighbours = adjacency(graph);
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const stacked = new Set();
  const found = [];
  let nextIndex = 0;
  function visit(id) {
    indices.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    stacked.add(id);
    for (const target of neighbours.get(id)) {
      if (!indices.has(target)) { visit(target); low.set(id, Math.min(low.get(id), low.get(target))); }
      else if (stacked.has(target)) low.set(id, Math.min(low.get(id), indices.get(target)));
    }
    if (low.get(id) === indices.get(id)) {
      const component = [];
      let member;
      do { member = stack.pop(); stacked.delete(member); component.push(member); } while (member !== id);
      found.push(component);
    }
  }
  for (const node of graph.nodes) if (!indices.has(node.id)) visit(node.id);
  const rank = new Map(graph.nodes.map((node, index) => [node.id, index]));
  for (const component of found) component.sort((a, b) => rank.get(a) - rank.get(b));
  return found.sort((a, b) => rank.get(a[0]) - rank.get(b[0]));
}

function weakComponents(graph) {
  const neighbours = adjacency(graph);
  for (const edge of graph.edges) neighbours.get(edge.target).push(edge.source);
  const visited = new Set();
  let count = 0;
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    count += 1;
    const pending = [node.id];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const target of neighbours.get(id)) if (!visited.has(target)) pending.push(target);
    }
  }
  return count;
}

function topologicalOrder(graph) {
  const neighbours = adjacency(graph);
  const degrees = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const edge of graph.edges) degrees.set(edge.target, degrees.get(edge.target) + 1);
  const queue = graph.nodes.filter(node => degrees.get(node.id) === 0).map(node => node.id);
  const result = [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    result.push(id);
    for (const target of neighbours.get(id)) {
      degrees.set(target, degrees.get(target) - 1);
      if (degrees.get(target) === 0) queue.push(target);
    }
  }
  return result.length === graph.nodes.length ? result : null;
}

/**
 * Analyse structurelle. matrix[i][j] = nombre d'arêtes order[i] → order[j].
 * cycles = composantes fortement connexes cycliques (pas tous les cycles simples).
 * density = proportion de paires dirigées distinctes reliées, hors boucles;
 * cette densité reste dans [0,1], même avec des arêtes parallèles.
 */
export function analyzeGraph(graph, start = graph.start) {
  assertGraph(graph);
  assertNode(graph, start);
  const order = graph.nodes.map(node => node.id);
  const positions = new Map(order.map((id, index) => [id, index]));
  const matrix = order.map(() => order.map(() => 0));
  const degrees = order.map(id => ({ id, inDegree: 0, outDegree: 0, totalDegree: 0 }));
  const distinctPairs = new Set();
  for (const edge of graph.edges) {
    const i = positions.get(edge.source);
    const j = positions.get(edge.target);
    matrix[i][j] += 1;
    degrees[i].outDegree += 1;
    degrees[j].inDegree += 1;
    if (i !== j) distinctPairs.add(`${i}:${j}`);
  }
  for (const degree of degrees) degree.totalDegree = degree.inDegree + degree.outDegree;
  const reachable = walk(graph, start, false);
  const reached = new Set(reachable);
  const unreachable = order.filter(id => !reached.has(id));
  const scc = components(graph);
  const cycles = scc.filter(component => component.length > 1 || matrix[positions.get(component[0])][positions.get(component[0])] > 0);
  return {
    stats: {
      nodes: order.length,
      edges: graph.edges.length,
      density: order.length > 1 ? distinctPairs.size / (order.length * (order.length - 1)) : 0,
      weakComponents: weakComponents(graph),
      stronglyConnectedComponents: scc.length,
      hasCycle: cycles.length > 0,
      terminalNodes: degrees.filter(degree => degree.outDegree === 0).length,
      reachable: reachable.length,
      unreachable: unreachable.length,
      maxInDegree: Math.max(...degrees.map(degree => degree.inDegree)),
      maxOutDegree: Math.max(...degrees.map(degree => degree.outDegree)),
    },
    reachable, unreachable, scc, cycles,
    topological: topologicalOrder(graph),
    matrix, order, labels: graph.nodes.map(node => node.title), degrees,
  };
}

/** Copie JSON détachée, préservant les métadonnées additionnelles sérialisables. */
export function cloneGraph(graph) { assertGraph(graph); return copy(graph); }

/** Supprime un nœud et toutes ses arêtes incidentes; réaffecte start si nécessaire. */
export function removeNode(graph, nodeId) {
  assertGraph(graph);
  assertNode(graph, nodeId);
  if (graph.nodes.length === 1) throw new Error('Impossible de supprimer le dernier nœud.');
  const next = copy(graph);
  next.nodes = next.nodes.filter(node => node.id !== nodeId);
  next.edges = next.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId);
  if (next.start === nodeId) next.start = next.nodes[0].id;
  return next;
}

/** Transpose le graphe; les conditions et effets sont conservés tels quels. */
export function reverseGraph(graph) {
  const next = cloneGraph(graph);
  next.edges = next.edges.map(edge => ({ ...edge, source: edge.target, target: edge.source }));
  return next;
}

/** Sous-graphe induit non vide; conserve l'ordre des nœuds et les arêtes internes. */
export function inducedSubgraph(graph, nodeIds) {
  assertGraph(graph);
  if (!Array.isArray(nodeIds) || !nodeIds.length) throw new Error('Choisir au moins un nœud pour le sous-graphe.');
  for (const id of nodeIds) assertNode(graph, id);
  const selected = new Set(nodeIds);
  const next = copy(graph);
  next.nodes = next.nodes.filter(node => selected.has(node.id));
  next.edges = next.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target));
  if (!selected.has(next.start)) next.start = next.nodes[0].id;
  return next;
}

export function addNode(graph, node) {
  const next = cloneGraph(graph);
  next.nodes.push(copy(node));
  assertGraph(next);
  return next;
}

export function addEdge(graph, edge) {
  const next = cloneGraph(graph);
  next.edges.push(copy(edge));
  assertGraph(next);
  return next;
}
