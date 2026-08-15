import { state } from './state.js';
import { modes } from './graph-data.js';
import { CATEGORIES } from './community.js';

export function updateRunBtn() {
  const btn = document.getElementById('runBtn');
  if (btn) btn.disabled = !(state.src && state.dst) || state.running;
}

export function showAlgoContent(show) {
  const idle = document.getElementById('idleState');
  const content = document.getElementById('algoContent');
  if (idle && content) {
    idle.style.display = show ? 'none' : 'flex';
    content.style.display = show ? 'block' : 'none';
  }
}

export function updateStats(distance, timeMin, nodesExplored, steps) {
  const distEl = document.getElementById('statDist');
  const timeEl = document.getElementById('statTime');
  const nodesEl = document.getElementById('statNodes');
  const speedEl = document.getElementById('statSpeed');

  if (distEl) distEl.innerHTML = `${distance}<span class="stat-unit">un</span>`;
  if (timeEl) timeEl.innerHTML = `${timeMin}<span class="stat-unit">min</span>`;
  if (nodesEl) nodesEl.textContent = nodesExplored;
  if (speedEl) speedEl.innerHTML = `${steps}<span class="stat-unit">trechos</span>`;
}

export function renderDirections(pathNodes) {
  const container = document.getElementById('routeSteps');
  if (!container) return;

  const html = pathNodes.map((n, i) => {
    const icon = i === 0 ? 'SRC' : i === pathNodes.length - 1 ? 'DST' : '→';
    const detail = n.edgeWeight != null
      ? `<div class="step-dist">+${n.edgeWeight} (${n.edgeType})</div>`
      : '';
    return `<div class="route-step">
      <div class="step-icon">${icon}</div>
      <div class="step-text">${n.label}${detail}</div>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

export function renderCommunityList(items, onSelect) {
  const list = document.getElementById('communityList');
  const count = document.getElementById('communityCount');
  if (count) count.textContent = `${items.length} compartilhado${items.length !== 1 ? 's' : ''}`;
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="community-empty">Nenhum local compartilhado ainda. Seja o primeiro!</div>';
    return;
  }

  list.innerHTML = items.map(n => {
    const meta = CATEGORIES[n.category];
    return `<div class="community-item" data-id="${n.id}">
      <div class="community-icon">${meta ? meta.icon : '📍'}</div>
      <div class="community-text">
        <div class="community-label">${n.label}</div>
        <div class="community-meta">${meta ? meta.label : ''} · #${n.requestId}</div>
      </div>
    </div>`;
  }).join('');

  if (onSelect) {
    list.querySelectorAll('.community-item').forEach(el => {
      el.addEventListener('click', () => onSelect(el.dataset.id));
    });
  }
}

export function renderModeTabs() {
  const panelWrap = document.getElementById('modeTabs');
  const floatWrap = document.getElementById('floatingModeBar');

  const panelHtml = modes.map((m, i) =>
    `<button class="mode-tab${i === 0 ? ' active' : ''}" data-mode="${m.id}" aria-pressed="${i === 0}">${m.icon} ${m.label}</button>`
  ).join('');
  const floatHtml = modes.map((m, i) =>
    `<button class="float-mode-tab${i === 0 ? ' active' : ''}" data-mode="${m.id}" aria-label="${m.label}" aria-pressed="${i === 0}">${m.icon}</button>`
  ).join('');

  if (panelWrap) panelWrap.innerHTML = panelHtml;
  if (floatWrap) floatWrap.innerHTML = floatHtml;
}
