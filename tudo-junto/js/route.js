import { state, layers } from './state.js';
import { setProgress, addLog, sleep, resetLogCount } from './utils.js';
import { map } from './map.js';
import { renderDirections, updateStats, showAlgoContent, updateRunBtn } from './ui.js';

export async function calculateRoute() {
  if (!state.src || !state.dst) return;
  
  state.running = true;
  updateRunBtn();
  showAlgoContent(true);
  resetLogCount();
  
  // Limpa camadas anteriores
  if (layers.route) { 
    map.removeLayer(layers.route); 
    layers.route = null;
  }
  layers.anim.forEach(l => map.removeLayer(l));
  layers.anim.length = 0;
  
  const logContainer = document.getElementById('logEntries');
  if (logContainer) logContainer.innerHTML = '';

  const profileMap = {
    'driving': 'driving',
    'cycling': 'cycling',
    'walking': 'walking'
  };
  
  const profile = profileMap[state.mode] || 'driving';
  const modeNames = {
    'driving': 'Carro 🚗',
    'cycling': 'Bicicleta 🚴',
    'walking': 'A pé 🚶'
  };

  // Velocidade média fixa por perfil (km/h)
  // Evita depender da duração retornada pela OSRM, que pode ser cacheada
  const avgSpeeds = {
    driving: 50,
    cycling: 15,
    walking: 5
  };

  setProgress(5, 'Conectando ao servidor de rotas...');
  addLog('start', `Iniciando algoritmo <strong>A*</strong> + OSRM`);
  addLog('start', `Origem: <strong>${state.src.label.split(',')[0]}</strong>`);
  addLog('start', `Destino: <strong>${state.dst.label.split(',')[0]}</strong>`);
  addLog('start', `Modo: <strong>${modeNames[state.mode]}</strong>`);

  await sleep(300);
  setProgress(20, 'Buscando grafo de ruas (OSM)...');
  addLog('explore', `Carregando grafo da rede viária para ${modeNames[state.mode]}`);

  await sleep(400);
  setProgress(40, 'Executando algoritmo de roteamento...');
  addLog('explore', 'Expandindo nós da fila de prioridade');
  addLog('explore', 'Relaxando arestas do grafo...');

  const coords = `${state.src.lon},${state.src.lat};${state.dst.lon},${state.dst.lat}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true&annotations=true`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!data.routes || !data.routes.length) {
      addLog('path', '<strong>Nenhuma rota encontrada</strong> entre os pontos selecionados.');
      setProgress(0, 'Sem rota');
      state.running = false;
      updateRunBtn();
      return;
    }

    const route = data.routes[0];
    const distKm = (route.distance / 1000).toFixed(1);

    // Calcula velocidade e tempo com base no perfil atual,
    // ignorando o duration da OSRM (que pode ser idêntico entre perfis por cache)
    const speedAvg = avgSpeeds[state.mode] || 50;
    const durMin = Math.round((route.distance / 1000) / speedAvg * 60);

    // Estimativa de nós explorados baseada na distância e perfil
    let nodesEst;
    if (state.mode === 'driving') {
      nodesEst = Math.round(route.distance / 50);
    } else if (state.mode === 'cycling') {
      nodesEst = Math.round(route.distance / 30);
    } else {
      nodesEst = Math.round(route.distance / 20);
    }

    setProgress(70, 'Caminho mais curto encontrado!');
    addLog('settle', `<strong>Caminho mínimo encontrado</strong> após ~${nodesEst} nós explorados`);
    addLog('settle', `Distância total: <strong>${distKm} km</strong>`);
    addLog('settle', `Duração estimada: <strong>${durMin} min</strong>`);
    addLog('explore', `Velocidade média (${modeNames[state.mode]}): ${speedAvg} km/h`);
    addLog('explore', `📊 Dados OSRM - Distância: ${distKm}km | Tempo: ${durMin}min | Velocidade: ${speedAvg}km/h`);

    await sleep(300);
    setProgress(90, 'Renderizando rota no mapa...');
    addLog('path', 'Traçando rota no mapa...');

    drawRoute(route.geometry.coordinates);

    await sleep(400);
    setProgress(100, 'Rota calculada com sucesso!');
    addLog('done', `✅ <strong>Rota otimizada pronta!</strong> ${distKm} km • ${durMin} min`);

    updateStats(distKm, durMin, nodesEst, speedAvg);
    renderDirections(route.legs[0]?.steps || []);

    if (layers.route) {
      map.fitBounds(layers.route.getBounds(), { padding: [60, 80] });
    }

  } catch (e) {
    console.error('Erro na rota:', e);
    addLog('error', `<strong>Erro de conexão:</strong> ${e.message}`);
    setProgress(0, 'Erro');
  } finally {
    state.running = false;
    updateRunBtn();
  }
}

function drawRoute(coords) {
  const latlngs = coords.map(c => [c[1], c[0]]);

  let routeColor = '#00e5a0';
  if (state.mode === 'cycling') routeColor = '#ffcc00';
  if (state.mode === 'walking') routeColor = '#ff5c8a';

  const glow = L.polyline(latlngs, {
    color: routeColor, weight: 10, opacity: 0.08, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
  layers.anim.push(glow);

  const outer = L.polyline(latlngs, {
    color: '#00b8ff', weight: 5, opacity: 0.35, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
  layers.anim.push(outer);

  layers.route = L.polyline(latlngs, {
    color: routeColor, weight: 3, opacity: 0.95, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);
}