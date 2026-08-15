// Camada "comunidade": nós de grafo criados pelos próprios usuários em tempo
// real (recursos e locais seguros), em cima do grafo-base de graph-data.js.
//
// Cada envio consome o próximo valor de um contador incremental (`nextId`,
// persistido em localStorage — simula um auto-increment de banco de dados,
// já que este protótipo não tem backend). O nó novo é ligado automaticamente
// aos nós existentes mais próximos, para entrar no grafo navegável sem exigir
// que o usuário desenhe arestas manualmente.
//
// graph.js (Dijkstra) e render.js continuam sem saber nada sobre isso: eles
// só recebem `nodes`/`edges` já combinados por getNodes()/getEdges().

import { nodes as baseNodes, edges as baseEdges } from './graph-data.js';

const STORAGE_KEY = 'bestway.community.v1';

// `showBadge` controla só o selo de emoji desenhado em cima do círculo do
// nó no grafo (render.js) — o ícone continua usado nos botões/lista.
export const CATEGORIES = {
  recurso: { label: 'Recurso',       icon: '💧', edgeType: 'community', showBadge: false },
  seguro:  { label: 'Local Seguro',  icon: '🛡️', edgeType: 'community', showBadge: false },
  comum:   { label: 'Local Comum',   icon: '📌', edgeType: 'community', showBadge: true }
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nextId: 1, nodes: [], edges: [] };
    const parsed = JSON.parse(raw);
    return {
      nextId: Number.isFinite(parsed.nextId) ? parsed.nextId : 1,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : []
    };
  } catch {
    return { nextId: 1, nodes: [], edges: [] };
  }
}

const store = loadStore();

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestNodes(point, candidates, count) {
  return candidates
    .map(n => ({ node: n, dist: distance(point, n) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count);
}

export function getNodes() {
  return [...baseNodes, ...store.nodes];
}

export function getEdges() {
  return [...baseEdges, ...store.edges];
}

/**
 * Registra um novo local compartilhado pela comunidade.
 * @param {{label:string, category:'recurso'|'seguro', x:number, y:number}} input
 * @returns o nó criado
 */
export function addSharedLocation({ label, category, x, y }) {
  const meta = CATEGORIES[category];
  if (!meta) throw new Error(`Categoria desconhecida: ${category}`);

  const requestId = store.nextId;
  store.nextId += 1;

  const id = `req-${requestId}`;
  const node = {
    id,
    label: label.trim() || `${meta.label} #${requestId}`,
    x: Math.round(x),
    y: Math.round(y),
    category,
    requestId
  };
  store.nodes.push(node);

  const linkCount = getNodes().length > 1 ? 2 : 1;
  const neighbors = nearestNodes(node, [...baseNodes, ...store.nodes.filter(n => n.id !== id)], linkCount);
  neighbors.forEach(({ node: n, dist }) => {
    store.edges.push({
      from: id,
      to: n.id,
      weight: Math.max(1, Math.round(dist / 8)),
      type: meta.edgeType
    });
  });

  persist();
  return node;
}

export function listSharedLocations() {
  return [...store.nodes].sort((a, b) => b.requestId - a.requestId);
}

export function clearSharedLocations() {
  store.nodes = [];
  store.edges = [];
  persist();
}
