function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function metric(label, value) {
  const wrapper = element('div');
  wrapper.append(element('dt', '', label), element('dd', '', value));
  return wrapper;
}

export function setLoading(isLoading) {
  const button = document.getElementById('calculateRoute');
  button.disabled = isLoading || button.dataset.ready !== 'true';
  button.querySelector('.button-label').hidden = isLoading;
  button.querySelector('.button-loading').hidden = !isLoading;
  button.setAttribute('aria-busy', String(isLoading));
}

export function setFormError(message = '') {
  const error = document.getElementById('formError');
  error.textContent = message;
  error.hidden = !message;
}

export function renderRouteResults(routes, activeRouteId, scene, onSelectRoute, onSelectSegment) {
  const section = document.getElementById('routeResults');
  const options = document.getElementById('routeOptions');
  const idle = document.getElementById('idleGuidance');
  const activeRoute = routes.find((route) => route.id === activeRouteId) || routes[0];
  section.hidden = !activeRoute;
  idle.hidden = Boolean(activeRoute);
  if (!activeRoute) return;

  document.getElementById('routeCount').textContent = `${routes.length} ${routes.length === 1 ? 'ROTA' : 'ROTAS'}`;
  options.replaceChildren(...routes.map((route) => {
    const button = element('button', `route-option${route.id === activeRoute.id ? ' is-active' : ''}`);
    button.type = 'button';
    button.dataset.routeId = route.id;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-pressed', String(route.id === activeRoute.id));
    const heading = element('span');
    heading.append(element('strong', '', route.label), element('small', '', route.description));
    button.append(heading, element('b', '', `${route.summary.survivalProbability}%`), element('span', '', `${route.summary.distanceKm} KM`));
    button.addEventListener('click', () => onSelectRoute(route.id));
    return button;
  }));

  const summary = activeRoute.summary;
  document.getElementById('survivalValue').textContent = `${summary.survivalProbability}%`;
  const stamp = document.getElementById('riskStamp');
  stamp.textContent = summary.riskLabel;
  stamp.dataset.risk = summary.riskLevel;
  const metrics = document.getElementById('routeMetrics');
  metrics.replaceChildren(
    metric('DISTÂNCIA', `${summary.distanceKm} KM`),
    metric('TEMPO', `${summary.timeMinutes} MIN`),
    metric('EXPOSIÇÃO', summary.exposure),
    metric('SONARES', String(summary.sonarsCrossed || 0)),
    metric('ZONAS CRÍTICAS', String(summary.criticalZones)),
    metric('PONTOS DE APOIO', String(summary.supportPoints)),
    metric('COMBUSTÍVEL', `${summary.fuelLiters} L`)
  );

  const breakdown = document.getElementById('riskBreakdown');
  breakdown.replaceChildren(...activeRoute.riskBreakdown.map((entry) => {
    const row = element('div', `risk-entry is-${entry.kind}`);
    const signal = entry.kind === 'risk' ? `+${entry.points}` : entry.kind === 'safety' ? `−${entry.points}` : 'INFO';
    const copy = element('div');
    copy.append(element('strong', '', entry.title), element('small', '', entry.detail));
    row.append(element('b', '', signal), copy);
    return row;
  }));

  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
  const segmentList = document.getElementById('segmentList');
  segmentList.replaceChildren(...activeRoute.segments.map((segment, index) => {
    const item = element('li');
    const button = element('button', 'segment-item');
    button.type = 'button';
    const copy = element('div');
    const destination = nodesById.get(segment.to)?.label || segment.to;
    copy.append(
      element('strong', '', destination),
      element('small', '', `${segment.distanceKm} km · ${segment.terrainLabel} · perigo ${segment.dangerLevel}/5`)
    );
    button.append(
      element('span', 'segment-index', String(index + 1).padStart(2, '0')),
      copy,
      element('span', `segment-risk risk-${segment.riskLevel}`, segment.riskLabel.replace('RISCO ', ''))
    );
    button.addEventListener('click', () => onSelectSegment(segment));
    item.append(button);
    return item;
  }));
}

export function renderZoneList(zones, onSelect) {
  const list = document.getElementById('zoneList');
  list.replaceChildren(...zones.map((zone) => {
    const button = element('button', `zone-item ${zone.threatLevel.replace('_', '-')}`);
    button.type = 'button';
    const copy = element('span');
    copy.append(element('strong', '', zone.name), element('small', '', zone.description));
    button.append(
      element('i', 'zone-symbol'),
      copy,
      element('em', '', { tier_1: 'CAUTELA', tier_2: 'HOSTIL', tier_3: 'CRÍTICO' }[zone.threatLevel] || 'INCERTO')
    );
    button.addEventListener('click', () => onSelect(zone));
    return button;
  }));
}

