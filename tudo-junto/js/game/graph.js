// Motor de grafo genérico: não sabe nada sobre "jogo", "mapa real" ou
// qualquer domínio específico. Recebe nós/arestas no formato de
// graph-data.js e calcula o caminho de menor custo com Dijkstra de verdade
// (fila de prioridade binária real, não simulada).
//
// Reaproveitável para qualquer grafo (outro mapa de jogo, um mapa real
// modelado como grafo, uma árvore de missões, etc.) — basta passar outro
// `nodes`/`edges`.

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

function buildAdjacency(nodes, edges, allowedTypes) {
  const adj = new Map();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(edge => {
    if (allowedTypes && !allowedTypes.includes(edge.type)) return;
    if (!adj.has(edge.from) || !adj.has(edge.to)) return;
    adj.get(edge.from).push({ to: edge.to, weight: edge.weight, edge });
    adj.get(edge.to).push({ to: edge.from, weight: edge.weight, edge });
  });
  return adj;
}

/**
 * Dijkstra sobre um grafo genérico.
 *
 * @param nodes  array de {id, ...}
 * @param edges  array de {from, to, weight, type}
 * @param startId  id do nó de origem
 * @param endId    id do nó de destino
 * @param options.allowedTypes  se definido, restringe quais `edge.type`
 *   podem ser atravessados (é assim que um "modo" vira um caminho diferente)
 *
 * @returns {
 *   path: array de ids do caminho mínimo (ou null se não houver caminho),
 *   distance: custo total do caminho,
 *   visitedCount: quantos nós foram de fato finalizados pelo algoritmo,
 *   events: log real de cada passo (settle/relax), útil para visualização
 * }
 */
export function dijkstra(nodes, edges, startId, endId, { allowedTypes } = {}) {
  const adj = buildAdjacency(nodes, edges, allowedTypes);
  const dist = new Map(nodes.map(n => [n.id, Infinity]));
  const prev = new Map();
  const settled = new Set();
  const events = [];

  if (!adj.has(startId) || !adj.has(endId)) {
    return { path: null, distance: Infinity, visitedCount: 0, events };
  }

  dist.set(startId, 0);
  const heap = new MinHeap();
  heap.push({ id: startId, dist: 0 });

  while (heap.size) {
    const { id, dist: d } = heap.pop();
    if (settled.has(id)) continue;
    settled.add(id);
    events.push({ type: 'settle', node: id, dist: d });

    if (id === endId) break;

    for (const { to, weight, edge } of adj.get(id)) {
      if (settled.has(to)) continue;
      const candidate = d + weight;
      const improved = candidate < dist.get(to);
      events.push({ type: 'relax', from: id, to, edge, newDist: candidate, improved });
      if (improved) {
        dist.set(to, candidate);
        prev.set(to, id);
        heap.push({ id: to, dist: candidate });
      }
    }
  }

  if (dist.get(endId) === Infinity) {
    return { path: null, distance: Infinity, visitedCount: settled.size, events };
  }

  const path = [];
  let cur = endId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev.get(cur);
  }

  return { path, distance: dist.get(endId), visitedCount: settled.size, events };
}
