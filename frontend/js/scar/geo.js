// Converte o GeoJSON real (lon/lat) vindo da API pro mesmo tipo de espaço de
// desenho (viewBox 0 0 1000 700) que o mapa em grafo já usa, sem precisar de
// nenhuma lib de mapa (Leaflet, Mapbox etc.) — é só uma projeção linear
// simples, suficiente pra uma área pequena do wasteland.

const VIEW_W = 1000;
const VIEW_H = 700;
// Margem generosa: as zonas de perigo viram um blob orgânico que "vaza" um
// pouco além do seu raio real (ver organicBlobPath em render.js), então
// precisam de mais respiro até a borda do viewBox do que um nó pontual.
const PAD = 100;

export const TYPE_ICONS = {
  citadel: '🏰',
  water_refinery: '💧',
  gas_town: '⛽',
  canyon_hideout: '🪨',
  rust_graveyard: '🔧',
  bullet_farm: '💥',
  dead_pass: '☠️',
  oasis_mirage: '🌴',
  outpost_omega: '📡',
  // Locais compartilhados pela comunidade — mesmas categorias do modo fantasia.
  recurso: '💧',
  seguro: '🛡️',
  comum: '📌'
};

export function dangerBucket(level) {
  const n = Number(level) || 0;
  if (n >= 4) return 'high';
  if (n >= 2) return 'mid';
  return 'low';
}

// Ray casting — usado só pra saber, no espaço já projetado (px), se um nó
// cai de fato dentro do retângulo real de uma zona (data/zones.geojson),
// pra desenhar o blob orgânico sem "encostar" em nenhum nó (ver render.js).
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

/**
 * Projeção linear simples lon/lat <-> px, calculada a partir do bounding
 * box dos nós reais + das zonas de perigo (senão uma zona que se estende
 * além do último nó do dataset fica cortada na borda do mapa). `unproject`
 * é o inverso de `project` — usado pra saber em que lon/lat o usuário
 * clicou no mapa (compartilhar local).
 */
export function createProjection(nodesGeojson, zonesGeojson) {
  const nodeCoords = (nodesGeojson?.features || []).map(f => f.geometry.coordinates);
  const zoneCoords = (zonesGeojson?.features || [])
    .flatMap(f => f.geometry?.coordinates || [])
    .flat();
  const coords = [...nodeCoords, ...zoneCoords];
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  const innerW = VIEW_W - PAD * 2;
  const innerH = VIEW_H - PAD * 2;

  function project([lon, lat]) {
    const x = PAD + ((lon - minLon) / lonSpan) * innerW;
    // Latitude cresce pra norte; y do SVG cresce pra baixo — por isso invertido.
    const y = PAD + ((maxLat - lat) / latSpan) * innerH;
    return [Math.round(x), Math.round(y)];
  }

  function unproject([x, y]) {
    const lon = minLon + ((x - PAD) / innerW) * lonSpan;
    const lat = maxLat - ((y - PAD) / innerH) * latSpan;
    return [lon, lat];
  }

  return { project, unproject };
}

/**
 * Monta a "cena" projetada a partir dos três GeoJSON da API (/api/v1/layers).
 * @returns { nodes, edges, zones, project, unproject }
 */
export function buildScene(nodesGeojson, edgesGeojson, zonesGeojson) {
  const { project, unproject } = createProjection(nodesGeojson, zonesGeojson);

  const nodes = (nodesGeojson?.features || []).map(f => {
    const props = f.properties || {};
    const id = f.id || props.id;
    const [x, y] = project(f.geometry.coordinates);
    const isCommunity = !!props.community;
    return {
      id,
      label: props.name || id,
      x, y,
      type: props.type,
      isCommunity,
      category: isCommunity ? props.type : null,
      dangerLevel: props.danger_level ?? 0,
      description: props.description || '',
      resources: props.resources || null
    };
  });

  const nodeIds = new Set(nodes.map(n => n.id));

  const edges = (edgesGeojson?.features || [])
    .map(f => {
      const props = f.properties || {};
      return {
        id: props.id,
        from: props.source_node,
        to: props.target_node,
        distanceKm: props.distance_km,
        dangerLevel: props.danger_level ?? 0,
        terrainType: props.terrain_type,
        description: props.description || ''
      };
    })
    .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

  // Centro + raio (em px já projetados) de cada zona — usados pra desenhar
  // um blob orgânico em vez do polígono retangular exato do dataset.
  const zones = (zonesGeojson?.features || []).map(f => {
    const props = f.properties || {};
    const rings = (f.geometry?.coordinates || []).map(ring => ring.map(project));

    const outer = rings[0] || [];
    const first = outer[0];
    const last = outer[outer.length - 1];
    // GeoJSON repete o ponto de fechamento no fim do anel — remove pra não
    // distorcer o centro calculado.
    const uniqueOuter = (outer.length > 1 && first && last && first[0] === last[0] && first[1] === last[1])
      ? outer.slice(0, -1)
      : outer;

    const cx = uniqueOuter.reduce((s, p) => s + p[0], 0) / (uniqueOuter.length || 1);
    const cy = uniqueOuter.reduce((s, p) => s + p[1], 0) / (uniqueOuter.length || 1);
    const radius = uniqueOuter.reduce((max, p) => Math.max(max, Math.hypot(p[0] - cx, p[1] - cy)), 0);

    // Pra cada nó, marca se ele está de fato dentro do retângulo real dessa
    // zona (não do blob desenhado) — render.js usa isso pra abrir espaço ao
    // redor de cada nó em vez de deixar o contorno passar em cima dele.
    const nodeAvoidance = nodes.map(n => ({
      x: n.x,
      y: n.y,
      inside: pointInPolygon([n.x, n.y], uniqueOuter)
    }));

    return {
      id: props.id,
      name: props.name,
      zoneType: props.zone_type,
      threatLevel: props.threat_level,
      dangerMultiplier: props.danger_multiplier,
      description: props.description || '',
      rings,
      center: [cx, cy],
      radius,
      nodeAvoidance
    };
  });

  return { nodes, edges, zones, project, unproject };
}
