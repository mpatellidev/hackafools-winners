'use strict';

const TERRAIN_MOVEMENT_MULTIPLIERS = {
  asphalt_ruins: 1, highway_ruins: 1.08, corporate_highway: 0.9, safe_pass: 0.95,
  packed_dirt: 1.15, dirt_track: 1.25, canyon_trail: 1.3, canyon_trench: 1.22,
  sheltered_canyon: 1.18, sheltered_valley: 1.08, transition_plains: 1.2,
  high_relief_pass: 1.55, storm_plains: 1.55, black_ice_highway: 1.7,
  scorched_dunes: 1.65, sand_dunes: 1.75, shockwave_boundary: 1.9,
  minefield_pass: 2.1, radioactive_crater: 2.4
};

const TERRAIN_RISK_MULTIPLIERS = {
  safe_pass: 0.65, corporate_highway: 0.85, sheltered_valley: 0.8,
  sheltered_canyon: 0.85, asphalt_ruins: 1, highway_ruins: 1.05,
  canyon_trail: 1.05, canyon_trench: 1.15, packed_dirt: 1.2, dirt_track: 1.25,
  transition_plains: 1.3, high_relief_pass: 1.75, storm_plains: 1.8,
  black_ice_highway: 2.05, scorched_dunes: 2.15, sand_dunes: 2.2,
  shockwave_boundary: 2.5, minefield_pass: 2.8, radioactive_crater: 3.1
};

const BASE_HAZARD_PER_KM = 0.0015;
const DANGER_HAZARD_PER_KM = 0.0045;
const ZONE_RISK_INFLUENCE = 0.25;
const SONAR_HAZARD_PER_KM = { tier_1: 0.006, tier_2: 0.020, tier_3: 0.050 };
const SONAR_RISK_LABELS = { tier_1: 'BAIXO', tier_2: 'MODERADO', tier_3: 'ALTO' };
const PROFILE_META = {
  safe: { label: 'MAIOR SOBREVIVÊNCIA', description: 'Contorna sonares e reduz a exposição às zonas.' },
  balanced: { label: 'ROTA EQUILIBRADA', description: 'Compromisso entre distância e exposição.' },
  fast: { label: 'ROTA DIRETA', description: 'Menor distância, ignorando riscos durante o traçado.' }
};

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
function round(value, precision = 0) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const radius = 6371;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function lineLengthKm(coordinates) {
  let distance = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    distance += haversineKm(coordinates[index], coordinates[index + 1]);
  }
  return distance;
}

function pointInPolygon([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(point, rings) {
  if (!rings.length || !pointInPolygon(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInPolygon(point, hole));
}

function segmentIntersectionParameter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12) return null;
  const offset = [c[0] - a[0], c[1] - a[1]];
  const t = cross(offset, s) / denominator;
  const u = cross(offset, r) / denominator;
  if (t < -1e-10 || t > 1 + 1e-10 || u < -1e-10 || u > 1 + 1e-10) return null;
  return clamp(t, 0, 1);
}

function lineExposureFraction(lineCoordinates, polygonRings) {
  let total = 0;
  let exposed = 0;
  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    const startPoint = lineCoordinates[index];
    const endPoint = lineCoordinates[index + 1];
    const length = haversineKm(startPoint, endPoint);
    if (!length) continue;
    const cuts = [0, 1];
    polygonRings.forEach((ring) => {
      for (let ringIndex = 0; ringIndex < ring.length - 1; ringIndex += 1) {
        const cut = segmentIntersectionParameter(startPoint, endPoint, ring[ringIndex], ring[ringIndex + 1]);
        if (cut != null) cuts.push(cut);
      }
    });
    cuts.sort((a, b) => a - b);
    const uniqueCuts = cuts.filter((value, cutIndex) => cutIndex === 0 || Math.abs(value - cuts[cutIndex - 1]) > 1e-9);
    total += length;
    for (let cutIndex = 0; cutIndex < uniqueCuts.length - 1; cutIndex += 1) {
      const start = uniqueCuts[cutIndex];
      const end = uniqueCuts[cutIndex + 1];
      const midpoint = (start + end) / 2;
      const point = [
        startPoint[0] + (endPoint[0] - startPoint[0]) * midpoint,
        startPoint[1] + (endPoint[1] - startPoint[1]) * midpoint
      ];
      if (pointInPolygonRings(point, polygonRings)) exposed += length * (end - start);
    }
  }
  return total ? exposed / total : 0;
}

