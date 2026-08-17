import { api } from './api.js';
import { state, activeRoute } from './state.js';
import { createScene } from './map/scene.js';
import { createMap } from './map/map.js';
import {
  setLoading,
  setFormError,
  renderRouteResults,
  renderZoneList,
  renderCommunityList,
  showZoneReadout,
  showNodeReadout,
  showSegmentReadout,
  formatCoordinates
} from './ui/panel.js';
import { startTour, startResultsTour, initOnboarding } from './ui/onboarding.js';

let scene = null;
let mapController = null;
let noticeTimer = null;

const inputs = {
  origin: document.getElementById('originInput'),
  destination: document.getElementById('destinationInput')
};

function notice(message, { error = false, persistent = false } = {}) {
  const output = document.getElementById('mapNotice');
  window.clearTimeout(noticeTimer);
  output.textContent = message;
  output.classList.toggle('is-error', error);
  output.hidden = !message;
  if (message && !persistent) noticeTimer = window.setTimeout(() => { output.hidden = true; }, 3400);
}

function setSystemStatus(ok) {
  const status = document.getElementById('systemStatus');
  status.textContent = ok ? 'OPERACIONAL' : 'DEGRADADO';
  document.querySelector('.status-lamp')?.classList.toggle('is-error', !ok);
}

function syncTimestamp(date = new Date()) {
  document.getElementById('lastSync').textContent = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function updateFormState() {
  const sameLocation = state.origin && state.destination && state.origin.id === state.destination.id;
  const ready = Boolean(state.origin && state.destination && !sameLocation);
  const button = document.getElementById('calculateRoute');
  button.dataset.ready = String(ready);
  button.disabled = state.loading || !ready;
  setFormError(sameLocation ? 'Origem e destino precisam ser setores diferentes.' : '');
  mapController?.setSelection(state.origin?.id, state.destination?.id);
}

function clearResults() {
  state.routes = [];
  state.activeRouteId = null;
  mapController?.drawRoute(null);
  renderRouteResults([], null, scene || { nodes: [] }, () => {}, () => {});
}

function focusSegment(segment) {
  mapController?.focusSegment(segment.geometry.coordinates.map(scene.project));
  showSegmentReadout(segment, scene);
  if (window.innerWidth < 761) closePanel();
}

function assignPoint(type, node) {
  state[type] = node;
  inputs[type].value = node.label;
  inputs[type].setAttribute('aria-expanded', 'false');
  document.getElementById(`${type}Suggestions`).hidden = true;
  state.pickMode = null;
  document.getElementById(type === 'origin' ? 'pickOrigin' : 'pickDestination').classList.remove('is-active');
  clearResults();
  updateFormState();
}

function clearPoint(type) {
  state[type] = null;
  inputs[type].value = '';
  clearResults();
  updateFormState();
}

function chooseNode(node) {
  if (state.pickMode) {
    const type = state.pickMode;
    assignPoint(type, node);
    notice(`${type === 'origin' ? 'Origem' : 'Destino'} definido: ${node.label}`);
    return;
  }
  if (!state.origin) assignPoint('origin', node);
  else if (!state.destination) assignPoint('destination', node);
  else assignPoint('origin', node);
  showNodeReadout(node);
}

function setPickMode(type) {
  state.placement = null;
  mapController?.setSonarPreview(null, null);
  state.pickMode = state.pickMode === type ? null : type;
  document.getElementById('pickOrigin').classList.toggle('is-active', state.pickMode === 'origin');
  document.getElementById('pickDestination').classList.toggle('is-active', state.pickMode === 'destination');
  notice(state.pickMode ? `SELEÇÃO ATIVA // escolha no mapa o ${type === 'origin' ? 'setor de origem' : 'setor de destino'}.` : 'Seleção pelo mapa cancelada.', { persistent: Boolean(state.pickMode) });
}

function renderSuggestions(type, query) {
  const list = document.getElementById(`${type}Suggestions`);
  const input = inputs[type];
  const normalized = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!normalized || !scene) {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  const results = scene.nodes.filter((node) => node.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalized)).slice(0, 7);
  list.replaceChildren(...results.map((node) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.setAttribute('role', 'option');
    const label = document.createElement('span');
    label.textContent = node.label;
    const risk = document.createElement('small');
    risk.textContent = `PERIGO ${node.dangerLevel}/5`;
    button.append(label, risk);
    button.addEventListener('click', () => assignPoint(type, node));
    return button;
  }));
  list.hidden = !results.length;
  input.setAttribute('aria-expanded', String(Boolean(results.length)));
}

