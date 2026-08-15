import { state, markers, layers } from './state.js';
import { map } from './map.js';
import { calculateRoute } from './route.js';
import { makeIcon } from './markers.js';
import { resetLogCount } from './utils.js';

export function updateRunBtn() {
  const btn = document.getElementById('runBtn');
  if (btn) {
    btn.disabled = !(state.src && state.dst) || state.running;
  }
}

export function showAlgoContent(show) {
  const idle = document.getElementById('idleState');
  const content = document.getElementById('algoContent');
  if (idle && content) {
    idle.style.display = show ? 'none' : 'flex';
    content.style.display = show ? 'block' : 'none';
  }
}

export function resetAlgoUI() {
  showAlgoContent(false);
  if (layers.route) {
    map.removeLayer(layers.route);
    layers.route = null;
  }
  layers.anim.forEach(l => map.removeLayer(l));
  layers.anim.length = 0;
  resetLogCount();
}

export function updateStats(dist, time, nodes, speed) {
  const distEl = document.getElementById('statDist');
  const timeEl = document.getElementById('statTime');
  const nodesEl = document.getElementById('statNodes');
  const speedEl = document.getElementById('statSpeed');
  
  if (distEl) distEl.innerHTML = `${dist}<span class="stat-unit">km</span>`;
  if (timeEl) timeEl.innerHTML = `${time}<span class="stat-unit">min</span>`;
  if (nodesEl) nodesEl.textContent = nodes;
  if (speedEl) speedEl.innerHTML = `${speed}<span class="stat-unit">km/h</span>`;
}

export function renderDirections(steps) {
  const container = document.getElementById('routeSteps');
  if (!container) return;
  
  const icons = {
    'turn-left': '↰', 'turn-right': '↱', 'turn-slight-left': '↖',
    'turn-slight-right': '↗', 'turn-sharp-left': '↺', 'turn-sharp-right': '↻',
    'roundabout': '⭕', 'arrive': '🎯', 'depart': '📍', 'straight': '⬆',
    'merge': '⤵', 'on ramp': '↗', 'off ramp': '↘', 'fork': '⑂',
    'end of road': '⬛', 'notification': 'ℹ', 'rotary': '♻'
  };

  const relevant = steps.filter(s => s.maneuver);
  const html = relevant.slice(0, 12).map(s => {
    const type = s.maneuver?.type || '';
    const modifier = s.maneuver?.modifier || '';
    const key = modifier ? `${type}-${modifier}` : type;
    const icon = icons[key] || icons[type] || '→';
    const dist = s.distance > 1000 ? `${(s.distance/1000).toFixed(1)} km` : `${Math.round(s.distance)} m`;
    const name = s.name || 'Continuar';
    return `<div class="route-step">
      <div class="step-icon">${icon}</div>
      <div class="step-text">
        ${name}
        <div class="step-dist">${dist}</div>
      </div>
    </div>`;
  }).join('');
  
  container.innerHTML = html || '<div class="route-step"><div class="step-icon">→</div><div class="step-text">Siga em frente</div></div>';
}

function clearPoint(type) {
  if (markers[type]) {
    map.removeLayer(markers[type]);
    markers[type] = null;
  }
  state[type] = null;
  const input = document.getElementById(type + 'Input');
  if (input) input.value = '';
  updateRunBtn();
  resetAlgoUI();
}

export function initUI() {
  // Botão principal
  document.getElementById('runBtn').onclick = () => {
    if (!state.src || !state.dst || state.running) return;
    calculateRoute();
  };

  // Swap
  document.getElementById('swapBtn').onclick = () => {
    if (state.running) return;
    
    // Troca state
    [state.src, state.dst] = [state.dst, state.src];
    [markers.src, markers.dst] = [markers.dst, markers.src];
    
    // Atualiza ícones
    if (markers.src) markers.src.setIcon(makeIcon('#00b8ff', 'A'));
    if (markers.dst) markers.dst.setIcon(makeIcon('#ff5c8a', 'B'));
    
    // Troca inputs
    const srcInput = document.getElementById('srcInput');
    const dstInput = document.getElementById('dstInput');
    if (srcInput && dstInput) {
      [srcInput.value, dstInput.value] = [dstInput.value, srcInput.value];
    }
    
    updateRunBtn();
    resetAlgoUI();
  };

  // Limpar campos individuais
  document.getElementById('srcClear').onclick = () => clearPoint('src');
  document.getElementById('dstClear').onclick = () => clearPoint('dst');
  
  // Modos
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.onclick = () => {
      if (state.running) return;
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mode = tab.dataset.mode;
      resetAlgoUI();
    };
  });
}