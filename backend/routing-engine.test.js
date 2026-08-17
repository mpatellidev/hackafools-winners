'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WastelandRouter } = require('./routing-engine');
const { randomizeSonars, haversineKm } = require('./sonar-randomizer');

const collection = (features = []) => ({ type: 'FeatureCollection', features });
const node = (id, coordinates, properties = {}) => ({
  type: 'Feature',
  properties: { id, name: id.toUpperCase(), ...properties },
  geometry: { type: 'Point', coordinates }
});
const edge = (id, source, target, distance, danger = 1, terrain = 'asphalt_ruins', coordinates) => ({
  type: 'Feature',
  properties: {
    id,
    source_node: source,
    target_node: target,
    distance_km: distance,
    danger_level: danger,
    terrain_type: terrain,
    description: `Trecho ${id}`
  },
  geometry: { type: 'LineString', coordinates }
});
const zone = (id, multiplier, threatLevel, coordinates, properties = {}) => ({
  type: 'Feature',
  properties: {
    id,
    name: id.toUpperCase(),
    danger_multiplier: multiplier,
    threat_level: threatLevel,
    zone_type: 'environmental_hazard',
    ...properties
  },
  geometry: { type: 'Polygon', coordinates: [coordinates] }
});

function routerWith(nodes, edges, zones = []) {
  const router = new WastelandRouter();
  router.loadFromGeojson(collection(nodes), collection(edges), collection(zones));
  return router;
}

function seededRandom(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

const baseNodes = [node('a', [0, 0]), node('b', [1, 0]), node('c', [2, 0]), node('d', [3, 0])];
const alternativeEdges = [
  edge('ab', 'a', 'b', 5, 5, 'minefield_pass', [[0, 0], [1, 0]]),
  edge('bd', 'b', 'd', 5, 5, 'minefield_pass', [[1, 0], [3, 0]]),
  edge('ac', 'a', 'c', 8, 1, 'safe_pass', [[0, 0], [2, 0]]),
  edge('cd', 'c', 'd', 8, 1, 'safe_pass', [[2, 0], [3, 0]])
];

// Rota direta, rota longa porém segura e alternativas reais.
{
  const router = routerWith(baseNodes, alternativeEdges);
  const fast = router.calculateRoute('a', 'd', 'fast');
  const safe = router.calculateRoute('a', 'd', 'safe');
  assert.deepStrictEqual(fast.pathNodes, ['a', 'b', 'd']);
  assert.strictEqual(fast.summary.distanceKm, 10);
  assert.deepStrictEqual(safe.pathNodes, ['a', 'c', 'd']);
  assert.strictEqual(safe.summary.distanceKm, 16);
  assert(safe.summary.survivalProbability > fast.summary.survivalProbability);
  const alternatives = router.calculateRoutes('a', 'd');
  assert(alternatives.routes.length >= 2);
  assert.strictEqual(alternatives.recommendedRouteId, 'safe');
  assert(alternatives.routes.every((route) => route.segments.length > 0));
}

// Rota simples/direta.
{
  const router = routerWith(baseNodes.slice(0, 2), [alternativeEdges[0]]);
  const result = router.calculateRoute('a', 'b', 'fast');
  assert.deepStrictEqual(result.pathNodes, ['a', 'b']);
  assert.strictEqual(result.segments.length, 1);
  assert.deepStrictEqual(router.calculateRoutes('a', 'b').routes.map((route) => route.id), ['safe', 'fast']);
}

// Origem/destino inválidos e origem igual ao destino.
{
  const router = routerWith(baseNodes.slice(0, 2), [alternativeEdges[0]]);
  assert.strictEqual(router.calculateRoute('missing', 'b').code, 'UNKNOWN_ORIGIN');
  assert.strictEqual(router.calculateRoute('a', 'missing').code, 'UNKNOWN_DESTINATION');
  assert.strictEqual(router.calculateRoute('a', 'a').code, 'SAME_LOCATION');
}

// Grafo desconectado.
{
  const router = routerWith([node('a', [0, 0]), node('b', [1, 0]), node('c', [4, 0])], [
    edge('ab', 'a', 'b', 2, 1, 'safe_pass', [[0, 0], [1, 0]])
  ]);
  assert.strictEqual(router.calculateRoute('a', 'c').code, 'NO_ROUTE');
}

// Regiões têm influência reduzida e exposição parcial não aplica penalidade integral.
{
  const router = routerWith(
    baseNodes.slice(0, 2),
    [edge('ab', 'a', 'b', 10, 2, 'packed_dirt', [[0, 0], [1, 0]])],
    [zone('half', 3, 'tier_2', [[0, -1], [0.5, -1], [0.5, 1], [0, 1], [0, -1]])]
  );
  const loadedEdge = router.adjacency.get('a')[0];
  assert(loadedEdge.zonePenalty > 1.24 && loadedEdge.zonePenalty < 1.26);
}

// Sonar domina o risco: a rota direta cruza o vermelho e a segura o contorna.
{
  const sonarNodes = [node('a', [0, 0]), node('b', [0.01, 0]), node('c', [0, 0.02]), node('d', [0.02, 0])];
  const sonarEdges = [
    edge('ab', 'a', 'b', 5, 1, 'safe_pass', [[0, 0], [0.01, 0]]),
    edge('bd', 'b', 'd', 5, 1, 'safe_pass', [[0.01, 0], [0.02, 0]]),
    edge('ac', 'a', 'c', 8, 1, 'safe_pass', [[0, 0], [0, 0.02]]),
    edge('cd', 'c', 'd', 8, 1, 'safe_pass', [[0, 0.02], [0.02, 0]])
  ];
  const redSonar = zone('red-sonar', 1, 'tier_3', [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]], {
    sonar_center: [0.01, 0], sonar_radius_km: 0.55
  });
  const router = routerWith(sonarNodes, sonarEdges, [redSonar]);
  const routes = router.calculateRoutes('a', 'd');
  const direct = routes.routes.find((route) => route.id === 'fast');
  const safe = routes.routes.find((route) => route.id === 'safe');
  assert.deepStrictEqual(direct.pathNodes, ['a', 'b', 'd']);
  assert.deepStrictEqual(safe.pathNodes, ['a', 'c', 'd']);
  assert(safe.summary.survivalProbability > direct.summary.survivalProbability);
  assert(direct.summary.highRiskSonars > 0);
  assert(direct.riskBreakdown.some((entry) => entry.title.includes('Sonar')));
}

