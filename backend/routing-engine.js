// Motor de rotas S.C.A.R. — porta em JS puro (sem dependências) do antigo
// core/engine.py (networkx + shapely). Carrega os GeoJSON de data/, monta um
// grafo direcionado em memória e calcula o caminho de menor custo (Dijkstra)
// nos modos "survival" (maximiza a probabilidade de chegada) e "direct"
// (minimiza exclusivamente a distância).

'use strict';

// Mantida sincronizada com os valores de "terrain_type" usados em
// data/edges.geojson. Qualquer valor ausente aqui cai silenciosamente no
// multiplicador padrão (1.0x).
const TERRAIN_MULTIPLIERS = {
  asphalt_ruins: 1.0,
  highway_ruins: 1.1,
  safe_pass: 1.0,
  killzone_highway: 1.0,
  packed_dirt: 1.2,
  dirt_track: 1.2,
  canyon_trail: 1.3,
  sheltered_canyon: 1.2,
  ambush_corridor: 1.3,
  hostile_trail: 1.4,
  sand_dunes: 1.8,
  dune_bypass: 1.5,
  storm_plains: 1.6,
  radioactive_crater: 2.5
};

// Exposição relativa ao risco por quilômetro.  Estes valores não são usados
// pela rota direta: eles representam apenas quanto o tipo de terreno aumenta
// ou reduz a chance de incidente durante uma travessia.
const TERRAIN_RISK_MULTIPLIERS = {
  safe_pass: 0.65,
  corporate_highway: 0.85,
  sheltered_valley: 0.8,
  canyon_trail: 1.05,
  canyon_trench: 1.15,
  packed_dirt: 1.2,
  transition_plains: 1.3,
  high_relief_pass: 1.75,
  storm_plains: 1.8,
  black_ice_highway: 2.05,
  scorched_dunes: 2.15,
  sand_dunes: 2.2,
  shockwave_boundary: 2.5,
  minefield_pass: 2.8,
  radioactive_crater: 3.1
};

const BASE_HAZARD_PER_KM = 0.0015;
const DANGER_HAZARD_PER_KM = 0.0045;

// ── Geometria (substitui o shapely) ──

function pointInPolygon([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(p, q, r) {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-12) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(p, q, r) {
  return Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) &&
         Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
}

function segmentsIntersect(p1, p2, p3, p4) {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  return false;
}

// Equivalente a `edge_line.intersects(zone_geometry)`: verdadeiro se algum
// ponto da linha está dentro do polígono OU algum segmento cruza a borda.
function lineIntersectsPolygon(lineCoords, polygonRings) {
  for (const ring of polygonRings) {
    for (const point of lineCoords) {
      if (pointInPolygon(point, ring)) return true;
    }
    for (let i = 0; i < lineCoords.length - 1; i++) {
      for (let j = 0; j < ring.length - 1; j++) {
        if (segmentsIntersect(lineCoords[i], lineCoords[i + 1], ring[j], ring[j + 1])) {
          return true;
        }
      }
    }
  }
  return false;
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
  return Math.max(0, Math.min(1, t));
}

// Calcula exatamente a fração da linha dentro do polígono. Cada segmento é
// dividido nos pontos em que cruza uma borda; o ponto médio determina se o
// intervalo pertence à zona. Isso evita saltos de peso causados por amostras.
function lineExposureFraction(lineCoords, polygonRings) {
  let total = 0;
  let exposed = 0;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const a = lineCoords[i];
    const b = lineCoords[i + 1];
    const length = haversineKm(a, b);
    if (length === 0) continue;

    const cuts = [0, 1];
    for (const ring of polygonRings) {
      for (let j = 0; j < ring.length - 1; j++) {
        const t = segmentIntersectionParameter(a, b, ring[j], ring[j + 1]);
        if (t != null) cuts.push(t);
      }
    }

    cuts.sort((x, y) => x - y);
    const uniqueCuts = cuts.filter((value, index) => index === 0 || Math.abs(value - cuts[index - 1]) > 1e-9);
    total += length;
    for (let j = 0; j < uniqueCuts.length - 1; j++) {
      const start = uniqueCuts[j];
      const end = uniqueCuts[j + 1];
      const midpoint = (start + end) / 2;
      const point = [a[0] + (b[0] - a[0]) * midpoint, a[1] + (b[1] - a[1]) * midpoint];
      if (pointInPolygonRings(point, polygonRings)) exposed += length * (end - start);
    }
  }
  return total ? exposed / total : 0;
}

function calculateZoneRiskMultiplier(lineCoords, zones) {
  return zones.reduce((multiplier, zone) => {
    const exposure = lineExposureFraction(lineCoords, zone.rings);
    if (!exposure) return multiplier;
    const dangerMultiplier = Number(zone.properties.danger_multiplier ?? zone.properties.penalty_multiplier ?? 1);
    // A exposição parcial escala a penalidade; zonas sobrepostas acumulam.
    return multiplier * (1 + Math.max(0, dangerMultiplier - 1) * exposure);
  }, 1);
}