function activeRouteChanged(routeId) {
  state.activeRouteId = routeId;
  renderRouteResults(state.routes, routeId, scene, activeRouteChanged, focusSegment);
  mapController.drawRoute(activeRoute());
}

async function calculateRoutes() {
  if (!state.origin || !state.destination || state.loading) return;
  if (state.origin.id === state.destination.id) {
    setFormError('Origem e destino precisam ser setores diferentes.');
    return;
  }
  state.loading = true;
  setLoading(true);
  setFormError('');
  notice('ANALISANDO CORREDORES // distância, terreno e zonas de risco.', { persistent: true });
  try {
    const result = await api.routes(state.origin.id, state.destination.id);
    state.routes = result.routes;
    state.activeRouteId = result.recommendedRouteId || result.routes[0]?.id;
    renderRouteResults(state.routes, state.activeRouteId, scene, activeRouteChanged, focusSegment);
    mapController.drawRoute(activeRoute());
    notice(`${result.routes.length} ${result.routes.length === 1 ? 'corredor válido encontrado' : 'corredores válidos encontrados'}.`);
    if (window.innerWidth < 761) openPanel();
    window.setTimeout(() => startResultsTour(), 450);
  } catch (error) {
    console.error('Route calculation failed:', error);
    clearResults();
    setFormError(error.message);
    notice(`ROTA INDISPONÍVEL // ${error.message}`, { error: true, persistent: true });
  } finally {
    state.loading = false;
    setLoading(false);
    updateFormState();
  }
}

function showZone(zone) {
  showZoneReadout(zone);
  mapController?.focusZone(zone);
  if (window.innerWidth < 761) closePanel();
}

function mapCallbacks() {
  return {
    onNode: (node) => {
      if (state.placement) return;
      chooseNode(node);
    },
    onZone: (zone) => {
      if (!state.placement) showZone(zone);
    },
    onPointer: (coordinates) => {
      document.getElementById('mapCoordinates').textContent = formatCoordinates(coordinates);
    },
    onPlacementMove: (point) => {
      if (state.placement?.kind === 'sonar' && state.placement.centerPoint && !state.placement.edgePoint) {
        mapController.setSonarPreview(state.placement.centerPoint, point, document.getElementById('zoneThreat').value);
      }
    },
    onMap: ({ point, coordinates }) => handleMapPlacement(point, coordinates)
  };
}

async function refreshScene() {
  const layers = await api.layers();
  scene = createScene(layers);
  mapController?.destroy?.();
  mapController = createMap(document.getElementById('mapCanvas'), scene, mapCallbacks());
  document.getElementById('mapCanvas').setAttribute('aria-busy', 'false');
  renderZoneList(scene.zones, showZone);
  renderCommunityList(scene.nodes, showNodeReadout);
  updateFormState();
  syncTimestamp();
}

function handleMapPlacement(point, coordinates) {
  const placement = state.placement;
  if (!placement) return;
  if (placement.kind === 'community') {
    placement.point = coordinates;
    document.getElementById('communityCompose').hidden = false;
    document.getElementById('communityName').focus();
    notice('Ponto capturado. Identifique o local no painel.', { persistent: true });
    if (window.innerWidth < 761) openPanel();
    return;
  }
  if (placement.kind === 'sonar') {
    if (!placement.centerPoint) {
      placement.centerPoint = point;
      placement.center = coordinates;
      notice('CENTRO DO SONAR FIXADO // marque o limite do alcance.', { persistent: true });
    } else if (!placement.edgePoint) {
      placement.edgePoint = point;
      placement.edge = coordinates;
      mapController.setSonarPreview(placement.centerPoint, placement.edgePoint, document.getElementById('zoneThreat').value);
      document.getElementById('zoneCompose').hidden = false;
      document.getElementById('zoneName').focus();
      notice('ALCANCE DEFINIDO // identifique a zona de perigo no painel.', { persistent: true });
      if (window.innerWidth < 761) openPanel();
    }
  }
}

