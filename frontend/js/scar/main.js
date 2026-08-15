import { state } from './state.js';
import { fetchLayers, fetchRoute, createCommunityNode, createDangerZone } from './api.js';
import { buildScene } from './geo.js';
import { buildScarSvg, setScarNodeState, clearAllScarNodeStates, clearScarPath, drawScarPath, setZonePreviewRect } from './render.js';
import { renderModeTabs, updateRunBtn, showAlgoContent, updateStats, renderRouteSteps, renderZoneLegend, renderCommunityList, MODES } from './ui.js';
import { setProgress, addLog, sleep, resetLogCount } from '../utils.js';

const pickBadge = document.getElementById('pickBadge');
const mapHint = document.getElementById('mapHint');
const mapEl = document.getElementById('scarMap');
const idleSub = document.querySelector('#idleState .idle-sub');

// Preenchida no bootstrap() (e de novo em refreshScene()) a partir da API
// real: { nodes, edges, zones, project, unproject }
let scene = null;

// Modo de compartilhamento ativo ('recurso' | 'seguro' | null) e o ponto do
// mapa já escolhido, aguardando confirmação do nome no formulário.
let shareCategory = null;
let sharePoint = null;

// Fluxo de reportar zona de perigo: nível escolhido, compose aberto, e os
// dois cantos (em px do viewBox) que definem o retângulo da área, na ordem
// em que o usuário clica no mapa.
let zoneReportOpen = false;
let zoneTier = null;
let zoneCorner1 = null;
let zoneCorner2 = null;

function resetAlgoUI() {
  showAlgoContent(false);
  clearScarPath();
  resetLogCount();
}

function setPickMode(mode) {
  if (mode) { closeShareCompose(); closeZoneCompose(); }
  state.pickMode = mode;
  if (mode) {
    const txt = mode === 'src' ? '📍 Clique num ponto: ORIGEM' : '🎯 Clique num ponto: DESTINO';
    if (pickBadge) { pickBadge.textContent = txt; pickBadge.classList.add('visible'); }
    if (mapEl) mapEl.style.cursor = 'crosshair';
  } else {
    if (pickBadge) pickBadge.classList.remove('visible');
    if (mapEl) mapEl.style.cursor = '';
  }
}

function showHint(msg, ms) {
  if (!mapHint) return;
  mapHint.textContent = msg;
  mapHint.classList.add('visible');
  if (ms && ms < 9999) {
    setTimeout(() => mapHint && mapHint.classList.remove('visible'), ms);
  }
}

function rebuildGraph() {
  buildScarSvg(mapEl, scene.nodes, scene.edges, scene.zones);
  // buildScarSvg troca o SVG inteiro — reaplica os destaques de
  // origem/destino que só existem como classes no DOM antigo.
  if (state.src) setScarNodeState(state.src.id, 'state-src');
  if (state.dst) setScarNodeState(state.dst.id, 'state-dst');
}

function refreshCommunityList() {
  renderCommunityList(scene.nodes.filter(n => n.isCommunity), (id) => selectNode(id));
}

function assign(type, node) {
  const prev = state[type];
  if (prev) setScarNodeState(prev.id, null);

  state[type] = { id: node.id, label: node.label };
  setScarNodeState(node.id, type === 'src' ? 'state-src' : 'state-dst');

  const input = document.getElementById(type + 'Input');
  if (input) input.value = node.label;

  updateRunBtn();
  resetAlgoUI();
}

function clearPoint(type) {
  if (state[type]) setScarNodeState(state[type].id, null);
  state[type] = null;
  const input = document.getElementById(type + 'Input');
  if (input) input.value = '';
  updateRunBtn();
  resetAlgoUI();
}

function clearAll() {
  setPickMode(null);
  closeShareCompose();
  closeZoneCompose();
  ['src', 'dst'].forEach(type => { state[type] = null; });
  clearAllScarNodeStates();
  const srcInput = document.getElementById('srcInput');
  const dstInput = document.getElementById('dstInput');
  if (srcInput) srcInput.value = '';
  if (dstInput) dstInput.value = '';
  updateRunBtn();
  resetAlgoUI();
}