function lineCircleExposureFraction(lineCoordinates, center, radiusKm) {
  let total = 0;
  let exposed = 0;
  const latitudeScale = 111.32;
  const longitudeScale = 111.32 * Math.cos(center[1] * Math.PI / 180);
  const localPoint = ([lon, lat]) => [(lon - center[0]) * longitudeScale, (lat - center[1]) * latitudeScale];
  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    const startGeo = lineCoordinates[index];
    const endGeo = lineCoordinates[index + 1];
    const length = haversineKm(startGeo, endGeo);
    if (!length) continue;
    total += length;
    const start = localPoint(startGeo);
    const end = localPoint(endGeo);
    const delta = [end[0] - start[0], end[1] - start[1]];
    const a = delta[0] ** 2 + delta[1] ** 2;
    const b = 2 * (start[0] * delta[0] + start[1] * delta[1]);
    const c = start[0] ** 2 + start[1] ** 2 - radiusKm ** 2;
    const cuts = [0, 1];
    const discriminant = b ** 2 - 4 * a * c;
    if (a > 0 && discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const first = (-b - root) / (2 * a);
      const second = (-b + root) / (2 * a);
      if (first > 0 && first < 1) cuts.push(first);
      if (second > 0 && second < 1) cuts.push(second);
    }
    cuts.sort((left, right) => left - right);
    for (let cut = 0; cut < cuts.length - 1; cut += 1) {
      const from = cuts[cut];
      const to = cuts[cut + 1];
      const midpoint = (from + to) / 2;
      const x = start[0] + delta[0] * midpoint;
      const y = start[1] + delta[1] * midpoint;
      if (x ** 2 + y ** 2 <= radiusKm ** 2) exposed += length * (to - from);
    }
  }
  return total ? exposed / total : 0;
}

function edgeZoneImpacts(coordinates, zones) {
  return zones.map((zone) => {
    const exposure = lineExposureFraction(coordinates, zone.rings);
    if (!exposure) return null;
    const dangerMultiplier = Number(zone.properties.danger_multiplier ?? zone.properties.penalty_multiplier ?? 1);
    return {
      id: zone.properties.id || zone.properties.name,
      name: zone.properties.name || 'Zona sem identificação',
      description: zone.properties.description || '',
      threatLevel: zone.properties.threat_level || 'tier_2',
      zoneType: zone.properties.zone_type || 'environmental_hazard',
      dangerMultiplier,
      exposure: round(exposure, 4)
    };
  }).filter(Boolean);
}

function zoneRiskMultiplier(impacts) {
  return impacts.reduce((multiplier, impact) => (
    multiplier * (1 + Math.max(0, impact.dangerMultiplier - 1) * impact.exposure * ZONE_RISK_INFLUENCE)
  ), 1);
}

function edgeSonarImpacts(coordinates, zones) {
  return zones.map((zone) => {
    const center = zone.properties.sonar_center;
    const radiusKm = Number(zone.properties.sonar_radius_km || 0);
    if (!Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite) || radiusKm <= 0) return null;
    const exposure = lineCircleExposureFraction(coordinates, center, radiusKm);
    if (!exposure) return null;
    const threatLevel = zone.properties.sonar_threat_level || zone.properties.threat_level || 'tier_2';
    return {
      id: `sonar-${zone.properties.id || zone.properties.name}`,
      zoneId: zone.properties.id || zone.properties.name,
      name: `Sonar · ${zone.properties.name || 'área não identificada'}`,
      threatLevel,
      riskLabel: SONAR_RISK_LABELS[threatLevel] || 'MODERADO',
      radiusKm,
      hazardPerKm: SONAR_HAZARD_PER_KM[threatLevel] || SONAR_HAZARD_PER_KM.tier_2,
      exposure: round(exposure, 4)
    };
  }).filter(Boolean);
}