function cancelPlacement() {
  state.placement = null;
  mapController?.setSonarPreview(null, null);
  document.getElementById('communityCompose').hidden = true;
  document.getElementById('zoneCompose').hidden = true;
  notice('Registro cancelado.');
}

async function saveCommunity() {
  const placement = state.placement;
  const name = document.getElementById('communityName').value.trim();
  if (placement?.kind !== 'community' || !placement.point) return;
  if (!name) { notice('Informe uma identificação para o ponto.', { error: true }); return; }
  const button = document.getElementById('saveCommunity');
  button.disabled = true;
  try {
    await api.addCommunityNode(name, placement.category, placement.point[0], placement.point[1]);
    document.getElementById('communityName').value = '';
    cancelPlacement();
    clearResults();
    await refreshScene();
    notice('PONTO REGISTRADO // o grafo local foi atualizado.');
  } catch (error) {
    console.error('Community point failed:', error);
    notice(`REGISTRO RECUSADO // ${error.message}`, { error: true, persistent: true });
  } finally { button.disabled = false; }
}

async function saveSonar() {
  const placement = state.placement;
  const name = document.getElementById('zoneName').value.trim();
  if (placement?.kind !== 'sonar' || !placement.center || !placement.edge) return;
  if (!name) { notice('Informe uma identificação para a zona de perigo.', { error: true }); return; }
  const button = document.getElementById('saveZone');
  button.disabled = true;
  try {
    await api.addSonar(
      name,
      document.getElementById('zoneDescription').value.trim(),
      document.getElementById('zoneThreat').value,
      placement.center,
      placement.edge
    );
    document.getElementById('zoneName').value = '';
    document.getElementById('zoneDescription').value = '';
    cancelPlacement();
    clearResults();
    await refreshScene();
    notice('SONAR REGISTRADO // as chances de sobrevivência foram recalculadas.');
  } catch (error) {
    console.error('Sonar report failed:', error);
    notice(`RELATO RECUSADO // ${error.message}`, { error: true, persistent: true });
  } finally { button.disabled = false; }
}

function openPanel() {
  const panel = document.getElementById('routePanel');
  const scrim = document.getElementById('panelScrim');
  panel.classList.add('is-open');
  scrim.hidden = false;
  document.getElementById('mobilePanelToggle').setAttribute('aria-expanded', 'true');
}

function closePanel() {
  document.getElementById('routePanel').classList.remove('is-open');
  document.getElementById('panelScrim').hidden = true;
  document.getElementById('mobilePanelToggle').setAttribute('aria-expanded', 'false');
}