function calculateEdgeHazard(distanceKm, dangerLevel, terrainType, zoneRiskMultiplier) {
  const terrainRisk = TERRAIN_RISK_MULTIPLIERS[terrainType] ?? 1;
  const perKm = (BASE_HAZARD_PER_KM + Number(dangerLevel || 0) * DANGER_HAZARD_PER_KM) * terrainRisk;
  return distanceKm * perKm * zoneRiskMultiplier;
}

function formatSurvivalProbability(totalHazard) {
  const probability = Math.exp(-totalHazard) * 100;
  if (probability >= 10) return Math.round(probability * 10) / 10;
  if (probability >= 1) return Math.round(probability * 100) / 100;
  return Math.round(probability * 1000) / 1000;
}

// Distância em km entre dois pontos [lon, lat] (fórmula de haversine) — usada
// só pra ligar um local compartilhado pela comunidade aos nós reais mais
// próximos (as arestas do dataset já vêm com distance_km pronto).
function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Fila de prioridade mínima (substitui heapq / a fila do networkx) ──

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }

  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].dist <= this.items[i].dist) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l].dist < this.items[smallest].dist) smallest = l;
        if (r < this.items.length && this.items[r].dist < this.items[smallest].dist) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

class WastelandRouter {
  constructor() {
    this.nodesData = new Map();
    this.dangerZones = [];
    this.adjacency = new Map(); // nodeId -> [{ to, ...edgeAttrs }]

    // Locais compartilhados pela comunidade (recurso/local seguro) viram nós
    // de verdade no grafo — guardados também como Features GeoJSON pra poder
    // ser devolvidos em /api/v1/layers e persistidos em disco.
    this.communityNodeFeatures = [];
    this.communityEdgeFeatures = [];
    this.nextCommunityId = 1;

    // Zonas de perigo reportadas pela comunidade — mesmo esquema de
    // data/zones.geojson (id, name, zone_type, threat_level,
    // danger_multiplier, stealth_penalty, description + Polygon).
    this.communityZoneFeatures = [];
    this.nextCommunityZoneId = 1;
  }

  /** Carrega nós (POIs), arestas (vias bidirecionais) e zonas de perigo. */
  loadFromGeojson(nodesGeojson, edgesGeojson, zonesGeojson) {
    if (zonesGeojson) {
      for (const feature of zonesGeojson.features || []) {
        this.dangerZones.push({
          rings: feature.geometry.coordinates,
          properties: feature.properties || {}
        });
      }
    }

    // O id pode vir no campo GeoJSON padrão (Feature.id) OU dentro de
    // properties.id — o dataset atual usa o segundo formato.
    for (const feature of nodesGeojson.features || []) {
      const props = feature.properties || {};
      const nodeId = feature.id ?? props.id;
      if (nodeId == null) {
        throw new Error(`Nó sem identificador (nem Feature.id nem properties.id): ${JSON.stringify(feature)}`);
      }
      this.nodesData.set(nodeId, { coords: feature.geometry.coordinates, ...props });
      this.adjacency.set(nodeId, []);
    }

    for (const feature of edgesGeojson.features || []) {
      const props = feature.properties || {};
      const u = props.source_node;
      const v = props.target_node;

      // "distance_km" é o nome usado no dataset atual; "base_distance_km"
      // é mantido como fallback por compatibilidade com dados antigos.
      const dist = props.distance_km ?? props.base_distance_km ?? 1.0;
      const danger = props.danger_level ?? 0;
      const terrain = props.terrain_type ?? 'asphalt_ruins';
      const oneWay = props.one_way ?? false;
      const geometryCoords = feature.geometry.coordinates;

      const zonePenalty = calculateZoneRiskMultiplier(geometryCoords, this.dangerZones);

      if (!(terrain in TERRAIN_RISK_MULTIPLIERS)) {
        console.warn(
          `terrain_type '${terrain}' (aresta ${feature.id || props.id || `${u}_${v}`}) não mapeado ` +
          `em TERRAIN_RISK_MULTIPLIERS; usando multiplicador padrão 1.0x`
        );
      }
      const directWeight = dist;
      // Somar hazard equivale a maximizar o produto das probabilidades de
      // sobrevivência dos trechos (P = exp(-hazard)).
      const survivalWeight = calculateEdgeHazard(dist, danger, terrain, zonePenalty);

      const baseAttrs = {
        edgeId: feature.id || props.id || `${u}_${v}`,
        distanceKm: dist,
        dangerLevel: danger,
        terrainType: terrain,
        directWeight,
        survivalWeight,
        zonePenalty
      };

      if (this.adjacency.has(u)) {
        this.adjacency.get(u).push({ to: v, geometry: geometryCoords, ...baseAttrs });
      }
      // Aresta reversa (volta), a menos que explicitamente one_way — inverte
      // a geometria pra desenhar certo no sentido de volta.
      if (!oneWay && this.adjacency.has(v)) {
        this.adjacency.get(v).push({ to: u, geometry: [...geometryCoords].reverse(), ...baseAttrs });
      }
    }
  }

