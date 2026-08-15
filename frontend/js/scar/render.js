// Desenho SVG do mapa real do wasteland. Irmão de ../game/render.js, mas
// adaptado pro formato vindo de geo.js (nós com danger_level/type reais e
// zonas de perigo poligonais) — não compartilha estado com o grafo de
// fantasia, então nada do modo antigo é tocado.

import { dangerBucket } from './geo.js';

const NS = 'http://www.w3.org/2000/svg';

// PRNG determinístico (mulberry32 sobre um hash da seed) — o blob de cada
// zona fica "aleatório" mas estável entre re-renders, sem precisar guardar
// os pontos gerados em lugar nenhum.
function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function zoneVisualStyle(zone) {
  const biome = zone.biomeFocus || zone.zoneType || 'environmental_hazard';
  const danger = Number(zone.dangerMultiplier) || 1;
  const dangerBoost = clamp((danger - 1.3) / 1.8, 0, 1);
  const risk = zone.threatLevel || (danger >= 2.1 ? 'tier_3' : danger >= 1.6 ? 'tier_2' : 'tier_1');
  const palettes = {
    frozen_wastes: { hue: 205, sat: 72, light: 67 },
    scorched_desert: { hue: 27, sat: 76, light: 57 },
    high_relief_canyons: { hue: 28, sat: 44, light: 45 },
    corporate_domes: { hue: 150, sat: 48, light: 50 },
    faction_hostile: { hue: 332, sat: 58, light: 61 },
    environmental_hazard: { hue: 44, sat: 76, light: 58 },
    community_hazard: { hue: 194, sat: 62, light: 55 }
  };
  const base = palettes[biome] || palettes.environmental_hazard;

  return {
    fill: `hsla(${base.hue}, ${base.sat}%, ${base.light}%, ${0.11 + dangerBoost * 0.11})`,
    stroke: `hsla(${base.hue}, ${base.sat}%, ${Math.min(base.light + 18, 82)}%, ${0.42 + dangerBoost * 0.18})`,
    width: 1.1 + dangerBoost * 0.65,
    risk
  };
}

// Espaço mínimo (px do viewBox) entre o contorno do blob e o círculo de
// qualquer nó — aumentado para deixar mais ar entre zonas e nós, favorecendo
// a leitura de desvios e rotas alternadas no painel de apresentação.
const NODE_CLEARANCE = 60;