function wireInterface() {
  ['origin', 'destination'].forEach((type) => {
    inputs[type].addEventListener('input', () => {
      if (state[type] && inputs[type].value !== state[type].label) {
        state[type] = null;
        clearResults();
        updateFormState();
      }
      renderSuggestions(type, inputs[type].value);
    });
    inputs[type].addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.getElementById(`${type}Suggestions`).hidden = true;
        inputs[type].setAttribute('aria-expanded', 'false');
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        document.querySelector(`#${type}Suggestions .suggestion`)?.focus();
      }
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.location-field')) {
      document.querySelectorAll('.suggestions').forEach((list) => { list.hidden = true; });
      Object.values(inputs).forEach((input) => input.setAttribute('aria-expanded', 'false'));
    }
  });

  document.getElementById('pickOrigin').addEventListener('click', () => setPickMode('origin'));
  document.getElementById('pickDestination').addEventListener('click', () => setPickMode('destination'));
  document.getElementById('clearOrigin').addEventListener('click', () => clearPoint('origin'));
  document.getElementById('clearDestination').addEventListener('click', () => clearPoint('destination'));
  document.getElementById('swapRoute').addEventListener('click', () => {
    [state.origin, state.destination] = [state.destination, state.origin];
    [inputs.origin.value, inputs.destination.value] = [inputs.destination.value, inputs.origin.value];
    clearResults();
    updateFormState();
  });
  document.getElementById('routeForm').addEventListener('submit', (event) => { event.preventDefault(); calculateRoutes(); });
  document.getElementById('clearRoute').addEventListener('click', () => {
    state.origin = null;
    state.destination = null;
    inputs.origin.value = '';
    inputs.destination.value = '';
    clearResults();
    updateFormState();
    notice('Trajeto limpo.');
  });

  document.getElementById('zoomIn').addEventListener('click', () => mapController?.zoomIn());
  document.getElementById('zoomOut').addEventListener('click', () => mapController?.zoomOut());
  document.getElementById('zoomReset').addEventListener('click', () => mapController?.resetView());
  document.getElementById('closeReadout').addEventListener('click', () => {
    document.getElementById('sectorReadout').hidden = true;
    mapController?.clearFocus();
  });
  document.getElementById('mobilePanelToggle').addEventListener('click', openPanel);
  document.getElementById('panelClose').addEventListener('click', closePanel);
  document.getElementById('panelScrim').addEventListener('click', closePanel);

  document.querySelectorAll('[data-community]').forEach((button) => button.addEventListener('click', () => {
    state.pickMode = null;
    state.placement = { kind: 'community', category: button.dataset.community, point: null };
    document.getElementById('communityCompose').hidden = true;
    notice('REGISTRO COMUNITÁRIO // clique no mapa para posicionar o ponto.', { persistent: true });
    if (window.innerWidth < 761) closePanel();
  }));
  document.getElementById('cancelCommunity').addEventListener('click', cancelPlacement);
  document.getElementById('saveCommunity').addEventListener('click', saveCommunity);
  document.getElementById('communityName').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveCommunity();
    if (event.key === 'Escape') cancelPlacement();
  });

  document.getElementById('startZoneReport').addEventListener('click', () => {
    state.pickMode = null;
    state.placement = { kind: 'sonar', centerPoint: null, edgePoint: null, center: null, edge: null };
    document.getElementById('zoneCompose').hidden = true;
    notice('ZONA DE PERIGO // clique no centro do novo sonar.', { persistent: true });
    if (window.innerWidth < 761) closePanel();
  });
  document.getElementById('cancelZone').addEventListener('click', cancelPlacement);
  document.getElementById('saveZone').addEventListener('click', saveSonar);
  document.getElementById('zoneThreat').addEventListener('change', (event) => {
    const placement = state.placement;
    if (placement?.kind === 'sonar' && placement.centerPoint && placement.edgePoint) {
      mapController.setSonarPreview(placement.centerPoint, placement.edgePoint, event.target.value);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.placement) cancelPlacement();
  });
}

async function bootstrap() {
  wireInterface();
  initOnboarding();
  try {
    const [health] = await Promise.all([api.health(), refreshScene()]);
    setSystemStatus(health.status === 'operational');
    syncTimestamp(new Date(health.updatedAt));
    notice('MAPA PRONTO // selecione origem e destino.');
    window.setTimeout(() => startTour(), 500);
  } catch (error) {
    console.error('DustNav bootstrap failed:', error);
    setSystemStatus(false);
    document.getElementById('mapLoading').innerHTML = '<strong>CARTOGRAFIA INDISPONÍVEL</strong><small>O núcleo local não forneceu dados válidos. Consulte o console para diagnóstico.</small>';
    notice(`FALHA DE INICIALIZAÇÃO // ${error.message}`, { error: true, persistent: true });
  }
}

bootstrap();
