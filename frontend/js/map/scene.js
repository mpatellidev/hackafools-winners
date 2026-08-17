const WIDTH = 1057;
const HEIGHT = 1008;
const PAD = 68;

function spreadNodes(nodes, minimumDistance = 64) {
  for (let iteration = 0; iteration < 56; iteration += 1) {
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const first = nodes[left];
        const second = nodes[right];
        let deltaX = second.x - first.x;
        let deltaY = second.y - first.y;
        let distance = Math.hypot(deltaX, deltaY);
        if (distance >= minimumDistance) continue;
        if (distance < .01) {
          const angle = (left * 37 + right * 71) * Math.PI / 180;
          deltaX = Math.cos(angle);
          deltaY = Math.sin(angle);
          distance = 1;
        }
        const push = (minimumDistance - distance) * .12;
        const offsetX = deltaX / distance * push;
        const offsetY = deltaY / distance * push;
        first.x -= offsetX;
        first.y -= offsetY;
        second.x += offsetX;
        second.y += offsetY;
      }
    }
    nodes.forEach((node) => {
      node.x = Math.max(PAD, Math.min(WIDTH - PAD, node.x));
      node.y = Math.max(PAD, Math.min(HEIGHT - PAD, node.y));
    });
  }
}

// Territórios visuais delimitados pela cartografia local. Cada polígono é associado a
// uma das sete zonas operacionais já existentes no GeoJSON; o cálculo de
// risco continua usando a geometria geográfica original no backend.
const VISUAL_TERRITORIES = {
  zone_western_knife_ridge: [[86,190],[126,171],[148,124],[195,103],[211,42],[256,72],[299,17],[349,52],[431,56],[479,32],[563,60],[600,108],[621,168],[616,245],[640,311],[624,438],[569,473],[534,512],[457,572],[410,622],[329,578],[286,551],[222,541],[171,511],[143,461],[153,405],[125,357],[157,308],[101,284],[74,248]],
  zone_canyon_killpeaks: [[530,705],[545,660],[588,626],[642,616],[694,633],[722,674],[724,716],[704,759],[672,785],[609,785],[562,755]],
  zone_dome_meridian_truce: [[584,5],[690,1],[744,42],[775,87],[760,181],[708,238],[638,246],[592,216],[565,166],[573,84]],
  zone_frostspire_blizzard: [[774,91],[843,104],[948,116],[1017,159],[1041,208],[1025,307],[974,372],[951,419],[875,436],[833,474],[776,521],[718,487],[624,439],[633,330],[631,252],[691,244],[760,183]],
  zone_frost_reach_north: [[704,944],[755,915],[815,884],[871,862],[902,881],[890,917],[849,950],[826,989],[759,1005],[706,987]],
  zone_radioactive_scorch_flames: [[110,546],[164,519],[227,543],[284,558],[323,602],[381,651],[430,684],[449,754],[441,831],[491,887],[548,916],[536,955],[439,970],[372,997],[311,980],[281,941],[214,921],[165,922],[107,889],[76,834],[91,780],[75,736],[101,676]],
  zone_ember_dunes_south: [[289,544],[375,589],[452,617],[526,581],[587,516],[671,449],[738,447],[759,507],[827,534],[897,576],[951,642],[953,681],[919,687],[902,755],[914,816],[882,879],[829,900],[775,908],[710,916],[644,906],[574,928],[510,947],[455,920],[420,850],[427,774],[402,698],[343,649]]
};

