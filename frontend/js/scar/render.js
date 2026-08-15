// Desenho SVG do mapa real do wasteland. Irmão de ../game/render.js, mas
// adaptado pro formato vindo de geo.js (nós com danger_level/type reais e
// zonas de perigo poligonais) — não compartilha estado com o grafo de
// fantasia, então nada do modo antigo é tocado.

import { TYPE_ICONS, dangerBucket } from './geo.js';

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

// Espaço mínimo (px do viewBox) entre o contorno do blob e o círculo de
// qualquer nó (raio 15 + margem) — é o que evita a ambiguidade de "esse nó
// está dentro ou fora da zona?".
const NODE_CLEARANCE = 28;

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

export function buildScarSvg(container, nodes, edges, zones) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 700');
  svg.setAttribute('id', 'scarSvg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const zoneLayer = document.createElementNS(NS, 'g');
  zoneLayer.setAttribute('id', 'zoneLayer');
  const edgeLayer = document.createElementNS(NS, 'g');
  edgeLayer.setAttribute('id', 'scarEdgeLayer');
  const pathLayer = document.createElementNS(NS, 'g');
  pathLayer.setAttribute('id', 'scarPathLayer');
  const nodeLayer = document.createElementNS(NS, 'g');
  nodeLayer.setAttribute('id', 'scarNodeLayer');

  zones.forEach(z => {
    const path = document.createElementNS(NS, 'path');
    // Um pouco maior que o raio real: dá a sensação de uma nuvem/território
    // que "vaza" um pouco além da área estrita mapeada em zones.geojson.
    path.setAttribute('d', organicBlobPath(z.center, z.radius * 1.1, z.id || z.name, z.nodeAvoidance));
    path.setAttribute('class', `danger-zone zone-${z.zoneType}`);

    const title = document.createElementNS(NS, 'title');
    title.textContent = `${z.name} · ${z.threatLevel} · multiplicador x${z.dangerMultiplier}`;
    path.appendChild(title);

    zoneLayer.appendChild(path);
  });

  edges.forEach(e => {
    const a = nodes.find(n => n.id === e.from);
    const b = nodes.find(n => n.id === e.to);
    if (!a || !b) return;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    line.setAttribute('class', `scar-edge danger-${dangerBucket(e.dangerLevel)}`);
    // Usados por setRouteEdges pra saber quais linhas pertencem ao caminho
    // calculado — só essas ficam visíveis (ver comentário em setRouteEdges).
    line.dataset.from = e.from;
    line.dataset.to = e.to;
    line.style.display = 'none';

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
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', 15);
    circle.setAttribute('class', 'scar-node-circle');

    const icon = document.createElementNS(NS, 'text');
    icon.setAttribute('class', 'scar-node-icon');
    icon.setAttribute('y', 5);
    icon.textContent = TYPE_ICONS[n.type] || '📍';

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('class', 'scar-node-label');
    label.setAttribute('y', 31);
    label.textContent = n.label;

    const resourceTxt = n.resources
      ? `\nÁgua ${n.resources.water} · Combustível ${n.resources.fuel} · Sucata ${n.resources.scrap}`
      : '';
    const communityTxt = n.isCommunity ? '\n(compartilhado pela comunidade)' : '';

    g.appendChild(circle);
    g.appendChild(icon);
    g.appendChild(label);

    nodeLayer.appendChild(g);
  });

  svg.appendChild(zoneLayer);
  svg.appendChild(edgeLayer);
  svg.appendChild(pathLayer);
  svg.appendChild(nodeLayer);

  container.innerHTML = '';
  container.appendChild(svg);
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
    line.style.display = usedPairs.has(key) ? '' : 'none';
  });
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
