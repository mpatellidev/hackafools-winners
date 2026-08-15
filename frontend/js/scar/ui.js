import { state } from './state.js';

export const MODES = [
  { id: 'survival', label: 'Sobrevivência', icon: '🛡️', color: '#00e5a0' },
  { id: 'direct', label: 'Direto', icon: '🎯', color: '#ff5c8a' }
];

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

export function renderModeTabs() {
  const panelWrap = document.getElementById('modeTabs');
  const floatWrap = document.getElementById('floatingModeBar');

  const panelHtml = MODES.map((m, i) =>
    `<button class="mode-tab${i === 0 ? ' active' : ''}" data-mode="${m.id}">${m.icon} ${m.label}</button>`
  ).join('');
  const floatHtml = MODES.map((m, i) =>
    `<button class="float-mode-tab${i === 0 ? ' active' : ''}" data-mode="${m.id}">${m.icon}</button>`
  ).join('');

  if (panelWrap) panelWrap.innerHTML = panelHtml;
  if (floatWrap) floatWrap.innerHTML = floatHtml;
}

export function updateStats(props) {
  const distEl = document.getElementById('statDist');
  const dangerEl = document.getElementById('statDanger');
  const fuelEl = document.getElementById('statFuel');
  const survEl = document.getElementById('statSurvival');

  if (distEl) distEl.innerHTML = `${props.total_distance_km}<span class="stat-unit">km</span>`;
  if (dangerEl) dangerEl.innerHTML = `${props.total_danger_score}<span class="stat-unit">pts</span>`;
  if (fuelEl) fuelEl.innerHTML = `${props.estimated_fuel_liters}<span class="stat-unit">L</span>`;
  if (survEl) survEl.innerHTML = `${props.survival_probability}<span class="stat-unit">%</span>`;
}

export function renderRouteSteps(pathNodeIds, nodes, edges) {
  const container = document.getElementById('routeSteps');
  if (!container) return;

  const html = pathNodeIds.map((id, i) => {
    const n = nodes.find(x => x.id === id);
    const icon = i === 0 ? '📍' : i === pathNodeIds.length - 1 ? '🎯' : '→';
    let detail = '';
    if (i > 0) {
      const prevId = pathNodeIds[i - 1];
      const e = edges.find(edge => (edge.from === prevId && edge.to === id) || (edge.from === id && edge.to === prevId));
      if (e) detail = `<div class="step-dist">+${e.distanceKm}km · perigo ${e.dangerLevel} · ${e.terrainType}</div>`;
    }
    return `<div class="route-step">
      <div class="step-icon">${icon}</div>
      <div class="step-text">${n ? n.label : id}${detail}</div>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

const COMMUNITY_ICONS = { recurso: '💧', seguro: '🛡️' };
const COMMUNITY_LABELS = { recurso: 'Recurso', seguro: 'Local Seguro' };

export function renderCommunityList(items, onSelect) {
  const list = document.getElementById('communityList');
  const count = document.getElementById('communityCount');
  if (count) count.textContent = `${items.length} compartilhado${items.length !== 1 ? 's' : ''}`;
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="community-empty">Nenhum local compartilhado ainda. Seja o primeiro!</div>';
    return;
  }

  list.innerHTML = items.map(n => `
    <div class="community-item" data-id="${n.id}">
      <div class="community-icon">${COMMUNITY_ICONS[n.category] || '📍'}</div>
      <div class="community-text">
        <div class="community-label">${n.label}</div>
        <div class="community-meta">${COMMUNITY_LABELS[n.category] || n.category}</div>
      </div>
    </div>
  `).join('');

  if (onSelect) {
    list.querySelectorAll('.community-item').forEach(el => {
      el.addEventListener('click', () => onSelect(el.dataset.id));
    });
  }
}

export function renderZoneLegend(zones) {
  const container = document.getElementById('zoneLegend');
  if (!container) return;

  if (!zones.length) {
    container.innerHTML = '<div class="community-empty">Nenhuma zona de perigo mapeada.</div>';
    return;
  }

  container.innerHTML = zones.map(z => `
    <div class="zone-legend-item">
      <div class="zone-legend-swatch zone-${z.zoneType}"></div>
      <div>
        <strong>${z.name}</strong> · ${z.threatLevel} · perigo x${z.dangerMultiplier}<br>
        <span class="zone-legend-desc">${z.description}</span>
      </div>
    </div>
  `).join('');
}