// As três cores de sonar aplicam impacto crescente: verde < amarelo < vermelho.
{
  const routeNodes = [node('a', [0, 0]), node('b', [0.01, 0])];
  const routeEdges = [edge('ab', 'a', 'b', 10, 1, 'safe_pass', [[0, 0], [0.01, 0]])];
  const polygon = [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]];
  const survival = (tier) => routerWith(routeNodes, routeEdges, [
    zone(`sonar-${tier}`, 1, tier, polygon, { sonar_center: [0.005, 0], sonar_radius_km: 2 })
  ]).calculateRoute('a', 'b', 'direct').summary.survivalProbability;
  assert(survival('tier_1') > survival('tier_2'));
  assert(survival('tier_2') > survival('tier_3'));
}

// Zona crítica entra no resumo e no detalhamento de risco.
{
  const router = routerWith(
    baseNodes.slice(0, 2),
    [edge('ab', 'a', 'b', 10, 3, 'packed_dirt', [[0, 0], [1, 0]])],
    [zone('critical', 2.7, 'tier_3', [[-0.1, -1], [1.1, -1], [1.1, 1], [-0.1, 1], [-0.1, -1]])]
  );
  const result = router.calculateRoute('a', 'b');
  assert.strictEqual(result.summary.criticalZones, 1);
  assert(result.riskBreakdown.some((entry) => entry.title === 'CRITICAL'));
  assert.strictEqual(result.segments[0].zones[0].threatLevel, 'tier_3');
}

// Abrigo comunitário influencia a rota segura e aparece como ponto de apoio.
{
  const router = routerWith(
    [node('a', [0, 0]), node('b', [0.1, 0])],
    [edge('ab', 'a', 'b', 12, 3, 'packed_dirt', [[0, 0], [0.1, 0]])]
  );
  const added = router.addCommunityNode({ label: 'Abrigo', category: 'seguro', lon: 0.05, lat: 0 });
  const result = router.calculateRoute('a', 'b', 'safe');
  assert(result.pathNodes.includes(added.id));
  assert(result.summary.supportPoints >= 1);
  assert(result.riskBreakdown.some((entry) => entry.kind === 'safety'));
}