function selectNode(id) {
  if (!scene) return;
  const node = scene.nodes.find(n => n.id === id);
  if (!node) return;

  if (state.pickMode) {
    assign(state.pickMode, node);
    setPickMode(null);
    return;
  }

  if (!state.src) {
    assign('src', node);
  } else if (!state.dst && node.id !== state.src.id) {
    assign('dst', node);
  } else {
    if (state.dst) setScarNodeState(state.dst.id, null);
    state.dst = null;
    assign('src', node);
  }
}

function setupSearch(inputId, sugId, type) {
  const input = document.getElementById(inputId);
  const sug = document.getElementById(sugId);
  const group = document.getElementById(inputId.replace('Input', 'Group'));
  if (!input || !sug) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1 || !scene) { sug.style.display = 'none'; return; }

    const results = scene.nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 8);
    if (!results.length) { sug.style.display = 'none'; return; }

    sug.innerHTML = results.map(n => `
      <div class="suggestion-item" data-id="${n.id}">
        <div class="sug-name">${n.label}</div>
      </div>
    `).join('');
    sug.style.display = 'block';

    sug.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('click', () => {
        assign(type, scene.nodes.find(n => n.id === el.dataset.id));
        sug.style.display = 'none';
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (group && !e.target.closest(`#${group.id}`)) sug.style.display = 'none';
  });
}

function initModeTabs() {
  renderModeTabs();

  function activate(modeId) {
    if (state.running) return;
    state.mode = modeId;
    document.querySelectorAll('.mode-tab, .float-mode-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === modeId);
    });
    resetAlgoUI();
  }

  document.querySelectorAll('.mode-tab, .float-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => activate(tab.dataset.mode));
  });
}

