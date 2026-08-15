// Motor de rotas S.C.A.R. — porta em JS puro (sem dependências) do antigo
// core/engine.py (networkx + shapely). Carrega os GeoJSON de data/, monta um
// grafo direcionado em memória e calcula o caminho de menor custo (Dijkstra)
// nos modos "survival" (pondera perigo/terreno/zonas) e "direct" (só terreno).

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

      let zonePenalty = 1.0;
      for (const zone of this.dangerZones) {
        if (lineIntersectsPolygon(geometryCoords, zone.rings)) {
          const zp = zone.properties;
          zonePenalty *= zp.danger_multiplier ?? zp.penalty_multiplier ?? 1.0;
        }
      }

      if (!(terrain in TERRAIN_MULTIPLIERS)) {
        console.warn(
          `terrain_type '${terrain}' (aresta ${feature.id || props.id || `${u}_${v}`}) não mapeado ` +
          `em TERRAIN_MULTIPLIERS; usando multiplicador padrão 1.0x`
        );
      }
      const terrainMult = TERRAIN_MULTIPLIERS[terrain] ?? 1.0;
      const directWeight = dist * terrainMult;
      const survivalWeight = dist * (1.0 + danger * 1.5) * terrainMult * zonePenalty;

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
    const terrainMult = TERRAIN_MULTIPLIERS[terrain];

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

      let zonePenalty = 1.0;
      for (const zone of this.dangerZones) {
        if (lineIntersectsPolygon(geometryCoords, zone.rings)) {
          const zp = zone.properties;
          zonePenalty *= zp.danger_multiplier ?? zp.penalty_multiplier ?? 1.0;
        }
      }

      const directWeight = distanceKm * terrainMult;
      const survivalWeight = distanceKm * (1.0 + dangerLevel * 1.5) * terrainMult * zonePenalty;
      const roundedDist = Math.round(distanceKm * 100) / 100;

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
  addDangerZone({ id, name, zoneType, threatLevel, dangerMultiplier, stealthPenalty, description, rings }) {
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
      zone_type: zoneType,
      threat_level: threatLevel,
      danger_multiplier: dangerMultiplier,
      stealth_penalty: stealthPenalty,
      description,
      community: true
    };

    this.dangerZones.push({ rings, properties });

    for (const edges of this.adjacency.values()) {
      for (const edge of edges) {
        if (!lineIntersectsPolygon(edge.geometry, rings)) continue;
        edge.zonePenalty *= dangerMultiplier;
        const terrainMult = TERRAIN_MULTIPLIERS[edge.terrainType] ?? 1.0;
        edge.survivalWeight = edge.distanceKm * (1.0 + edge.dangerLevel * 1.5) * terrainMult * edge.zonePenalty;
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
    let totalDanger = 0;
    let routeCoordinates = [];

    for (const edge of pathEdges) {
      totalDistance += edge.distanceKm;
      totalDanger += edge.dangerLevel;

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
        total_danger_score: totalDanger,
        estimated_fuel_liters: fuelEstimate,
        survival_probability: Math.max(1, Math.trunc(100 - totalDanger * 8.5))
      },
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates
      }
    };
  }
}

module.exports = { WastelandRouter, TERRAIN_MULTIPLIERS };