function terrainLabel(type) { return String(type || 'trecho desconhecido').replaceAll('_', ' '); }
function riskLevelFromProbability(probability) {
  if (probability >= 85) return { id: 'low', label: 'RISCO BAIXO' };
  if (probability >= 68) return { id: 'moderate', label: 'RISCO MODERADO' };
  if (probability >= 48) return { id: 'high', label: 'RISCO ALTO' };
  return { id: 'critical', label: 'RISCO CRÍTICO' };
}
function exposureLabel(averageDanger) {
  if (averageDanger < 1.7) return 'BAIXA';
  if (averageDanger < 3.2) return 'MÉDIA';
  if (averageDanger < 4.3) return 'ALTA';
  return 'SEVERA';
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].dist <= this.items[index].dist) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = index * 2 + 2;
        let smallest = index;
        if (left < this.items.length && this.items[left].dist < this.items[smallest].dist) smallest = left;
        if (right < this.items.length && this.items[right].dist < this.items[smallest].dist) smallest = right;
        if (smallest === index) break;
        [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

class WastelandRouter {
  constructor() { this.reset(); }
  reset() {
    this.nodesData = new Map();
    this.dangerZones = [];
    this.adjacency = new Map();
    this.communityNodeFeatures = [];
    this.communityEdgeFeatures = [];
    this.communityZoneFeatures = [];
    this.nextCommunityId = 1;
    this.nextCommunityZoneId = 1;
  }

  loadFromGeojson(nodesGeojson, edgesGeojson, zonesGeojson = { features: [] }) {
    if (!Array.isArray(nodesGeojson?.features) || !Array.isArray(edgesGeojson?.features) || !Array.isArray(zonesGeojson?.features)) {
      throw new Error('GeoJSON inválido: nodes, edges e zones devem ser FeatureCollections.');
    }
    this.reset();
    this.dangerZones = zonesGeojson.features.map((feature) => {
      if (feature.geometry?.type !== 'Polygon' || !Array.isArray(feature.geometry.coordinates?.[0])) {
        throw new Error(`Zona inválida: ${feature.properties?.id || 'sem id'}.`);
      }
      return { rings: feature.geometry.coordinates, properties: feature.properties || {} };
    });
    nodesGeojson.features.forEach((feature) => {
      const properties = feature.properties || {};
      const id = feature.id ?? properties.id;
      const coordinates = feature.geometry?.coordinates;
      if (!id || feature.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) {
        throw new Error(`Nó inválido: ${id || 'sem id'}.`);
      }
      if (this.nodesData.has(id)) throw new Error(`Nó duplicado: ${id}.`);
      this.nodesData.set(id, { ...properties, id, coords: coordinates });
      this.adjacency.set(id, []);
    });
    edgesGeojson.features.forEach((feature) => this.addEdgeFeature(feature));
  }

  supportRate(sourceId, targetId) {
    let rate = 0;
    [sourceId, targetId].map((id) => this.nodesData.get(id)).filter(Boolean).forEach((node) => {
      if (node.community && node.type === 'seguro') rate += 0.12;
      else if (node.resources && (Number(node.resources.water) >= 70 || Number(node.resources.thermal_stability) >= 80)) rate += 0.025;
    });
    return clamp(rate, 0, 0.18);
  }

  edgeAttributes(feature) {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error(`Aresta inválida: ${properties.id || feature.id || 'sem id'}.`);
    }
    const source = properties.source_node;
    const target = properties.target_node;
    if (!this.adjacency.has(source) || !this.adjacency.has(target)) {
      throw new Error(`Aresta ${properties.id || feature.id || 'sem id'} referencia nó inexistente.`);
    }
    const distanceKm = Number(properties.distance_km ?? properties.base_distance_km ?? lineLengthKm(coordinates));
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) throw new Error(`Distância inválida na aresta ${properties.id || feature.id || 'sem id'}.`);
    const dangerLevel = clamp(Number(properties.danger_level ?? 0), 0, 5);
    const terrainType = properties.terrain_type || 'asphalt_ruins';
    const terrainRisk = TERRAIN_RISK_MULTIPLIERS[terrainType] ?? 1;
    const movementMultiplier = TERRAIN_MOVEMENT_MULTIPLIERS[terrainType] ?? 1.25;
    const zoneImpacts = edgeZoneImpacts(coordinates, this.dangerZones);
    const zonePenalty = zoneRiskMultiplier(zoneImpacts);
    const sonarImpacts = edgeSonarImpacts(coordinates, this.dangerZones);
    const sonarHazard = distanceKm * sonarImpacts.reduce((sum, impact) => sum + impact.hazardPerKm * impact.exposure, 0);
    const rawHazard = distanceKm * (BASE_HAZARD_PER_KM + dangerLevel * DANGER_HAZARD_PER_KM) * terrainRisk * zonePenalty + sonarHazard;
    const safetyRate = this.supportRate(source, target);
    const survivalWeight = Math.max(0.000001, rawHazard * (1 - safetyRate));
    const sonarPenalty = sonarImpacts.reduce((penalty, impact) => (
      penalty + impact.exposure * ({ tier_1: 0.35, tier_2: 1.15, tier_3: 2.8 }[impact.threatLevel] || 1.15)
    ), 0);
    const balancedWeight = distanceKm * Math.max(0.6,
      1 + dangerLevel * 0.12 + Math.max(0, terrainRisk - 1) * 0.22 +
      Math.max(0, zonePenalty - 1) * 0.20 + sonarPenalty - safetyRate
    );
    return {
      edgeId: feature.id || properties.id || `${source}_${target}`,
      source, target, distanceKm, dangerLevel, terrainType,
      description: properties.description || '',
      fuelMultiplier: Number(properties.fuel_cost_multiplier ?? movementMultiplier),
      movementMultiplier, terrainRisk, zoneImpacts, zonePenalty,
      sonarImpacts, sonarHazard, sonarPenalty, safetyRate,
      directWeight: distanceKm, balancedWeight, survivalWeight,
      geometry: coordinates, oneWay: properties.one_way === true
    };
  }

  addEdgeFeature(feature, { community = false } = {}) {
    const attributes = this.edgeAttributes(feature);
    this.adjacency.get(attributes.source).push({ ...attributes, to: attributes.target });
    if (!attributes.oneWay) {
      this.adjacency.get(attributes.target).push({ ...attributes, to: attributes.source, geometry: [...attributes.geometry].reverse() });
    }
    if (community) this.communityEdgeFeatures.push(feature);
    return attributes;
  }

  addCommunityNode({ id, label, category, lon, lat }) {
    let finalId = id;
    if (!finalId) finalId = `community_${this.nextCommunityId++}`;
    else {
      const numericId = Number.parseInt(String(id).replace('community_', ''), 10);
      if (Number.isFinite(numericId)) this.nextCommunityId = Math.max(this.nextCommunityId, numericId + 1);
    }
    const coordinates = [lon, lat];
    const candidates = [...this.nodesData.entries()]
      .map(([nodeId, node]) => ({ nodeId, distance: haversineKm(coordinates, node.coords) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.min(2, this.nodesData.size));
    const nodeFeature = {
      type: 'Feature',
      properties: {
        id: finalId, name: label, type: category,
        danger_level: category === 'seguro' ? 0 : 1,
        description: 'Ponto verificado e compartilhado pela comunidade.', community: true
      },
      geometry: { type: 'Point', coordinates }
    };
    this.nodesData.set(finalId, { ...nodeFeature.properties, coords: coordinates });
    this.adjacency.set(finalId, []);
    this.communityNodeFeatures.push(nodeFeature);
    const edgeFeatures = candidates.map(({ nodeId, distance }, index) => ({
      type: 'Feature',
      properties: {
        id: `edge_${finalId}_${index + 1}`, source_node: finalId, target_node: nodeId,
        distance_km: round(distance, 2), danger_level: category === 'seguro' ? 0 : 1,
        terrain_type: 'safe_pass', fuel_cost_multiplier: 1,
        description: 'Ligação comunitária ao corredor conhecido mais próximo.'
      },
      geometry: { type: 'LineString', coordinates: [coordinates, this.nodesData.get(nodeId).coords] }
    }));
    edgeFeatures.forEach((edgeFeature) => this.addEdgeFeature(edgeFeature, { community: true }));
    return { id: finalId, nodeFeature, edgeFeatures };
  }

  addDangerZone({ id, name, biomeFocus, zoneType, threatLevel, dangerMultiplier, stealthPenalty, description, rings }) {
    let finalId = id;
    if (!finalId) finalId = `community_zone_${this.nextCommunityZoneId++}`;
    else {
      const numericId = Number.parseInt(String(id).replace('community_zone_', ''), 10);
      if (Number.isFinite(numericId)) this.nextCommunityZoneId = Math.max(this.nextCommunityZoneId, numericId + 1);
    }
    const properties = {
      id: finalId, name, biome_focus: biomeFocus || 'scorched_desert', zone_type: zoneType,
      threat_level: threatLevel, danger_multiplier: dangerMultiplier,
      stealth_penalty: stealthPenalty, description, community: true
    };
    this.dangerZones.push({ rings, properties });
    this.recalculateEdgeWeights();
    const zoneFeature = { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: rings } };
    this.communityZoneFeatures.push(zoneFeature);
    return { id: finalId, zoneFeature };
  }

  addDangerSonar({ id, name, threatLevel, description, center, radiusKm }) {
    let finalId = id;
    if (!finalId) finalId = `community_sonar_${this.nextCommunityZoneId++}`;
    else {
      const numericId = Number.parseInt(String(id).replace(/\D+/g, ''), 10);
      if (Number.isFinite(numericId)) this.nextCommunityZoneId = Math.max(this.nextCommunityZoneId, numericId + 1);
    }
    const properties = {
      id: finalId,
      name,
      biome_focus: 'neutral',
      zone_type: 'community_sonar',
      threat_level: threatLevel,
      sonar_threat_level: threatLevel,
      sonar_center: center,
      sonar_radius_km: radiusKm,
      danger_multiplier: 1,
      stealth_penalty: 0,
      description,
      community: true,
      sonar_only: true
    };
    this.dangerZones.push({ rings: [], properties });
    this.recalculateEdgeWeights();
    const sonarFeature = { type: 'Feature', properties, geometry: { type: 'Point', coordinates: center } };
    this.communityZoneFeatures.push(sonarFeature);
    return { id: finalId, sonarFeature };
  }

  recalculateEdgeWeights() {
    for (const [nodeId, edges] of this.adjacency.entries()) {
      for (let index = 0; index < edges.length; index += 1) {
        const edge = edges[index];
        const feature = {
          type: 'Feature',
          properties: {
            id: edge.edgeId, source_node: nodeId, target_node: edge.to,
            distance_km: edge.distanceKm, danger_level: edge.dangerLevel,
            terrain_type: edge.terrainType, fuel_cost_multiplier: edge.fuelMultiplier,
            description: edge.description, one_way: true
          },
          geometry: { type: 'LineString', coordinates: edge.geometry }
        };
        edges[index] = { ...this.edgeAttributes(feature), to: edge.to };
      }
    }
  }

  shortestPath(originId, destinationId, profile) {
    const weightKey = profile === 'safe' ? 'survivalWeight' : profile === 'balanced' ? 'balancedWeight' : 'directWeight';
    const distances = new Map([...this.adjacency.keys()].map((id) => [id, Infinity]));
    const previous = new Map();
    const settled = new Set();
    const heap = new MinHeap();
    distances.set(originId, 0);
    heap.push({ id: originId, dist: 0 });
    while (heap.size) {
      const current = heap.pop();
      if (settled.has(current.id)) continue;
      settled.add(current.id);
      if (current.id === destinationId) break;
      this.adjacency.get(current.id).forEach((edge) => {
        if (settled.has(edge.to)) return;
        const candidate = current.dist + edge[weightKey];
        if (candidate < distances.get(edge.to)) {
          distances.set(edge.to, candidate);
          previous.set(edge.to, { from: current.id, edge });
          heap.push({ id: edge.to, dist: candidate });
        }
      });
    }
    if (!Number.isFinite(distances.get(destinationId))) return null;
    const pathNodes = [destinationId];
    const pathEdges = [];
    let currentId = destinationId;
    while (currentId !== originId) {
      const step = previous.get(currentId);
      if (!step) return null;
      pathEdges.unshift(step.edge);
      pathNodes.unshift(step.from);
      currentId = step.from;
    }
    return { pathNodes, pathEdges };
  }

  buildRiskBreakdown(pathEdges, supportPoints) {
    const entries = [];
    const seenZones = new Set();
    const seenSonars = new Set();
    pathEdges.forEach((edge) => {
      edge.sonarImpacts.forEach((impact) => {
        if (seenSonars.has(impact.id)) return;
        seenSonars.add(impact.id);
        entries.push({
          kind: 'risk',
          points: Math.max(4, Math.round(impact.hazardPerKm * impact.exposure * edge.distanceKm * 100)),
          title: impact.name,
          detail: `${impact.riskLabel} · ${Math.round(impact.exposure * 100)}% do trecho dentro do raio`
        });
      });
      edge.zoneImpacts.forEach((impact) => {
        if (seenZones.has(impact.id)) return;
        seenZones.add(impact.id);
        entries.push({
          kind: 'risk', points: Math.max(2, Math.round((impact.dangerMultiplier - 1) * impact.exposure * 22)),
          title: impact.name, detail: `${Math.round(impact.exposure * 100)}% do trecho dentro da zona`
        });
      });
      if (edge.dangerLevel >= 4) {
        entries.push({
          kind: 'risk', points: Math.max(2, Math.round(edge.distanceKm * edge.dangerLevel / 5)),
          title: edge.description || `Travessia em ${terrainLabel(edge.terrainType)}`,
          detail: `Perigo ${edge.dangerLevel}/5 · exposição ${terrainLabel(edge.terrainType)}`
        });
      }
    });
    if (supportPoints.length) {
      entries.push({
        kind: 'safety', points: Math.min(12, supportPoints.length * 4), title: 'Pontos de apoio no corredor',
        detail: supportPoints.slice(0, 3).map((node) => node.name || node.id).join(' · ')
      });
    }
    if (!entries.length) entries.push({ kind: 'info', points: 0, title: 'Corredor sem alertas severos', detail: 'Dados locais indicam exposição controlada.' });
    return entries.sort((a, b) => (b.kind === 'risk' ? b.points : -b.points) - (a.kind === 'risk' ? a.points : -a.points)).slice(0, 6);
  }

  formatRoute(profile, pathNodes, pathEdges) {
    let totalDistance = 0;
    let totalHazard = 0;
    let totalMinutes = 0;
    let totalFuel = 0;
    let weightedDanger = 0;
    let routeCoordinates = [];
    const uniqueZones = new Map();
    const uniqueSonars = new Map();
    const segments = pathEdges.map((edge, index) => {
      totalDistance += edge.distanceKm;
      totalHazard += edge.survivalWeight;
      const minutes = edge.distanceKm / 30 * 60 * edge.movementMultiplier;
      const fuel = edge.distanceKm * 0.42 * edge.fuelMultiplier;
      totalMinutes += minutes;
      totalFuel += fuel;
      weightedDanger += edge.dangerLevel * edge.distanceKm;
      edge.zoneImpacts.forEach((impact) => uniqueZones.set(impact.id, impact));
      edge.sonarImpacts.forEach((impact) => uniqueSonars.set(impact.id, impact));
      routeCoordinates = routeCoordinates.length ? routeCoordinates.concat(edge.geometry.slice(1)) : [...edge.geometry];
      const segmentProbability = Math.exp(-edge.survivalWeight) * 100;
      const risk = riskLevelFromProbability(segmentProbability);
      return {
        id: edge.edgeId, from: pathNodes[index], to: pathNodes[index + 1],
        distanceKm: round(edge.distanceKm, 2), timeMinutes: Math.max(1, Math.round(minutes)),
        dangerLevel: edge.dangerLevel, terrainType: edge.terrainType, terrainLabel: terrainLabel(edge.terrainType),
        riskLevel: risk.id, riskLabel: risk.label, survivalProbability: Math.round(segmentProbability),
        safetyBonusPercent: Math.round(edge.safetyRate * 100), description: edge.description,
        zones: edge.zoneImpacts, sonars: edge.sonarImpacts,
        geometry: { type: 'LineString', coordinates: edge.geometry }
      };
    });
    const survivalProbability = Math.round(Math.exp(-totalHazard) * 100);
    const risk = riskLevelFromProbability(survivalProbability);
    const supportPoints = pathNodes.map((id) => this.nodesData.get(id)).filter((node) => (
      node && (node.type === 'seguro' || Number(node.resources?.water) >= 70 || Number(node.resources?.thermal_stability) >= 80)
    ));
    const zones = [...uniqueZones.values()];
    const sonars = [...uniqueSonars.values()];
    const averageDanger = totalDistance ? weightedDanger / totalDistance : 0;
    return {
      id: profile, label: PROFILE_META[profile].label, description: PROFILE_META[profile].description,
      summary: {
        distanceKm: round(totalDistance, 1), timeMinutes: Math.round(totalMinutes), fuelLiters: round(totalFuel, 1),
        survivalProbability, riskLevel: risk.id, riskLabel: risk.label, exposure: exposureLabel(averageDanger),
        criticalZones: zones.filter((zone) => zone.threatLevel === 'tier_3').length,
        hostileZones: zones.filter((zone) => zone.zoneType === 'faction_hostile').length,
        sonarsCrossed: sonars.length,
        highRiskSonars: sonars.filter((sonar) => sonar.threatLevel === 'tier_3').length,
        supportPoints: supportPoints.length
      },
      riskBreakdown: this.buildRiskBreakdown(pathEdges, supportPoints), pathNodes, segments,
      geometry: { type: 'LineString', coordinates: routeCoordinates },
      properties: {
        navigation_mode: profile, path_nodes: pathNodes, total_distance_km: round(totalDistance, 2),
        total_danger_score: round(totalHazard * 10, 1), estimated_fuel_liters: round(totalFuel, 1),
        estimated_time_minutes: Math.round(totalMinutes), survival_probability: survivalProbability,
        survival_hazard_score: round(totalHazard, 4), risk_level: risk.id, risk_label: risk.label
      }
    };
  }

  validateEndpoints(originId, destinationId) {
    if (!this.adjacency.has(originId)) return { error: `Localização de origem desconhecida: ${originId}`, code: 'UNKNOWN_ORIGIN' };
    if (!this.adjacency.has(destinationId)) return { error: `Localização de destino desconhecida: ${destinationId}`, code: 'UNKNOWN_DESTINATION' };
    if (originId === destinationId) return { error: 'Origem e destino precisam ser locais diferentes.', code: 'SAME_LOCATION' };
    return null;
  }

  calculateRoute(originId, destinationId, mode = 'safe') {
    const validationError = this.validateEndpoints(originId, destinationId);
    if (validationError) return validationError;
    const profile = mode === 'survival' ? 'safe' : mode === 'direct' ? 'fast' : mode;
    const selectedProfile = PROFILE_META[profile] ? profile : 'safe';
    const result = this.shortestPath(originId, destinationId, selectedProfile);
    if (!result) return { error: 'Nenhum corredor conhecido conecta estes dois setores.', code: 'NO_ROUTE' };
    return this.formatRoute(selectedProfile, result.pathNodes, result.pathEdges);
  }

  calculateRoutes(originId, destinationId) {
    const validationError = this.validateEndpoints(originId, destinationId);
    if (validationError) return validationError;
    const routes = [];
    ['safe', 'fast'].forEach((profile) => {
      const result = this.shortestPath(originId, destinationId, profile);
      if (!result) return;
      routes.push(this.formatRoute(profile, result.pathNodes, result.pathEdges));
    });
    if (!routes.length) return { error: 'Nenhum corredor conhecido conecta estes dois setores.', code: 'NO_ROUTE' };
    return { routes, recommendedRouteId: routes[0].id };
  }
}

module.exports = {
  WastelandRouter,
  TERRAIN_MULTIPLIERS: TERRAIN_MOVEMENT_MULTIPLIERS,
  TERRAIN_MOVEMENT_MULTIPLIERS,
  TERRAIN_RISK_MULTIPLIERS
};