export function createScene(layers) {
  const nodeFeatures = layers.nodes?.features || [];
  const edgeFeatures = layers.edges?.features || [];
  const zoneFeatures = layers.zones?.features || [];
  const coordinates = [
    ...nodeFeatures.map((feature) => feature.geometry.coordinates),
    ...zoneFeatures.flatMap((feature) => (
      feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates.flat()
    ))
  ];
  if (!coordinates.length) throw new Error('Nenhuma coordenada válida foi encontrada.');

  const lons = coordinates.map((point) => point[0]);
  const lats = coordinates.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  const scale = Math.min((WIDTH - PAD * 2) / lonSpan, (HEIGHT - PAD * 2) / latSpan);
  const drawnWidth = lonSpan * scale;
  const drawnHeight = latSpan * scale;
  const offsetX = (WIDTH - drawnWidth) / 2;
  const offsetY = (HEIGHT - drawnHeight) / 2;

  const projectBase = ([lon, lat]) => [offsetX + (lon - minLon) * scale, offsetY + (maxLat - lat) * scale];
  const unproject = ([x, y]) => [minLon + (x - offsetX) / scale, maxLat - (y - offsetY) / scale];

  const nodes = nodeFeatures.map((feature) => {
    const properties = feature.properties || {};
    const id = feature.id || properties.id;
    const [x, y] = projectBase(feature.geometry.coordinates);
    return {
      id,
      label: properties.name || id,
      type: properties.type || 'unknown',
      biome: properties.biome || 'neutral',
      dangerLevel: Number(properties.danger_level || 0),
      description: properties.description || '',
      resources: properties.resources || null,
      community: Boolean(properties.community),
      coordinates: feature.geometry.coordinates,
      x, y
    };
  });

  const edges = edgeFeatures.map((feature) => {
    const properties = feature.properties || {};
    return {
      id: properties.id || feature.id,
      from: properties.source_node,
      to: properties.target_node,
      dangerLevel: Number(properties.danger_level || 0),
      terrainType: properties.terrain_type || 'unknown',
      description: properties.description || '',
      distanceKm: Number(properties.distance_km || 0),
      points: feature.geometry.coordinates.map(projectBase)
    };
  });

  spreadNodes(nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  edges.forEach((edge) => {
    const source = nodesById.get(edge.from);
    const destination = nodesById.get(edge.to);
    if (source) edge.points[0] = [source.x, source.y];
    if (destination) edge.points[edge.points.length - 1] = [destination.x, destination.y];
  });

  const zones = zoneFeatures.map((feature) => {
    const properties = feature.properties || {};
    const visualRing = VISUAL_TERRITORIES[properties.id];
    const isPoint = feature.geometry.type === 'Point';
    const rings = isPoint ? [] : visualRing ? [visualRing] : feature.geometry.coordinates.map((ring) => ring.map(projectBase));
    const outer = rings[0] || [];
    const center = isPoint ? projectBase(feature.geometry.coordinates) : outer.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
    if (!isPoint && outer.length) { center[0] /= outer.length; center[1] /= outer.length; }
    const fallbackSonarCoordinates = isPoint ? feature.geometry.coordinates : feature.geometry.coordinates[0][0];
    const sonarCoordinates = Array.isArray(properties.sonar_center) ? properties.sonar_center : fallbackSonarCoordinates;
    const sonarRadiusKm = Number(properties.sonar_radius_km || 0);
    return {
      id: properties.id,
      name: properties.name || 'Zona sem identificação',
      biome: properties.biome_focus || 'neutral',
      zoneType: properties.zone_type || 'environmental_hazard',
      threatLevel: properties.threat_level || 'tier_2',
      dangerMultiplier: Number(properties.danger_multiplier || 1),
      stealthPenalty: Number(properties.stealth_penalty || 0),
      description: properties.description || '',
      community: Boolean(properties.community),
      sonarOnly: Boolean(properties.sonar_only),
      rings, center,
      sonarCoordinates,
      sonarRadiusKm,
      sonarThreatLevel: properties.sonar_threat_level || properties.threat_level || 'tier_2',
      radarCenter: projectBase(sonarCoordinates),
      radarRadius: sonarRadiusKm / 111 * scale
    };
  });

  const regions = zones.filter((zone) => !zone.sonarOnly && zone.rings[0]?.length).map((zone, index) => ({
    id: `region-${zone.id}`,
    name: zone.name,
    points: zone.rings[0] || [],
    index
  }));
  const nodesByCoordinate = new Map(nodes.map((node) => [node.coordinates.join(','), node]));
  const project = (coordinates) => {
    const node = nodesByCoordinate.get(coordinates.join(','));
    return node ? [node.x, node.y] : projectBase(coordinates);
  };

  return { width: WIDTH, height: HEIGHT, nodes, edges, zones, regions, project, unproject };
}