  /**
   * Registra um local compartilhado pela comunidade (recurso/local seguro)
   * como um nó de verdade no grafo, ligado aos 1-2 nós existentes mais
   * próximos (mesma ideia do community.js do modo fantasia, mas agora as
   * arestas entram no motor de rotas de verdade — inclusive respeitando as
   * zonas de perigo, igual a qualquer outra via).
   *
   * @param {{id?:string, label:string, category:'recurso'|'seguro', lon:number, lat:number}} input
   *   `id` só é passado ao repor um registro já persistido em disco no boot.
   */
  addCommunityNode({ id, label, category, lon, lat }) {
    let finalId = id;
    if (!finalId) {
      finalId = `community_${this.nextCommunityId}`;
      this.nextCommunityId += 1;
    } else {
      const n = parseInt(String(id).replace('community_', ''), 10);
      if (Number.isFinite(n) && n >= this.nextCommunityId) this.nextCommunityId = n + 1;
    }

    const coords = [lon, lat];
    const dangerLevel = 1; // local vetado pela comunidade: risco baixo por padrão
    const terrain = 'safe_pass';
    const existingIds = [...this.adjacency.keys()];
    const linkCount = existingIds.length > 1 ? 2 : Math.min(1, existingIds.length);
    const neighbors = existingIds
      .map((nid) => ({ nid, dist: haversineKm(coords, this.nodesData.get(nid).coords) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, linkCount);

    this.nodesData.set(finalId, { coords, id: finalId, name: label, type: category, danger_level: dangerLevel });
    this.adjacency.set(finalId, []);

    const edgeFeatures = [];
    neighbors.forEach(({ nid, dist: distanceKm }) => {
      const geometryCoords = [coords, this.nodesData.get(nid).coords];

      const zonePenalty = calculateZoneRiskMultiplier(geometryCoords, this.dangerZones);
      const roundedDist = Math.round(distanceKm * 100) / 100;
      const directWeight = roundedDist;
      const survivalWeight = calculateEdgeHazard(roundedDist, dangerLevel, terrain, zonePenalty);

      const baseAttrs = {
        edgeId: `edge_${finalId}_${nid}`,
        distanceKm: roundedDist,
        dangerLevel,
        terrainType: terrain,
        directWeight,
        survivalWeight,
        zonePenalty
      };

      this.adjacency.get(finalId).push({ to: nid, geometry: geometryCoords, ...baseAttrs });
      this.adjacency.get(nid).push({ to: finalId, geometry: [...geometryCoords].reverse(), ...baseAttrs });

      edgeFeatures.push({
        type: 'Feature',
        properties: {
          id: baseAttrs.edgeId,
          source_node: finalId,
          target_node: nid,
          distance_km: roundedDist,
          danger_level: dangerLevel,
          terrain_type: terrain,
          description: 'Ligação criada pela comunidade.'
        },
        geometry: { type: 'LineString', coordinates: geometryCoords }
      });
    });

    const nodeFeature = {
      type: 'Feature',
      properties: {
        id: finalId,
        name: label,
        type: category,
        danger_level: dangerLevel,
        description: category === 'recurso'
          ? 'Recurso compartilhado pela comunidade.'
          : 'Local seguro compartilhado pela comunidade.',
        community: true
      },
      geometry: { type: 'Point', coordinates: coords }
    };

    this.communityNodeFeatures.push(nodeFeature);
    this.communityEdgeFeatures.push(...edgeFeatures);

    return { id: finalId, nodeFeature, edgeFeatures };
  }

  /**
   * Registra uma zona de perigo reportada pela comunidade — mesmo formato de
   * data/zones.geojson (Polygon + id/name/zone_type/threat_level/
   * danger_multiplier/stealth_penalty/description). Qualquer aresta que já
   * exista e cruze essa área tem o `zonePenalty`/`survivalWeight`
   * recalculado na hora, do mesmo jeito que `loadFromGeojson` calcula pras
   * zonas originais — não é preciso reiniciar o servidor.
   *
   * @param {{id?:string, name:string, zoneType:string, threatLevel:string,
   *   dangerMultiplier:number, stealthPenalty:number, description:string,
   *   rings:number[][][]}} input
   *   `id` só é passado ao repor um registro já persistido em disco no boot.
   */
  addDangerZone({ id, name, biomeFocus, zoneType, threatLevel, dangerMultiplier, stealthPenalty, description, rings }) {
    let finalId = id;
    if (!finalId) {
      finalId = `community_zone_${this.nextCommunityZoneId}`;
      this.nextCommunityZoneId += 1;
    } else {
      const n = parseInt(String(id).replace('community_zone_', ''), 10);
      if (Number.isFinite(n) && n >= this.nextCommunityZoneId) this.nextCommunityZoneId = n + 1;
    }

    const properties = {
      id: finalId,
      name,
      biome_focus: biomeFocus || 'scorched_desert',
      zone_type: zoneType,
      threat_level: threatLevel,
      danger_multiplier: dangerMultiplier,
      stealth_penalty: stealthPenalty,
      description,
      community: true
    };

    this.dangerZones.push({ rings, properties });

    // Recalcular contra todas as zonas, em vez de multiplicar cegamente a
    // nova penalidade. Assim uma aresta que apenas raspa a zona recebe risco
    // proporcional à exposição e não uma penalidade integral.
    for (const edges of this.adjacency.values()) {
      for (const edge of edges) {
        edge.zonePenalty = calculateZoneRiskMultiplier(edge.geometry, this.dangerZones);
        edge.survivalWeight = calculateEdgeHazard(
          edge.distanceKm, edge.dangerLevel, edge.terrainType, edge.zonePenalty
        );
      }
    }

    const zoneFeature = {
      type: 'Feature',
      properties,
      geometry: { type: 'Polygon', coordinates: rings }
    };
    this.communityZoneFeatures.push(zoneFeature);

    return { id: finalId, zoneFeature };
  }

  /** Calcula o melhor caminho com Dijkstra sobre o grafo em memória. */
  calculateRoute(originId, destinationId, mode = 'survival') {
    if (!this.adjacency.has(originId) || !this.adjacency.has(destinationId)) {
      const unknown = !this.adjacency.has(originId) ? originId : destinationId;
      return { error: `Localização desconhecida: ${unknown}` };
    }

    const weightKey = mode === 'survival' ? 'survivalWeight' : 'directWeight';

    const dist = new Map();
    for (const id of this.adjacency.keys()) dist.set(id, Infinity);
    dist.set(originId, 0);

    const cameFrom = new Map(); // nodeId -> { from, edge }
    const settled = new Set();
    const heap = new MinHeap();
    heap.push({ id: originId, dist: 0 });

    while (heap.size) {
      const { id, dist: d } = heap.pop();
      if (settled.has(id)) continue;
      settled.add(id);
      if (id === destinationId) break;

      for (const edge of this.adjacency.get(id)) {
        if (settled.has(edge.to)) continue;
        const candidate = d + edge[weightKey];
        if (candidate < dist.get(edge.to)) {
          dist.set(edge.to, candidate);
          cameFrom.set(edge.to, { from: id, edge });
          heap.push({ id: edge.to, dist: candidate });
        }
      }
    }

    if (dist.get(destinationId) === Infinity) {
      return { error: 'Sem rota viável. O caminho está bloqueado.' };
    }

    const pathNodes = [destinationId];
    const pathEdges = [];
    let cur = destinationId;
    while (cur !== originId) {
      const { from, edge } = cameFrom.get(cur);
      pathEdges.unshift(edge);
      pathNodes.unshift(from);
      cur = from;
    }

    let totalDistance = 0;
    let totalHazard = 0;
    let routeCoordinates = [];

    for (const edge of pathEdges) {
      totalDistance += edge.distanceKm;
      totalHazard += edge.survivalWeight;

      // Acumula coordenadas sem duplicar o ponto de intersecção.
      if (!routeCoordinates.length) routeCoordinates = routeCoordinates.concat(edge.geometry);
      else routeCoordinates = routeCoordinates.concat(edge.geometry.slice(1));
    }

    const fuelEstimate = Math.round(totalDistance * 0.8 * 10) / 10;

    return {
      type: 'Feature',
      properties: {
        navigation_mode: mode,
        path_nodes: pathNodes,
        total_distance_km: Math.round(totalDistance * 100) / 100,
        // Escala legível e coerente: menor pontuação significa menor risco.
        // Ela inclui distância, terreno e exposição às zonas, exatamente como
        // o custo otimizado no modo sobrevivência.
        total_danger_score: Math.round(totalHazard * 100) / 10,
        estimated_fuel_liters: fuelEstimate,
        // Probabilidades independentes se compõem por multiplicação;
        // log(P) transforma o problema em Dijkstra com pesos não negativos.
        survival_probability: formatSurvivalProbability(totalHazard),
        survival_hazard_score: Math.round(totalHazard * 10000) / 10000
      },
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates
      }
    };
  }
}

module.exports = { WastelandRouter, TERRAIN_MULTIPLIERS, TERRAIN_RISK_MULTIPLIERS };