// Gera um "d" de <path> em forma de nuvem orgânica (pontos com raio
// perturbado, unidos por uma spline Catmull-Rom fechada) em vez do
// retângulo exato de zones.geojson — só a aparência muda, a geometria usada
// pelo motor de rotas continua sendo a original.
//
// `avoidPoints` (nós próximos, com a flag `inside` calculada em geo.js a
// partir do retângulo REAL da zona) empurra o raio, direção por direção:
// pra fora de quem está de fato dentro (fica bem envolvido, sem tocar a
// borda) e pra dentro de quem está fora (fica bem de fora, com folga).
function organicBlobPath(center, radius, seed, avoidPoints = []) {
  const POINTS = 16;
  const IRREGULARITY = 0.3;
  const rand = seededRandom(String(seed));
  const angleStep = (Math.PI * 2) / POINTS;
  const minFloor = radius * 0.35;

  const avoids = avoidPoints.map(p => {
    const dx = p.x - center[0];
    const dy = p.y - center[1];
    return { angle: Math.atan2(dy, dx), dist: Math.hypot(dx, dy), inside: p.inside };
  });

  const pts = [];
  for (let i = 0; i < POINTS; i++) {
    const angle = i * angleStep;
    let r = radius * (1 - IRREGULARITY / 2 + rand() * IRREGULARITY);

    avoids.forEach(a => {
      let diff = Math.abs(angle - a.angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > angleStep * 1.5) return; // nó longe demais dessa direção pra importar

      if (a.inside) r = Math.max(r, a.dist + NODE_CLEARANCE);
      else r = Math.min(r, Math.max(a.dist - NODE_CLEARANCE, minFloor));
    });

    pts.push([center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r]);
  }

  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} `;
  }
  return d + 'Z';
}

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function normalizedTerrainText(node) {
  return `${node.type || ''} ${node.label || ''} ${node.description || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function terrainKind(node) {
  const text = normalizedTerrainText(node);
  if (/(gelo|glacial|neve|frio|permafrost|frozen|crio|congel)/.test(text)) return 'frozen';
  if (/(canion|garganta|encosta|declividade|erosao|deslizamento|passagem|rocha)/.test(text)) return 'relief';
  if (/(oasis|agua|fonte|termal|reservatorio|hidro)/.test(text)) return 'water';
  if (/(refinaria|combustivel|chama|cinza|incendio|queimado|duna|calor)/.test(text)) return 'scorched';
  if (/(domo|cupula|citadel|mercado|complexo)/.test(text)) return 'settlement';
  return 'plain';
}

function appendLocalTerrainFeatures(layer, nodes, positions) {
  nodes.forEach(node => {
    const point = positions.get(node.id) || { x: node.x, y: node.y };
    const kind = terrainKind(node);
    const group = createSvgElement('g', { class: `terrain-feature terrain-${kind}` });

    if (kind === 'relief') {
      [29, 42, 56].forEach((radius, index) => {
        group.appendChild(createSvgElement('path', {
          d: organicBlobPath([point.x, point.y], radius, `${node.id}-relief-${index}`),
          class: 'terrain-contour terrain-contour-local',
          fill: 'none'
        }));
      });
    } else if (kind === 'frozen') {
      [-1, 0, 1].forEach(offset => {
        group.appendChild(createSvgElement('path', {
          d: `M ${point.x - 48},${point.y + offset * 13} L ${point.x - 20},${point.y - 11 + offset * 9} L ${point.x + 4},${point.y + 6 + offset * 7} L ${point.x + 47},${point.y - 14 + offset * 12}`,
          class: 'terrain-fracture',
          fill: 'none'
        }));
      });
    } else if (kind === 'water') {
      [31, 43].forEach(radius => {
        group.appendChild(createSvgElement('ellipse', {
          cx: point.x, cy: point.y, rx: radius, ry: radius * .55,
          class: 'terrain-waterline', fill: 'none'
        }));
      });
    } else if (kind === 'scorched') {
      [-18, 0, 18].forEach(offset => {
        group.appendChild(createSvgElement('path', {
          d: `M ${point.x - 55},${point.y + offset} Q ${point.x - 22},${point.y - 17 + offset} ${point.x + 4},${point.y + offset} T ${point.x + 58},${point.y + offset}`,
          class: 'terrain-dune-line', fill: 'none'
        }));
      });
    } else if (kind === 'settlement') {
      group.appendChild(createSvgElement('circle', {
        cx: point.x, cy: point.y, r: 42,
        class: 'terrain-settlement-boundary', fill: 'none'
      }));
    }

    if (group.childNodes.length) layer.appendChild(group);
  });
}

function appendTerrainZones(layer, zones) {
  zones.forEach(zone => {
    const style = zoneVisualStyle(zone);
    const biome = zone.biomeFocus || zone.zoneType || 'environmental_hazard';
    const group = createSvgElement('g', { class: `terrain-region terrain-region-${biome}` });
    const boundaryRadius = zone.radius * .82;
    const boundary = createSvgElement('path', {
      d: organicBlobPath(zone.center, boundaryRadius, zone.id || zone.name, zone.nodeAvoidance),
      class: `danger-zone zone-${biome} risk-${style.risk.replace('_', '-')}`,
      fill: style.fill,
      stroke: style.stroke,
      'stroke-width': style.width
    });
    const riskLabel = { tier_1: 'risco baixo', tier_2: 'risco médio', tier_3: 'risco alto' }[style.risk] || 'risco médio';
    const title = createSvgElement('title');
    title.textContent = `${zone.name} · ${riskLabel} · perigo x${zone.dangerMultiplier}`;
    boundary.appendChild(title);
    group.appendChild(boundary);

    const contourCount = biome === 'high_relief_canyons' ? 6 : biome === 'frozen_wastes' ? 4 : 3;
    for (let index = 1; index <= contourCount; index++) {
      const factor = .19 + (index / contourCount) * .52;
      group.appendChild(createSvgElement('path', {
        d: organicBlobPath(zone.center, boundaryRadius * factor, `${zone.id}-contour-${index}`),
        class: `terrain-contour contour-${biome}`,
        fill: 'none'
      }));
    }

    const regionLabel = createSvgElement('text', {
      x: zone.center[0],
      y: zone.center[1] - Math.min(boundaryRadius * .27, 42),
      class: 'terrain-region-label'
    });
    regionLabel.textContent = zone.name.toUpperCase();
    group.appendChild(regionLabel);
    layer.appendChild(group);
  });
}

function attachMapNavigation(svg) {
  const WORLD_WIDTH = 1000;
  const WORLD_HEIGHT = 700;
  const MIN_WIDTH = 300;
  const view = { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT };
  let dragging = false;
  let moved = false;
  let startClientX = 0;
  let startClientY = 0;
  let startX = 0;
  let startY = 0;

  function constrain() {
    view.width = clamp(view.width, MIN_WIDTH, WORLD_WIDTH);
    view.height = view.width * (WORLD_HEIGHT / WORLD_WIDTH);
    view.x = clamp(view.x, 0, WORLD_WIDTH - view.width);
    view.y = clamp(view.y, 0, WORLD_HEIGHT - view.height);
  }

  function renderView() {
    constrain();
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    const visualScale = view.width / WORLD_WIDTH;
    svg.querySelectorAll('.scar-node-circle').forEach(circle => circle.setAttribute('r', String(15 * visualScale)));
    svg.querySelectorAll('.scar-node-label').forEach(label => {
      label.setAttribute('y', String(28 * visualScale));
      label.style.fontSize = `${10 * visualScale}px`;
      label.style.strokeWidth = `${3 * visualScale}px`;
    });
    svg.querySelectorAll('.terrain-region-label').forEach(label => {
      label.style.fontSize = `${8 * visualScale}px`;
      label.style.strokeWidth = `${3 * visualScale}px`;
    });
  }

  function zoom(factor, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const anchorX = clientX == null ? view.x + view.width / 2 : view.x + ((clientX - rect.left) / rect.width) * view.width;
    const anchorY = clientY == null ? view.y + view.height / 2 : view.y + ((clientY - rect.top) / rect.height) * view.height;
    const oldWidth = view.width;
    const oldHeight = view.height;
    view.width *= factor;
    view.height = view.width * (WORLD_HEIGHT / WORLD_WIDTH);
    view.x = anchorX - ((anchorX - view.x) / oldWidth) * view.width;
    view.y = anchorY - ((anchorY - view.y) / oldHeight) * view.height;
    renderView();
  }

  svg.addEventListener('wheel', event => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? .84 : 1.19, event.clientX, event.clientY);
  }, { passive: false });

  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.scar-node')) return;
    dragging = true;
    moved = false;
    startClientX = event.clientX;
    startClientY = event.clientY;
    startX = view.x;
    startY = view.y;
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
  });

  svg.addEventListener('pointermove', event => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const dx = (event.clientX - startClientX) * (view.width / rect.width);
    const dy = (event.clientY - startClientY) * (view.height / rect.height);
    moved ||= Math.abs(event.clientX - startClientX) > 4 || Math.abs(event.clientY - startClientY) > 4;
    view.x = startX - dx;
    view.y = startY - dy;
    renderView();
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove('is-dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (moved) window.setTimeout(() => { moved = false; }, 0);
  }

  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('click', event => {
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    moved = false;
  }, true);

  const zoomIn = document.getElementById('mapZoomIn');
  const zoomOut = document.getElementById('mapZoomOut');
  const zoomReset = document.getElementById('mapZoomReset');
  if (zoomIn) zoomIn.onclick = () => zoom(.78);
  if (zoomOut) zoomOut.onclick = () => zoom(1.28);
  if (zoomReset) zoomReset.onclick = () => {
    Object.assign(view, { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT });
    renderView();
  };
  renderView();
}