function initPanelToggle() {
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panelToggle');
  const overlay = document.getElementById('panelOverlay');
  const closeBtn = document.getElementById('panelCloseBtn');
  const floatingBar = document.getElementById('floatingModeBar');
  if (!panel || !toggle) return;

  function openPanel() {
    panel.classList.remove('panel-closed');
    panel.classList.add('panel-open');
    toggle.classList.add('is-open');
    overlay?.classList.add('visible');
    floatingBar?.classList.add('hidden');
  }
  function closePanel() {
    panel.classList.add('panel-closed');
    panel.classList.remove('panel-open');
    toggle.classList.remove('is-open');
    overlay?.classList.remove('visible');
    floatingBar?.classList.remove('hidden');
  }

  toggle.addEventListener('click', () => {
    panel.classList.contains('panel-open') ? closePanel() : openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  overlay?.addEventListener('click', closePanel);

  if (window.innerWidth >= 768) openPanel();
}

// ── Compartilhamento com a comunidade ──
//
// Ao contrário do modo fantasia (localStorage, só no navegador), aqui o
// local vira um nó de verdade no motor de rotas do backend: o servidor liga
// ele aos POIs reais mais próximos e ele passa a valer como origem/destino
// pra qualquer cálculo de rota, pra qualquer pessoa que acessar o app.

function svgPointFromEvent(e) {
  const svg = document.getElementById('scarSvg');
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;

  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const local = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(local.x), y: Math.round(local.y) };
}

function openShareCompose(category, point) {
  const compose = document.getElementById('shareCompose');
  const title = document.getElementById('shareComposeTitle');
  const input = document.getElementById('shareLabelInput');
  if (!compose) return;

  shareCategory = category;
  sharePoint = point;

  const meta = category === 'recurso' ? { icon: '💧', label: 'recurso' } : { icon: '🛡️', label: 'local seguro' };
  if (title) title.textContent = `${meta.icon} Nomear ${meta.label}`;
  if (input) input.value = '';
  compose.style.display = 'flex';
  if (input) input.focus();
  showHint('Confirme o nome do local no painel ao lado', 99999);
}

function closeShareCompose() {
  shareCategory = null;
  sharePoint = null;
  const compose = document.getElementById('shareCompose');
  if (compose) compose.style.display = 'none';
  const confirmBtn = document.getElementById('shareConfirmBtn');
  if (confirmBtn) confirmBtn.disabled = false;
  if (mapHint) mapHint.classList.remove('visible');
}

function mergeCommunityResult(result) {
  const props = result.node.properties;
  const [x, y] = scene.project(result.node.geometry.coordinates);

  scene.nodes.push({
    id: props.id,
    label: props.name,
    x, y,
    type: props.type,
    isCommunity: true,
    category: props.type,
    dangerLevel: props.danger_level ?? 0,
    description: props.description || '',
    resources: null
  });

  (result.edges || []).forEach(f => {
    const p = f.properties;
    scene.edges.push({
      id: p.id,
      from: p.source_node,
      to: p.target_node,
      distanceKm: p.distance_km,
      dangerLevel: p.danger_level ?? 0,
      terrainType: p.terrain_type,
      description: p.description || ''
    });
  });

  rebuildGraph();
  refreshCommunityList();
}

async function confirmShare() {
  if (!shareCategory || !sharePoint || !scene) return;

  const input = document.getElementById('shareLabelInput');
  const label = (input ? input.value.trim() : '') ||
    (shareCategory === 'recurso' ? 'Recurso' : 'Local Seguro');
  const [lon, lat] = scene.unproject([sharePoint.x, sharePoint.y]);

  const confirmBtn = document.getElementById('shareConfirmBtn');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const result = await createCommunityNode(label, shareCategory, lon, lat);
    mergeCommunityResult(result);
    closeShareCompose();
    showHint('✅ Local compartilhado com a comunidade!', 2500);
  } catch (err) {
    showHint(`❌ Falha ao compartilhar: ${err.message}`, 3500);
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function startShareMode(category) {
  if (state.running || !scene) return;
  setPickMode(null);
  closeZoneCompose();
  shareCategory = category;
  sharePoint = null;
  showHint('Clique no mapa para posicionar o local', 99999);
}

// ── Reportar zona de perigo ──
//
// Mesma ideia do compartilhamento de recurso/local seguro, só que em vez de
// um ponto, a comunidade reporta uma área: dois cliques no mapa definem os
// cantos opostos de um retângulo, que o backend converte no mesmo formato
// Polygon de data/zones.geojson e usa pra recalcular na hora o peso das
// arestas que passam por dentro.

function updateZoneComposeTitle(text) {
  const title = document.getElementById('zoneComposeTitle');
  if (title) title.textContent = text;
}

function rectFromCorners(c1, c2) {
  return {
    x: Math.min(c1.x, c2.x),
    y: Math.min(c1.y, c2.y),
    width: Math.abs(c2.x - c1.x),
    height: Math.abs(c2.y - c1.y)
  };
}

function openZoneReport() {
  if (state.running || !scene) return;
  setPickMode(null);
  closeShareCompose();

  zoneReportOpen = true;
  zoneTier = null;
  zoneCorner1 = null;
  zoneCorner2 = null;
  setZonePreviewRect(null);

  const compose = document.getElementById('zoneCompose');
  const tierRow = document.getElementById('zoneTierRow');
  const nameInput = document.getElementById('zoneNameInput');
  const descInput = document.getElementById('zoneDescInput');
  const confirmBtn = document.getElementById('zoneConfirmBtn');

  if (compose) compose.style.display = 'flex';
  if (tierRow) tierRow.style.display = 'flex';
  document.querySelectorAll('.zone-tier-btn').forEach(b => b.classList.remove('active'));
  if (nameInput) { nameInput.style.display = 'none'; nameInput.value = ''; }
  if (descInput) { descInput.style.display = 'none'; descInput.value = ''; }
  if (confirmBtn) confirmBtn.style.display = 'none';

  updateZoneComposeTitle('Escolha o nível de perigo');
}

function closeZoneCompose() {
  zoneReportOpen = false;
  zoneTier = null;
  zoneCorner1 = null;
  zoneCorner2 = null;
  setZonePreviewRect(null);
  const compose = document.getElementById('zoneCompose');
  if (compose) compose.style.display = 'none';
  if (mapHint) mapHint.classList.remove('visible');
}

function pickZoneTier(tier) {
  zoneTier = tier;
  document.querySelectorAll('.zone-tier-btn').forEach(b => b.classList.toggle('active', b.dataset.tier === tier));
  updateZoneComposeTitle('Clique no mapa: primeiro canto da área');
  showHint('Clique no mapa: primeiro canto da área de perigo', 99999);
}

function showZoneStepName() {
  const tierRow = document.getElementById('zoneTierRow');
  const nameInput = document.getElementById('zoneNameInput');
  const descInput = document.getElementById('zoneDescInput');
  const confirmBtn = document.getElementById('zoneConfirmBtn');

  if (tierRow) tierRow.style.display = 'none';
  if (nameInput) nameInput.style.display = 'block';
  if (descInput) descInput.style.display = 'block';
  if (confirmBtn) confirmBtn.style.display = 'block';

  updateZoneComposeTitle('Nomeie a área reportada');
  showHint('Confirme os detalhes no painel ao lado', 99999);
  if (nameInput) nameInput.focus();
}

async function refreshScene() {
  const layers = await fetchLayers();
  scene = buildScene(layers.nodes, layers.edges, layers.zones);
  buildScarSvg(mapEl, scene.nodes, scene.edges, scene.zones);
  renderZoneLegend(scene.zones);
  refreshCommunityList();
  if (state.src) setScarNodeState(state.src.id, 'state-src');
  if (state.dst) setScarNodeState(state.dst.id, 'state-dst');
}

async function confirmZoneReport() {
  if (!zoneTier || !zoneCorner1 || !zoneCorner2 || !scene) return;

  const nameInput = document.getElementById('zoneNameInput');
  const descInput = document.getElementById('zoneDescInput');
  const confirmBtn = document.getElementById('zoneConfirmBtn');

  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    showHint('Dê um nome pra área antes de reportar', 2500);
    nameInput?.focus();
    return;
  }
  const description = descInput ? descInput.value.trim() : '';
  const corner1LonLat = scene.unproject([zoneCorner1.x, zoneCorner1.y]);
  const corner2LonLat = scene.unproject([zoneCorner2.x, zoneCorner2.y]);

  if (confirmBtn) confirmBtn.disabled = true;
  try {
    await createDangerZone(name, description, zoneTier, corner1LonLat, corner2LonLat);
    await refreshScene();
    closeZoneCompose();
    showHint('✅ Zona de perigo reportada!', 2500);
  } catch (err) {
    showHint(`❌ Falha ao reportar zona: ${err.message}`, 3500);
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function runCalculation() {
  if (!state.src || !state.dst || state.running || !scene) return;

  state.running = true;
  updateRunBtn();
  showAlgoContent(true);
  resetLogCount();
  clearScarPath();
  clearAllScarNodeStates();
  if (state.src) setScarNodeState(state.src.id, 'state-src');
  if (state.dst) setScarNodeState(state.dst.id, 'state-dst');

  const modeCfg = MODES.find(m => m.id === state.mode) || MODES[0];

  setProgress(10, 'Conectando à API S.C.A.R....');
  addLog('start', `Origem: <strong>${state.src.label}</strong>`);
  addLog('start', `Destino: <strong>${state.dst.label}</strong>`);
  addLog('start', `Modo: <strong>${modeCfg.icon} ${modeCfg.label}</strong>`);

  await sleep(150);
  setProgress(35, 'Executando Dijkstra real no backend...');
  addLog('explore', 'Backend pesando cada trecho por terreno, perigo e zonas de risco');

  try {
    const result = await fetchRoute(state.src.id, state.dst.id, state.mode);
    const props = result.properties;

    await sleep(150);
    setProgress(80, 'Traçando rota no mapa...');
    addLog('path', 'Desenhando caminho retornado pela API...');

    const points = (result.geometry?.coordinates || []).map(scene.project);
    drawScarPath(points, modeCfg.color);

    props.path_nodes.forEach(id => {
      if (id === state.src.id) setScarNodeState(id, 'state-src');
      else if (id === state.dst.id) setScarNodeState(id, 'state-dst');
      else setScarNodeState(id, 'state-path');
    });

    setProgress(100, 'Rota calculada!');
    addLog('done', `✅ <strong>Rota encontrada</strong> · ${props.total_distance_km}km · perigo ${props.total_danger_score} · sobrevivência ${props.survival_probability}%`);

    updateStats(props);
    renderRouteSteps(props.path_nodes, scene.nodes, scene.edges);
  } catch (err) {
    addLog('path', `❌ <strong>Falha ao calcular rota:</strong> ${err.message}`);
    setProgress(0, 'Sem rota');
  }

  state.running = false;
  updateRunBtn();
}

async function bootstrap() {
  initModeTabs();
  initPanelToggle();
  setupSearch('srcInput', 'srcSug', 'src');
  setupSearch('dstInput', 'dstSug', 'dst');
  updateRunBtn();

  try {
    const layers = await fetchLayers();
    scene = buildScene(layers.nodes, layers.edges, layers.zones);
    buildScarSvg(mapEl, scene.nodes, scene.edges, scene.zones);
    renderZoneLegend(scene.zones);
    refreshCommunityList();

    mapEl.addEventListener('click', (e) => {
      if (zoneReportOpen && zoneTier && !zoneCorner2) {
        const point = svgPointFromEvent(e);
        if (!point) return;
        if (!zoneCorner1) {
          zoneCorner1 = point;
          setZonePreviewRect(rectFromCorners(zoneCorner1, point));
          updateZoneComposeTitle('Clique no mapa: canto oposto da área');
          showHint('Clique no canto oposto da área de perigo', 99999);
        } else {
          zoneCorner2 = point;
          setZonePreviewRect(rectFromCorners(zoneCorner1, zoneCorner2));
          showZoneStepName();
        }
        return;
      }

      if (shareCategory && !sharePoint) {
        const point = svgPointFromEvent(e);
        if (point) openShareCompose(shareCategory, point);
        return;
      }

      const nodeEl = e.target.closest('.scar-node');
      if (!nodeEl) return;
      selectNode(nodeEl.dataset.id);
    });

    mapEl.addEventListener('mousemove', (e) => {
      if (!(zoneReportOpen && zoneTier && zoneCorner1 && !zoneCorner2)) return;
      const point = svgPointFromEvent(e);
      if (!point) return;
      setZonePreviewRect(rectFromCorners(zoneCorner1, point));
    });

    showHint('Clique em dois pontos do mapa real (ou busque pelo nome) para calcular a rota', 5000);
  } catch (err) {
    if (idleSub) {
      idleSub.innerHTML = `⚠️ Não foi possível carregar o mapa real.<br>
        Verifique se o servidor está rodando (<code>node server.js</code> dentro de <code>backend/</code>).<br>
        <small>${err.message}</small>`;
    }
    showHint('Backend indisponível — veja as instruções no painel', 6000);
  }
}

document.getElementById('runBtn').onclick = runCalculation;

document.getElementById('swapBtn').onclick = () => {
  if (state.running) return;
  const srcNode = state.src;
  const dstNode = state.dst;
  clearAllScarNodeStates();
  state.src = dstNode;
  state.dst = srcNode;
  if (state.src) setScarNodeState(state.src.id, 'state-src');
  if (state.dst) setScarNodeState(state.dst.id, 'state-dst');

  const srcInput = document.getElementById('srcInput');
  const dstInput = document.getElementById('dstInput');
  if (srcInput && dstInput) [srcInput.value, dstInput.value] = [dstInput.value, srcInput.value];

  updateRunBtn();
  resetAlgoUI();
};

document.getElementById('srcClear').onclick = () => clearPoint('src');
document.getElementById('dstClear').onclick = () => clearPoint('dst');
document.getElementById('clearBtn').onclick = clearAll;

document.getElementById('pickSrcBtn').onclick = () => {
  setPickMode(state.pickMode === 'src' ? null : 'src');
};
document.getElementById('pickDstBtn').onclick = () => {
  setPickMode(state.pickMode === 'dst' ? null : 'dst');
};

document.getElementById('shareResourceBtn').onclick = () => startShareMode('recurso');
document.getElementById('shareSafeBtn').onclick = () => startShareMode('seguro');
document.getElementById('shareCancelBtn').onclick = closeShareCompose;
document.getElementById('shareConfirmBtn').onclick = confirmShare;

document.getElementById('shareLabelInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmShare();
  if (e.key === 'Escape') closeShareCompose();
});

document.getElementById('zoneReportBtn').onclick = openZoneReport;
document.getElementById('zoneCancelBtn').onclick = closeZoneCompose;
document.getElementById('zoneConfirmBtn').onclick = confirmZoneReport;

document.querySelectorAll('.zone-tier-btn').forEach(btn => {
  btn.addEventListener('click', () => pickZoneTier(btn.dataset.tier));
});

document.getElementById('zoneNameInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmZoneReport();
  if (e.key === 'Escape') closeZoneCompose();
});

bootstrap();
