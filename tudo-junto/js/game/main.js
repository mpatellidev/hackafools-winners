import { state } from './state.js';
import { nodes, modes } from './graph-data.js';
import { buildGraphSvg, setNodeState, clearAllNodeStates, clearPath } from './render.js';
import { renderModeTabs, updateRunBtn, showAlgoContent } from './ui.js';
import { calculateRoute } from './route.js';
import { resetLogCount } from '../utils.js';

const pickBadge = document.getElementById('pickBadge');
const mapHint = document.getElementById('mapHint');

function resetAlgoUI() {
  showAlgoContent(false);
  clearPath();
  resetLogCount();
}

function setPickMode(mode) {
  state.pickMode = mode;
  const graphMap = document.getElementById('graphMap');
  if (mode) {
    const txt = mode === 'src' ? '📍 Clique num nó: ORIGEM' : '🎯 Clique num nó: DESTINO';
    if (pickBadge) { pickBadge.textContent = txt; pickBadge.classList.add('visible'); }
    if (graphMap) graphMap.style.cursor = 'crosshair';
  } else {
    if (pickBadge) pickBadge.classList.remove('visible');
    if (graphMap) graphMap.style.cursor = '';
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
  const node = nodes.find(n => n.id === id);
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

    const results = nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 8);
    if (!results.length) { sug.style.display = 'none'; return; }

    sug.innerHTML = results.map(n => `
      <div class="suggestion-item" data-id="${n.id}">
        <div class="sug-name">${n.label}</div>
      </div>
    `).join('');
    sug.style.display = 'block';

    sug.querySelectorAll('.suggestion-item').forEach(el => {
      el.addEventListener('click', () => {
        assign(type, nodes.find(n => n.id === el.dataset.id));
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

// ── Bootstrap ──
const graphMap = document.getElementById('graphMap');
buildGraphSvg(graphMap);

graphMap.addEventListener('click', (e) => {
  const nodeEl = e.target.closest('.graph-node');
  if (!nodeEl) return;
  selectNode(nodeEl.dataset.id);
});

initModeTabs();
initPanelToggle();
setupSearch('srcInput', 'srcSug', 'src');
setupSearch('dstInput', 'dstSug', 'dst');

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

showHint('Clique em dois nós do grafo (ou busque pelo nome) para definir origem e destino', 4500);