function deterministicAngle(a, b) {
  const text = `${a}|${b}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967296) * Math.PI * 2;
}

function layoutNodePositions(nodes, minDistance = 72, iterations = 28) {
  const positions = new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }]));
  const anchors = new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }]));
  const ordered = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = positions.get(ordered[i].id);
        const b = positions.get(ordered[j].id);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        if (distance < 0.001) {
          const angle = deterministicAngle(ordered[i].id, ordered[j].id);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (minDistance - distance) * 0.52;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }

    for (const node of ordered) {
      const point = positions.get(node.id);
      const anchor = anchors.get(node.id);
      point.x += (anchor.x - point.x) * 0.045;
      point.y += (anchor.y - point.y) * 0.045;
      point.x = clamp(point.x, 32, 968);
      point.y = clamp(point.y, 32, 668);
    }
  }
  return positions;
}

function boxesOverlap(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function layoutNodeLabels(nodes, positions) {
  const layouts = new Map();
  const occupied = [];
  const ordered = [...nodes].sort((a, b) => positions.get(a.id).y - positions.get(b.id).y);

  for (const node of ordered) {
    const point = positions.get(node.id);
    const width = clamp(node.label.length * 5.6, 58, 190);
    const candidates = [
      { x: 0, y: 29, anchor: 'middle', left: -width / 2, top: 18 },
      { x: 0, y: -23, anchor: 'middle', left: -width / 2, top: -35 },
      { x: 23, y: 4, anchor: 'start', left: 23, top: -8 },
      { x: -23, y: 4, anchor: 'end', left: -23 - width, top: -8 },
      { x: 20, y: 25, anchor: 'start', left: 20, top: 13 },
      { x: -20, y: -19, anchor: 'end', left: -20 - width, top: -31 }
    ];

    let best = null;
    for (const candidate of candidates) {
      const box = {
        left: point.x + candidate.left,
        right: point.x + candidate.left + width,
        top: point.y + candidate.top,
        bottom: point.y + candidate.top + 15
      };
      let score = occupied.reduce((sum, other) => sum + boxesOverlap(box, other) * 10, 0);
      for (const other of nodes) {
        if (other.id === node.id) continue;
        const p = positions.get(other.id);
        if (p.x > box.left - 17 && p.x < box.right + 17 && p.y > box.top - 17 && p.y < box.bottom + 17) score += 500;
      }
      if (box.left < 8 || box.right > 992 || box.top < 8 || box.bottom > 692) score += 1000;
      if (!best || score < best.score) best = { ...candidate, box, score };
    }
    layouts.set(node.id, best);
    occupied.push(best.box);
  }
  return layouts;
}

export function buildScarSvg(container, nodes, edges, zones) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 700');
  svg.setAttribute('id', 'scarSvg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const backgroundLayer = document.createElementNS(NS, 'g');
  backgroundLayer.setAttribute('id', 'scarBackgroundLayer');
  backgroundLayer.appendChild(createSvgElement('rect', {
    x: 0, y: 0, width: 1000, height: 700, class: 'map-land-base'
  }));
  const terrainLayer = document.createElementNS(NS, 'g');
  terrainLayer.setAttribute('id', 'scarTerrainLayer');
  const zoneLayer = document.createElementNS(NS, 'g');
  zoneLayer.setAttribute('id', 'zoneLayer');
  const edgeLayer = document.createElementNS(NS, 'g');
  edgeLayer.setAttribute('id', 'scarEdgeLayer');
  const pathLayer = document.createElementNS(NS, 'g');
  pathLayer.setAttribute('id', 'scarPathLayer');
  const nodeLayer = document.createElementNS(NS, 'g');
  nodeLayer.setAttribute('id', 'scarNodeLayer');

  // Mantém as coordenadas projetadas do GeoJSON, para que vias e zonas se
  // alinhem com a mesma geometria usada pelo roteador.
  const positions = layoutNodePositions(nodes);
  const labelLayouts = layoutNodeLabels(nodes, positions);

  appendTerrainZones(zoneLayer, zones);
  appendLocalTerrainFeatures(terrainLayer, nodes, positions);

  edges.forEach(e => {
    const a = nodes.find(n => n.id === e.from);
    const b = nodes.find(n => n.id === e.to);
    if (!a || !b) return;

    const pa = positions.get(a.id) || { x: a.x, y: a.y };
    const pb = positions.get(b.id) || { x: b.x, y: b.y };

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', pa.x);
    line.setAttribute('y1', pa.y);
    line.setAttribute('x2', pb.x);
    line.setAttribute('y2', pb.y);
    line.setAttribute('class', `scar-edge danger-${dangerBucket(e.dangerLevel)}`);
    // Usados por setRouteEdges para destacar os trechos da rota calculada.
    line.dataset.from = e.from;
    line.dataset.to = e.to;

    const title = document.createElementNS(NS, 'title');
    title.textContent = `${a.label} ↔ ${b.label} · ${e.distanceKm}km · perigo ${e.dangerLevel} · ${e.terrainType}`;
    line.appendChild(title);

    edgeLayer.appendChild(line);
  });

  nodes.forEach(n => {
    const categoryClass = n.category ? ` cat-${n.category}` : '';
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `scar-node danger-${dangerBucket(n.dangerLevel)}${categoryClass}`);
    g.setAttribute('data-id', n.id);
    const p = positions.get(n.id) || { x: n.x, y: n.y };
    g.setAttribute('transform', `translate(${p.x},${p.y})`);

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', 15);
    circle.setAttribute('class', 'scar-node-circle');

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('class', 'scar-node-label');
    const labelLayout = labelLayouts.get(n.id);
    label.setAttribute('x', labelLayout.x);
    label.setAttribute('y', labelLayout.y);
    label.setAttribute('text-anchor', labelLayout.anchor);
    label.textContent = n.label;

    const resourceTxt = n.resources
      ? `\nÁgua ${n.resources.water} · Combustível ${n.resources.fuel} · Sucata ${n.resources.scrap}`
      : '';
    const communityTxt = n.isCommunity ? '\n(compartilhado pela comunidade)' : '';

    g.appendChild(circle);
    g.appendChild(label);

    nodeLayer.appendChild(g);
  });

  svg.appendChild(backgroundLayer);
  svg.appendChild(zoneLayer);
  svg.appendChild(terrainLayer);
  svg.appendChild(edgeLayer);
  svg.appendChild(pathLayer);
  svg.appendChild(nodeLayer);

  container.innerHTML = '';
  container.appendChild(svg);
  attachMapNavigation(svg);
  return svg;
}

/**
 * Mostra só as vias que fazem parte do caminho calculado (pares
 * consecutivos de `pathNodeIds`) — todas as outras ficam invisíveis. Chamar
 * com `null`/`[]` esconde a malha inteira (estado antes de calcular rota).
 */
export function setRouteEdges(pathNodeIds) {
  const layer = document.getElementById('scarEdgeLayer');
  if (!layer) return;

  const usedPairs = new Set();
  if (Array.isArray(pathNodeIds)) {
    for (let i = 0; i < pathNodeIds.length - 1; i++) {
      usedPairs.add(`${pathNodeIds[i]}|${pathNodeIds[i + 1]}`);
      usedPairs.add(`${pathNodeIds[i + 1]}|${pathNodeIds[i]}`);
    }
  }

  layer.querySelectorAll('.scar-edge').forEach(line => {
    const key = `${line.dataset.from}|${line.dataset.to}`;
    line.classList.toggle('is-route-edge', usedPairs.has(key));
  });
}

function renderedNodePositions() {
  return [...document.querySelectorAll('.scar-node')].map(element => {
    const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(element.getAttribute('transform') || '');
    return match ? { id: element.dataset.id, x: Number(match[1]), y: Number(match[2]) } : null;
  }).filter(Boolean);
}

// Conecta os nós do caminho no layout atual e cria pequenos desvios quando
// um segmento passaria por cima de outro nó que não pertence àquele trecho.
export function getRouteRenderPoints(pathNodeIds) {
  const positions = renderedNodePositions();
  const byId = new Map(positions.map(point => [point.id, point]));
  const output = [];

  for (let index = 0; index < pathNodeIds.length - 1; index++) {
    const start = byId.get(pathNodeIds[index]);
    const end = byId.get(pathNodeIds[index + 1]);
    if (!start || !end) continue;
    if (!output.length) output.push([start.x, start.y]);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const length = Math.sqrt(lengthSquared);
    if (!length) continue;
    const normal = [-dy / length, dx / length];

    const obstacles = positions.map(point => {
      if (point.id === start.id || point.id === end.id) return null;
      const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
      if (t <= 0.06 || t >= 0.94) return null;
      const projected = [start.x + dx * t, start.y + dy * t];
      const signedDistance = (point.x - projected[0]) * normal[0] + (point.y - projected[1]) * normal[1];
      if (Math.abs(signedDistance) >= 32) return null;
      return { ...point, t, signedDistance };
    }).filter(Boolean).sort((a, b) => a.t - b.t);

    for (const obstacle of obstacles) {
      const side = obstacle.signedDistance >= 0 ? -1 : 1;
      output.push([
        clamp(obstacle.x + normal[0] * side * 38, 18, 982),
        clamp(obstacle.y + normal[1] * side * 38, 18, 682)
      ]);
    }
    output.push([end.x, end.y]);
  }
  return output;
}

export function setScarNodeState(nodeId, stateClass) {
  const g = document.querySelector(`.scar-node[data-id="${nodeId}"]`);
  if (!g) return;
  g.classList.remove('state-src', 'state-dst', 'state-path');
  if (stateClass) g.classList.add(stateClass);
}

export function clearAllScarNodeStates() {
  document.querySelectorAll('.scar-node').forEach(g => {
    g.classList.remove('state-src', 'state-dst', 'state-path');
  });
}

export function clearScarPath() {
  const layer = document.getElementById('scarPathLayer');
  if (layer) layer.innerHTML = '';
}

export function drawScarPath(points, color) {
  clearScarPath();
  const layer = document.getElementById('scarPathLayer');
  if (!layer || !points || points.length < 2) return;

  const pointsAttr = points.map(([x, y]) => `${x},${y}`).join(' ');

  [
    { width: 14, opacity: 0.15 },
    { width: 7, opacity: 0.4 },
    { width: 3.5, opacity: 0.95 }
  ].forEach(({ width, opacity }) => {
    const poly = document.createElementNS(NS, 'polyline');
    poly.setAttribute('points', pointsAttr);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', color);
    poly.setAttribute('stroke-width', width);
    poly.setAttribute('stroke-opacity', opacity);
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    layer.appendChild(poly);
  });
}

// Retângulo de preview enquanto o usuário desenha uma zona de perigo (dois
// cliques no mapa): mostra o quadrado exato que será reportado, ao vivo,
// entre o primeiro clique (âncora) e a posição atual do mouse. Passar
// `rect` como null remove o preview (cancelou ou confirmou o desenho).
export function setZonePreviewRect(rect) {
  const svg = document.getElementById('scarSvg');
  if (!svg) return;

  let el = document.getElementById('zonePreviewRect');
  if (!rect) {
    if (el) el.remove();
    return;
  }

  if (!el) {
    el = document.createElementNS(NS, 'rect');
    el.setAttribute('id', 'zonePreviewRect');
    el.setAttribute('class', 'zone-preview-rect');
    svg.appendChild(el); // por cima de tudo: último filho do svg
  }
  el.setAttribute('x', rect.x);
  el.setAttribute('y', rect.y);
  el.setAttribute('width', rect.width);
  el.setAttribute('height', rect.height);
}