// Zona de perigo comunitária cria um sonar, sem criar um novo polígono territorial.
{
  const router = routerWith(
    [node('a', [0, 0]), node('b', [0.02, 0])],
    [edge('ab', 'a', 'b', 10, 1, 'safe_pass', [[0, 0], [0.02, 0]])]
  );
  const survivalBefore = router.calculateRoute('a', 'b', 'safe').summary.survivalProbability;
  const added = router.addDangerSonar({
    name: 'Sonar hostil', threatLevel: 'tier_3', description: 'Sinal comunitário.',
    center: [0.01, 0], radiusKm: 2
  });
  const route = router.calculateRoute('a', 'b', 'safe');
  assert.strictEqual(added.sonarFeature.geometry.type, 'Point');
  assert.strictEqual(added.sonarFeature.properties.sonar_only, true);
  assert.strictEqual(route.summary.sonarsCrossed, 1);
  assert(route.summary.survivalProbability < survivalBefore);
}

// Empate de custo continua retornando uma rota válida e determinística.
{
  const router = routerWith(baseNodes, [
    edge('ab', 'a', 'b', 2, 1, 'safe_pass', [[0, 0], [1, 0]]),
    edge('bd', 'b', 'd', 2, 1, 'safe_pass', [[1, 0], [3, 0]]),
    edge('ac', 'a', 'c', 2, 1, 'safe_pass', [[0, 0], [2, 0]]),
    edge('cd', 'c', 'd', 2, 1, 'safe_pass', [[2, 0], [3, 0]])
  ]);
  assert.deepStrictEqual(router.calculateRoute('a', 'd', 'fast').pathNodes, ['a', 'b', 'd']);
}

// GeoJSON inválido falha cedo, sem deixar o motor em estado parcialmente carregado.
{
  const router = new WastelandRouter();
  assert.throws(() => router.loadFromGeojson({}, collection(), collection()), /GeoJSON inválido/);
  assert.throws(() => router.loadFromGeojson(collection([node('a', [0, 0])]), collection([
    edge('broken', 'a', 'missing', 1, 1, 'safe_pass', [[0, 0], [1, 0]])
  ]), collection()), /nó inexistente/);
}

// Cada inicialização desloca, redimensiona e troca a cor dos sonares sem amontoá-los.
{
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'zones.geojson'), 'utf8'));
  const randomized = randomizeSonars(original, seededRandom(20260817));
  assert.notDeepStrictEqual(randomized, original);
  const colors = new Set();
  randomized.features.forEach((feature, index) => {
    const before = original.features[index].properties;
    const after = feature.properties;
    colors.add(after.sonar_threat_level);
    assert.notDeepStrictEqual(after.sonar_center, before.sonar_center);
    assert.notStrictEqual(after.sonar_radius_km, before.sonar_radius_km);
    assert.notStrictEqual(after.sonar_threat_level, before.threat_level);
  });
  assert.deepStrictEqual([...colors].sort(), ['tier_1', 'tier_2', 'tier_3']);
  for (let left = 0; left < randomized.features.length; left += 1) {
    for (let right = left + 1; right < randomized.features.length; right += 1) {
      const first = randomized.features[left].properties;
      const second = randomized.features[right].properties;
      const minimum = Math.max(10, (first.sonar_radius_km + second.sonar_radius_km) * .82);
      assert(haversineKm(first.sonar_center, second.sonar_center) >= minimum - .01);
    }
  }
}

// Dataset real permanece carregável e produz resumo coerente.
{
  const data = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name), 'utf8'));
  const router = new WastelandRouter();
  router.loadFromGeojson(data('nodes.geojson'), data('edges.geojson'), data('zones.geojson'));
  const result = router.calculateRoutes('node_canyon_hideout', 'node_dead_pass');
  assert(result.routes.length >= 2);
  result.routes.forEach((route) => {
    assert(Number.isInteger(route.summary.survivalProbability));
    assert(route.summary.survivalProbability >= 0 && route.summary.survivalProbability <= 100);
  });
  const canyonShortcut = router.calculateRoutes('node_zone_canyon_killpeaks_anchor', 'node_boneyard_iron_widow');
  canyonShortcut.routes.forEach((route) => {
    assert.deepStrictEqual(route.pathNodes, ['node_zone_canyon_killpeaks_anchor', 'node_boneyard_iron_widow']);
  });
  const addedNodes = [
    'node_western_observatory', 'node_meridian_wind_station', 'node_drywell_frontier',
    'node_cold_ash_exchange', 'node_frozen_plain_beacon'
  ];
  addedNodes.forEach((id) => assert(router.adjacency.get(id).length >= 2));
  assert(!router.calculateRoutes('node_western_observatory', 'node_frozen_plain_beacon').error);
}

console.log('routing-engine tests passed (14 scenarios)');
