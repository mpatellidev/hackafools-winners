import { state } from './state.js';
import { modes } from './graph-data.js';
import { getNodes, getEdges } from './community.js';
import { dijkstra } from './graph.js';
import { setProgress, addLog, sleep, resetLogCount } from '../utils.js';
import { drawPath, clearPath, clearNodeStates, setNodeState } from './render.js';
import { updateStats, renderDirections, showAlgoContent, setAnalysisDockOpen, updateRunBtn } from './ui.js';

export async function calculateRoute() {
  if (!state.src || !state.dst) return;

  // Recalcula a cada rota: assim locais compartilhados pela comunidade
  // depois do carregamento da página já entram na busca.
  const nodes = getNodes();
  const edges = getEdges();

  state.running = true;
  updateRunBtn();
  showAlgoContent(true);
  resetLogCount();
  clearPath();
  clearNodeStates();

  const logContainer = document.getElementById('logEntries');
  if (logContainer) logContainer.innerHTML = '';

  const modeCfg = modes.find(m => m.id === state.mode) || modes[0];

  setProgress(5, 'Preparando grafo...');
  addLog('start', `Iniciando <strong>Dijkstra</strong> sobre o grafo do mapa`);
  addLog('start', `Origem: <strong>${state.src.label}</strong>`);
  addLog('start', `Destino: <strong>${state.dst.label}</strong>`);
  addLog('start', `Modo: <strong>${modeCfg.icon} ${modeCfg.label}</strong> (arestas permitidas: ${modeCfg.allowedTypes.join(', ')})`);

  await sleep(250);
  setProgress(20, 'Construindo lista de adjacência...');
  addLog('explore', 'Filtrando arestas conforme o modo selecionado');

  // Esta é a parte "de verdade": Dijkstra real (fila de prioridade),
  // sem chamada a nenhuma API externa. O resultado inclui um log real
  // de cada nó finalizado e cada aresta relaxada.
  const result = dijkstra(nodes, edges, state.src.id, state.dst.id, {
    allowedTypes: modeCfg.allowedTypes
  });

  setProgress(35, 'Executando Dijkstra...');

  const total = result.events.length || 1;
  let i = 0;
  for (const ev of result.events) {
    i++;
    const pct = 35 + Math.round((i / total) * 45);

    if (ev.type === 'settle') {
      const n = nodes.find(x => x.id === ev.node);
      setNodeState(ev.node, 'state-settled');
      addLog('settle', `Nó <strong>${n?.label || ev.node}</strong> finalizado — custo acumulado ${ev.dist}`);
    } else if (ev.type === 'relax' && ev.improved) {
      const a = nodes.find(x => x.id === ev.from);
      const b = nodes.find(x => x.id === ev.to);
      setNodeState(ev.to, 'state-visited');
      addLog('explore', `Aresta <strong>${a?.label} → ${b?.label}</strong> relaxada (novo custo ${ev.newDist})`);
    }

    setProgress(Math.min(pct, 80), 'Executando Dijkstra...');
    if (i % 3 === 0) await sleep(35);
  }

  if (!result.path) {
    addLog('path', `<strong>Nenhum caminho encontrado</strong> para o modo ${modeCfg.label} — talvez as arestas permitidas não conectem origem e destino.`);
    setProgress(0, 'Sem rota');
    state.running = false;
    updateRunBtn();
    setAnalysisDockOpen(true, false, state.src.id);
    return;
  }

  await sleep(200);
  setProgress(90, 'Traçando caminho no mapa...');
  addLog('path', 'Desenhando caminho mínimo...');

  const pathNodes = result.path.map((id, idx) => {
    const n = nodes.find(x => x.id === id);
    let edgeWeight = null;
    let edgeType = null;
    if (idx > 0) {
      const prevId = result.path[idx - 1];
      const e = edges.find(e =>
        (e.from === prevId && e.to === id) || (e.from === id && e.to === prevId)
      );
      if (e) { edgeWeight = e.weight; edgeType = e.type; }
    }
    return { ...n, edgeWeight, edgeType };
  });

  drawPath(result.path, modeCfg.color, nodes);
  result.path.forEach(id => {
    if (id === state.src.id) setNodeState(id, 'state-src');
    else if (id === state.dst.id) setNodeState(id, 'state-dst');
    else setNodeState(id, 'state-path');
  });

  const timeMin = Math.round(result.distance * modeCfg.timePerUnit);

  await sleep(200);
  setProgress(100, 'Caminho mais curto encontrado!');
  addLog('done', `[OK] <strong>Caminho ótimo encontrado!</strong> custo ${result.distance} · ${pathNodes.length - 1} trechos · ${result.visitedCount} nós explorados`);

  updateStats(result.distance, timeMin, result.visitedCount, pathNodes.length - 1);
  renderDirections(pathNodes);
  setAnalysisDockOpen(true, true, state.src.id);

  state.running = false;
  updateRunBtn();
}
