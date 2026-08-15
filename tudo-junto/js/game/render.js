// Desenho do grafo em SVG. Não sabe nada sobre Dijkstra nem sobre o painel —
// só sabe desenhar nós/arestas e pintar estados (origem, destino, visitado,
// caminho final). Consome `nodes`/`edges` de graph-data.js, então também
// muda sozinho se o mapa mudar.

import { nodes, edges } from './graph-data.js';

const NS = 'http://www.w3.org/2000/svg';

export function buildGraphSvg(container) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 700');
  svg.setAttribute('id', 'graphSvg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const edgeLayer = document.createElementNS(NS, 'g');
  edgeLayer.setAttribute('id', 'edgeLayer');
  const pathLayer = document.createElementNS(NS, 'g');
  pathLayer.setAttribute('id', 'pathLayer');
  const nodeLayer = document.createElementNS(NS, 'g');
  nodeLayer.setAttribute('id', 'nodeLayer');

  edges.forEach(e => {
    const a = nodes.find(n => n.id === e.from);
    const b = nodes.find(n => n.id === e.to);
    if (!a || !b) return;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    line.setAttribute('class', `graph-edge type-${e.type}`);

    const title = document.createElementNS(NS, 'title');
    title.textContent = `${a.label} ↔ ${b.label} · peso ${e.weight} · ${e.type}`;
    line.appendChild(title);

    edgeLayer.appendChild(line);
  });

  nodes.forEach(n => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'graph-node');
    g.setAttribute('data-id', n.id);
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', 14);
    circle.setAttribute('class', 'node-circle');

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('class', 'node-label');
    label.setAttribute('y', 28);
    label.textContent = n.label;

    g.appendChild(circle);
    g.appendChild(label);
    nodeLayer.appendChild(g);
  });

  svg.appendChild(edgeLayer);
  svg.appendChild(pathLayer);
  svg.appendChild(nodeLayer);

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}

export function setNodeState(nodeId, stateClass) {
  const g = document.querySelector(`.graph-node[data-id="${nodeId}"]`);
  if (!g) return;
  g.classList.remove('state-src', 'state-dst', 'state-visited', 'state-settled', 'state-path');
  if (stateClass) g.classList.add(stateClass);
}

export function clearNodeStates() {
  document.querySelectorAll('.graph-node').forEach(g => {
    g.classList.remove('state-visited', 'state-settled', 'state-path');
  });
}

export function clearAllNodeStates() {
  document.querySelectorAll('.graph-node').forEach(g => {
    g.classList.remove('state-src', 'state-dst', 'state-visited', 'state-settled', 'state-path');
  });
}

export function clearPath() {
  const layer = document.getElementById('pathLayer');
  if (layer) layer.innerHTML = '';
}

export function drawPath(pathNodeIds, color) {
  clearPath();
  const layer = document.getElementById('pathLayer');
  if (!layer || pathNodeIds.length < 2) return;

  const points = pathNodeIds
    .map(id => nodes.find(n => n.id === id))
    .filter(Boolean)
    .map(p => `${p.x},${p.y}`)
    .join(' ');

  // Mesma técnica de "linha com glow" usada no route.js original: três
  // traços empilhados (halo largo e translúcido → linha nítida por cima).
  [
    { width: 14, opacity: 0.15 },
    { width: 7, opacity: 0.4 },
    { width: 3.5, opacity: 0.95 }
  ].forEach(({ width, opacity }) => {
    const poly = document.createElementNS(NS, 'polyline');
    poly.setAttribute('points', points);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', color);
    poly.setAttribute('stroke-width', width);
    poly.setAttribute('stroke-opacity', opacity);
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    layer.appendChild(poly);
  });
}