export function renderCommunityList(nodes, onSelect) {
  const list = document.getElementById('communityList');
  const community = nodes.filter((node) => node.community);
  if (!community.length) {
    list.replaceChildren(element('p', 'section-note', 'Nenhum ponto comunitário registrado.'));
    return;
  }
  list.replaceChildren(...community.map((node) => {
    const button = element('button', 'community-item');
    button.type = 'button';
    button.append(element('strong', '', node.label), element('small', '', node.type === 'seguro' ? 'ABRIGO / BÔNUS DE SEGURANÇA' : node.type.toUpperCase()));
    button.addEventListener('click', () => onSelect(node));
    return button;
  }));
}

export function showZoneReadout(zone) {
  const readout = document.getElementById('sectorReadout');
  document.getElementById('readoutEyebrow').textContent = 'ZONA SELECIONADA';
  document.getElementById('readoutTitle').textContent = zone.name;
  const body = document.getElementById('readoutBody');
  const threat = { tier_1: 'CAUTELA', tier_2: 'HOSTIL', tier_3: 'CRÍTICA' }[zone.threatLevel] || 'INCERTA';
  const description = element('p', '', zone.description || 'Sem relato associado.');
  const details = element('dl');
  details.append(
    element('dt', '', 'AMEAÇA'), element('dd', '', threat),
    element('dt', '', 'MULTIPLICADOR'), element('dd', '', `×${zone.dangerMultiplier}`),
    element('dt', '', 'TIPO'), element('dd', '', zone.zoneType.replaceAll('_', ' ').toUpperCase()),
    element('dt', '', 'RECOMENDAÇÃO'), element('dd', '', zone.threatLevel === 'tier_3' ? 'EVITAR' : 'REDUZIR EXPOSIÇÃO')
  );
  body.replaceChildren(description, details);
  readout.hidden = false;
}

export function showNodeReadout(node) {
  const readout = document.getElementById('sectorReadout');
  document.getElementById('readoutEyebrow').textContent = 'SETOR SELECIONADO';
  document.getElementById('readoutTitle').textContent = node.label;
  const body = document.getElementById('readoutBody');
  const description = element('p', '', node.description || 'Sem relato associado.');
  const details = element('dl');
  details.append(element('dt', '', 'AMEAÇA'), element('dd', '', `${node.dangerLevel}/5`));
  if (node.resources) {
    details.append(
      element('dt', '', 'ÁGUA'), element('dd', '', `${node.resources.water}/100`),
      element('dt', '', 'COMBUSTÍVEL'), element('dd', '', `${node.resources.fuel}/100`),
      element('dt', '', 'ESTABILIDADE'), element('dd', '', `${node.resources.thermal_stability}/100`)
    );
  }
  body.replaceChildren(description, details);
  readout.hidden = false;
}

export function showSegmentReadout(segment, scene) {
  const readout = document.getElementById('sectorReadout');
  const nodesById = new Map(scene.nodes.map((node) => [node.id, node]));
  const originLabel = nodesById.get(segment.from)?.label || segment.from;
  const destinationLabel = nodesById.get(segment.to)?.label || segment.to;
  document.getElementById('readoutEyebrow').textContent = 'TRECHO SELECIONADO';
  document.getElementById('readoutTitle').textContent = `${originLabel} → ${destinationLabel}`;
  const body = document.getElementById('readoutBody');
  const description = element('p', '', segment.description || 'Sem relato associado a este trecho.');
  const details = element('dl');
  details.append(
    element('dt', '', 'RISCO'), element('dd', '', segment.riskLabel.replace('RISCO ', '')),
    element('dt', '', 'DISTÂNCIA'), element('dd', '', `${segment.distanceKm} km`),
    element('dt', '', 'TEMPO'), element('dd', '', `${segment.timeMinutes} min`),
    element('dt', '', 'TERRENO'), element('dd', '', segment.terrainLabel.toUpperCase()),
    element('dt', '', 'PERIGO'), element('dd', '', `${segment.dangerLevel}/5`),
    element('dt', '', 'SOBREVIVÊNCIA'), element('dd', '', `${segment.survivalProbability}%`)
  );
  const threats = [...segment.zones.map((zone) => zone.name), ...segment.sonars.map((sonar) => sonar.name)];
  if (threats.length) details.append(element('dt', '', 'EXPOSIÇÃO A'), element('dd', '', threats.join(' · ')));
  body.replaceChildren(description, details);
  readout.hidden = false;
}

export function formatCoordinates([lon, lat]) {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'} / ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;
}
