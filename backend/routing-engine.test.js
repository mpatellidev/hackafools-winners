'use strict';

const assert = require('assert');
const { WastelandRouter } = require('./routing-engine');

const nodes = (['a', 'b', 'c', 'd']).map((id, index) => ({
  type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [index, 0] }
}));

const edge = (id, source, target, distance, danger, terrain, coordinates) => ({
  type: 'Feature',
  properties: { id, source_node: source, target_node: target, distance_km: distance, danger_level: danger, terrain_type: terrain },
  geometry: { type: 'LineString', coordinates }
});

// O caminho a-b-d é menor, porém deliberadamente perigoso. O caminho a-c-d
// só pode vencer no modo sobrevivência se a probabilidade for o objetivo real.
const edges = [
  edge('ab', 'a', 'b', 5, 5, 'minefield_pass', [[0, 0], [1, 0]]),
  edge('bd', 'b', 'd', 5, 5, 'minefield_pass', [[1, 0], [3, 0]]),
  edge('ac', 'a', 'c', 8, 1, 'safe_pass', [[0, 0], [2, 0]]),
  edge('cd', 'c', 'd', 8, 1, 'safe_pass', [[2, 0], [3, 0]])
];

const router = new WastelandRouter();
router.loadFromGeojson({ type: 'FeatureCollection', features: nodes }, { type: 'FeatureCollection', features: edges }, {
  type: 'FeatureCollection', features: []
});

const direct = router.calculateRoute('a', 'd', 'direct').properties;
const survival = router.calculateRoute('a', 'd', 'survival').properties;

assert.deepStrictEqual(direct.path_nodes, ['a', 'b', 'd']);
assert.strictEqual(direct.total_distance_km, 10);
assert.deepStrictEqual(survival.path_nodes, ['a', 'c', 'd']);
assert.strictEqual(survival.total_distance_km, 16);
assert(survival.survival_probability > 80);

// Uma zona que cobre apenas metade do trecho não pode aplicar risco integral.
const halfZoneRouter = new WastelandRouter();
halfZoneRouter.loadFromGeojson(
  { type: 'FeatureCollection', features: nodes.slice(0, 2) },
  { type: 'FeatureCollection', features: [edge('ab', 'a', 'b', 10, 2, 'packed_dirt', [[0, 0], [1, 0]])] },
  { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { danger_multiplier: 3 }, geometry: { type: 'Polygon', coordinates: [[[0, -1], [0.5, -1], [0.5, 1], [0, 1], [0, -1]]] } }] }
);
assert(halfZoneRouter.adjacency.get('a')[0].zonePenalty > 1.9);
assert(halfZoneRouter.adjacency.get('a')[0].zonePenalty < 2.1);

console.log('routing-engine tests passed');
