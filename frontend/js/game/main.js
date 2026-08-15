import { state } from './state.js';
import { modes } from './graph-data.js';
import { getNodes, getEdges, addSharedLocation, listSharedLocations, clearSharedLocations, CATEGORIES } from './community.js';
import { buildGraphSvg, setNodeState, clearAllNodeStates, clearPath } from './render.js';
import { renderModeTabs, renderCommunityList, updateRunBtn, showAlgoContent } from './ui.js';
import { calculateRoute } from './route.js';
import { resetLogCount } from '../utils.js';

const pickBadge = document.getElementById('pickBadge');
const mapHint = document.getElementById('mapHint');
const graphMap = document.getElementById('graphMap');

// Modo de compartilhamento ativo ('recurso' | 'seguro' | null) e o ponto do
// mapa já escolhido, aguardando confirmação do nome no formulário.
let shareCategory = null;
let sharePoint = null;

function resetAlgoUI() {
  showAlgoContent(false);
  clearPath();
  resetLogCount();
}

function setPickMode(mode) {
  if (mode) closeShareCompose();
  state.pickMode = mode;
  const graphMapEl = document.getElementById('graphMap');
  if (mode) {
    const txt = mode === 'src' ? 'SRC // SELECIONE UM NÓ DE ORIGEM' : 'DST // SELECIONE UM NÓ DE DESTINO';
    if (pickBadge) { pickBadge.textContent = txt; pickBadge.classList.add('visible'); }
    if (graphMapEl) graphMapEl.style.cursor = 'crosshair';
  } else {
    if (pickBadge) pickBadge.classList.remove('visible');
    if (graphMapEl) graphMapEl.style.cursor = '';
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
  buildGraphSvg(graphMap, getNodes(), getEdges());
  updateHudReadouts();
  // buildGraphSvg troca o SVG inteiro — reaplica os destaques de
  // origem/destino que só existem como classes no DOM antigo.
  if (state.src) setNodeState(state.src.id, 'state-src');
  if (state.dst) setNodeState(state.dst.id, 'state-dst');
}

function updateHudReadouts() {
  const nodes = getNodes();
  const edges = getEdges();
  const activeMode = modes.find(mode => mode.id === state.mode) || modes[0];
  const count = document.getElementById('hudGraphCount');
  const mode = document.getElementById('hudMode');

  if (count) count.textContent = `${String(nodes.length).padStart(2, '0')} / ${String(edges.length).padStart(2, '0')}`;
  if (mode) mode.textContent = `MODO: ${activeMode.label.toUpperCase()}`;
}

function refreshCommunityList() {
  renderCommunityList(listSharedLocations(), (id) => selectNode(id));
}

function assign(type, node) {
  const prev = state[type];
  if (prev) setNodeState(prev.id, null);

  state[type] = { id: node.id, label: node.label };
  setNodeState(node.id, type === 'src' ? 'state-src' : 'state-dst');

  const input = document.getElementById(type + 'Input');
  if (input) input.value = node.label;

  updateRunBtn();
  resetAlgoUI();
}

function clearPoint(type) {
  if (state[type]) setNodeState(state[type].id, null);
  state[type] = null;
  const input = document.getElementById(type + 'Input');
  if (input) input.value = '';
  updateRunBtn();
  resetAlgoUI();
}

function clearAll() {
  setPickMode(null);
  closeShareCompose();
  ['src', 'dst'].forEach(type => { state[type] = null; });
  clearAllNodeStates();
  const srcInput = document.getElementById('srcInput');
  const dstInput = document.getElementById('dstInput');
  if (srcInput) srcInput.value = '';
  if (dstInput) dstInput.value = '';
  updateRunBtn();
  resetAlgoUI();
}

function selectNode(id) {
  const node = getNodes().find(n => n.id === id);
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
    // Origem e destino já definidos: recomeça a partir deste nó.
    if (state.dst) setNodeState(state.dst.id, null);
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
    if (q.length < 1) { sug.style.display = 'none'; return; }

    const results = getNodes().filter(n => n.label.toLowerCase().includes(q)).slice(0, 8);
    if (!results.length) { sug.style.display = 'none'; return; }

    sug.innerHTML = results.map(n => `
      <div class="suggestion-item" data-id="${n.id}">
        <div class="sug-name">${n.label}</div>
      </div>
    `).join('');
    sug.style.display = 'block';

    sug.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('click', () => {
        assign(type, getNodes().find(n => n.id === el.dataset.id));
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
      t.setAttribute('aria-pressed', String(t.dataset.mode === modeId));
    });
    updateHudReadouts();
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
    toggle.setAttribute('aria-label', 'Recolher painel de controle');
  }
  function closePanel() {
    panel.classList.add('panel-closed');
    panel.classList.remove('panel-open');
    toggle.classList.remove('is-open');
    overlay?.classList.remove('visible');
    floatingBar?.classList.remove('hidden');
    toggle.setAttribute('aria-label', 'Abrir painel de controle');
  }

  toggle.addEventListener('click', () => {
    panel.classList.contains('panel-open') ? closePanel() : openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  overlay?.addEventListener('click', closePanel);

  if (window.innerWidth >= 768) openPanel();
}

// ── Compartilhamento com a comunidade ──

function svgPointFromEvent(e) {
  const svg = document.getElementById('graphSvg');
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

  const meta = CATEGORIES[category];
  if (title) title.textContent = `${meta.icon} Nomear ${meta.label.toLowerCase()}`;
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
  if (mapHint) mapHint.classList.remove('visible');
}

function confirmShare() {
  if (!shareCategory || !sharePoint) return;
  const input = document.getElementById('shareLabelInput');
  const label = input ? input.value.trim() : '';

  addSharedLocation({ label, category: shareCategory, x: sharePoint.x, y: sharePoint.y });

  closeShareCompose();
  rebuildGraph();
  refreshCommunityList();
  showHint('[OK] Local compartilhado com a comunidade', 2500);
}

function startShareMode(category) {
  if (state.running) return;
  setPickMode(null);
  shareCategory = category;
  sharePoint = null;
  showHint('Clique no mapa para posicionar o local', 99999);
}

// ── Bootstrap ──
buildGraphSvg(graphMap, getNodes(), getEdges());
updateHudReadouts();

graphMap.addEventListener('click', (e) => {
  if (shareCategory && !sharePoint) {
    const point = svgPointFromEvent(e);
    if (point) openShareCompose(shareCategory, point);
    return;
  }

  const nodeEl = e.target.closest('.graph-node');
  if (!nodeEl) return;
  selectNode(nodeEl.dataset.id);
});

initModeTabs();
initPanelToggle();
setupSearch('srcInput', 'srcSug', 'src');
setupSearch('dstInput', 'dstSug', 'dst');
refreshCommunityList();

document.getElementById('runBtn').onclick = () => {
  if (!state.src || !state.dst || state.running) return;
  calculateRoute();
};

document.getElementById('swapBtn').onclick = () => {
  if (state.running) return;
  const srcNode = state.src;
  const dstNode = state.dst;
  clearAllNodeStates();
  state.src = dstNode;
  state.dst = srcNode;
  if (state.src) setNodeState(state.src.id, 'state-src');
  if (state.dst) setNodeState(state.dst.id, 'state-dst');

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

document.getElementById('communityClearBtn')?.addEventListener('click', () => {
  if (!confirm('Remover todos os locais compartilhados pela comunidade neste navegador?')) return;
  clearSharedLocations();
  clearAll();
  rebuildGraph();
  refreshCommunityList();
});

showHint('Clique em dois nós do grafo (ou busque pelo nome) para definir origem e destino', 4500);
