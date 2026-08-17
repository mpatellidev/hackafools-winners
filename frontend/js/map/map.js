const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function pathFromPoints(points, close = false) {
  if (!points.length) return '';
  return `M ${points.map((point) => `${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' L ')}${close ? ' Z' : ''}`;
}

function circlePoints([cx, cy], radius, segments = 28) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
}

export function createMap(container, scene, callbacks = {}) {
  const svg = svgElement('svg', {
    class: 'dust-map',
    viewBox: `0 0 ${scene.width} ${scene.height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': 'Mapa com regiões, grafo de setores e alertas de risco do DustNav'
  });
  svg.appendChild(svgElement('rect', { class: 'map-base', width: scene.width, height: scene.height }));

  const regionLayer = svgElement('g', { id: 'regionLayer', 'aria-hidden': 'true' });
  scene.regions.forEach((region) => {
    regionLayer.appendChild(svgElement('path', {
      class: `map-region region-${region.index % 4}`,
      d: pathFromPoints(region.points, true)
    }));
    const center = region.points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
    if (region.points.length) {
      center[0] /= region.points.length;
      center[1] /= region.points.length;
      const label = svgElement('text', { class: 'region-label', x: center[0], y: center[1] });
      label.textContent = region.name.toUpperCase();
      regionLayer.appendChild(label);
    }
  });
  svg.appendChild(regionLayer);

  const radarLayer = svgElement('g', { id: 'radarLayer', 'aria-hidden': 'true' });
  const radarWaves = [];
  scene.zones.forEach((zone) => {
    if (!zone.radarRadius) return;
    const riskClass = `risk-${zone.sonarThreatLevel.replace('_', '-')}`;
    [0, .333, .666].forEach((phase) => {
      const wave = svgElement('circle', {
        class: `radar-wave ${riskClass}`,
        cx: zone.radarCenter[0], cy: zone.radarCenter[1], r: 0
      });
      radarLayer.appendChild(wave);
      radarWaves.push({ element: wave, radius: zone.radarRadius, phase });
    });
  });
  svg.appendChild(radarLayer);

  const edgeLayer = svgElement('g', { id: 'edgeLayer', 'aria-hidden': 'true' });
  scene.edges.forEach((edge) => edgeLayer.appendChild(svgElement('path', {
    class: `map-edge danger-${edge.dangerLevel}`,
    d: pathFromPoints(edge.points)
  })));
  svg.appendChild(edgeLayer);

  const routeLayer = svgElement('g', { id: 'routeLayer', 'aria-hidden': 'true' });
  svg.appendChild(routeLayer);

  const nodeLayer = svgElement('g', { id: 'nodeLayer' });
  scene.nodes.forEach((node, index) => {
    const group = svgElement('g', {
      class: `map-node${node.community ? ' is-community' : ''}`,
      transform: `translate(${node.x} ${node.y})`,
      'data-id': node.id,
      'data-danger': node.dangerLevel,
      tabindex: 0,
      role: 'button',
      'aria-label': `${node.label}, perigo ${node.dangerLevel} de 5`
    });
    group.appendChild(svgElement('circle', { class: 'node-hit', r: 26 }));
    group.appendChild(svgElement('circle', { class: 'node-ring', r: 11 }));
    const code = svgElement('text', { class: 'node-code', y: 3.5 });
    code.textContent = String(index + 1).padStart(2, '0');
    group.appendChild(code);
    const labelY = index % 2 ? -20 : 28;
    const label = svgElement('text', { class: 'node-label', y: labelY, 'data-base-y': labelY });
    label.textContent = node.label || node.id;
    group.appendChild(label);
    const activate = (event) => { event.stopPropagation(); callbacks.onNode?.(node); };
    group.addEventListener('click', activate);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); }
    });
    nodeLayer.appendChild(group);
  });
  svg.appendChild(nodeLayer);

  const previewLayer = svgElement('g', { id: 'previewLayer', 'aria-hidden': 'true' });
  svg.appendChild(previewLayer);

  const highlightLayer = svgElement('g', { id: 'highlightLayer', 'aria-hidden': 'true' });
  svg.appendChild(highlightLayer);
  container.replaceChildren(svg);

  let radarFrame = null;
  const animateRadar = (timestamp) => {
    radarWaves.forEach((wave) => {
      const progress = ((timestamp / 4800) + wave.phase) % 1;
      wave.element.setAttribute('r', String(Math.max(2, wave.radius * progress)));
      wave.element.setAttribute('opacity', String((1 - progress) * .92));
    });
    radarFrame = window.requestAnimationFrame(animateRadar);
  };
  radarFrame = window.requestAnimationFrame(animateRadar);

  const view = { x: 0, y: 0, width: scene.width, height: scene.height };
  let viewportRatio = scene.height / scene.width;
  let dragging = false;
  let moved = false;
  let start = null;

  function refreshViewportRatio() {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) viewportRatio = rect.height / rect.width;
  }

  function maximumViewWidth() {
    return Math.min(scene.width, scene.height / viewportRatio);
  }

  function applyView() {
    const maxWidth = maximumViewWidth();
    view.width = Math.min(maxWidth, Math.max(maxWidth * .12, view.width));
    view.height = view.width * viewportRatio;
    view.x = Math.min(scene.width - view.width, Math.max(0, view.x));
    view.y = Math.min(scene.height - view.height, Math.max(0, view.y));
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);

    // Símbolos e textos conservam tamanho de tela legível em qualquer zoom.
    const visualScale = view.width / maxWidth;
    nodeLayer.querySelectorAll('.node-hit').forEach((node) => node.setAttribute('r', String(26 * visualScale)));
    nodeLayer.querySelectorAll('.node-ring').forEach((node) => node.setAttribute('r', String(11 * visualScale)));
    nodeLayer.querySelectorAll('.node-code').forEach((node) => {
      node.setAttribute('y', String(3.5 * visualScale));
      node.style.fontSize = `${9 * visualScale}px`;
    });
    nodeLayer.querySelectorAll('.node-label').forEach((node) => {
      node.setAttribute('y', String(Number(node.dataset.baseY) * visualScale));
      node.style.fontSize = `${11 * visualScale}px`;
      node.style.strokeWidth = `${3.5 * visualScale}px`;
    });
  }

  function setInitialView() {
    refreshViewportRatio();
    const width = maximumViewWidth() * .30;
    const height = width * viewportRatio;
    const center = [scene.width * .47, scene.height * .43];
    Object.assign(view, { x: center[0] - width / 2, y: center[1] - height / 2, width, height });
    applyView();
  }

  function fitPoints(points) {
    if (!points.length) return;
    refreshViewportRatio();
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const maxView = maximumViewWidth();
    const width = Math.min(maxView, Math.max(maxView * .22, Math.max(maxX - minX, (maxY - minY) / viewportRatio) * 1.42));
    const height = width * viewportRatio;
    Object.assign(view, {
      x: (minX + maxX) / 2 - width / 2,
      y: (minY + maxY) / 2 - height / 2,
      width,
      height
    });
    applyView();
  }

  function pointFromEvent(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const local = point.matrixTransform(matrix.inverse());
    return [local.x, local.y];
  }

  function zoom(factor, event) {
    const anchor = event ? pointFromEvent(event) : [view.x + view.width / 2, view.y + view.height / 2];
    const previousWidth = view.width;
    const previousHeight = view.height;
    view.width *= factor;
    view.height = view.width * viewportRatio;
    view.x = anchor[0] - ((anchor[0] - view.x) / previousWidth) * view.width;
    view.y = anchor[1] - ((anchor[1] - view.y) / previousHeight) * view.height;
    applyView();
  }

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? .82 : 1.2, event);
  }, { passive: false });
  svg.addEventListener('dblclick', (event) => {
    event.preventDefault();
    zoom(.62, event);
  });
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.map-node')) return;
    dragging = true;
    moved = false;
    start = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
  });
  svg.addEventListener('pointermove', (event) => {
    const point = pointFromEvent(event);
    if (point) callbacks.onPointer?.(scene.unproject(point));
    if (!dragging) {
      callbacks.onPlacementMove?.(point);
      return;
    }
    const rect = svg.getBoundingClientRect();
    const dx = (event.clientX - start.clientX) * view.width / rect.width;
    const dy = (event.clientY - start.clientY) * view.height / rect.height;
    moved ||= Math.abs(event.clientX - start.clientX) > 4 || Math.abs(event.clientY - start.clientY) > 4;
    view.x = start.x - dx;
    view.y = start.y - dy;
    applyView();
  });
  const finishDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    svg.classList.remove('is-dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  };
  svg.addEventListener('pointerup', finishDrag);
  svg.addEventListener('pointercancel', finishDrag);
  svg.addEventListener('click', (event) => {
    if (moved) { moved = false; return; }
    const point = pointFromEvent(event);
    if (point) callbacks.onMap?.({ point, coordinates: scene.unproject(point) });
  });

  const resizeObserver = new ResizeObserver(() => {
    const center = [view.x + view.width / 2, view.y + view.height / 2];
    refreshViewportRatio();
    view.height = view.width * viewportRatio;
    view.x = center[0] - view.width / 2;
    view.y = center[1] - view.height / 2;
    applyView();
  });
  resizeObserver.observe(container);
  setInitialView();

  return {
    zoomIn: () => zoom(.72),
    zoomOut: () => zoom(1.38),
    resetView: setInitialView,
    destroy: () => {
      resizeObserver.disconnect();
      if (radarFrame !== null) window.cancelAnimationFrame(radarFrame);
    },
    setSelection(originId, destinationId) {
      nodeLayer.querySelectorAll('.map-node').forEach((node) => {
        node.classList.toggle('is-origin', node.dataset.id === originId);
        node.classList.toggle('is-destination', node.dataset.id === destinationId);
      });
    },
    drawRoute(route) {
      routeLayer.replaceChildren();
      highlightLayer.replaceChildren();
      const intermediateIds = new Set(route?.pathNodes?.slice(1, -1) || []);
      nodeLayer.querySelectorAll('.map-node').forEach((node) => {
        node.classList.toggle('is-intermediate', intermediateIds.has(node.dataset.id));
      });
      if (!route) return;
      const routePoints = [];
      route.segments.forEach((segment) => {
        const points = segment.geometry.coordinates.map(scene.project);
        routePoints.push(...points);
        const d = pathFromPoints(points);
        routeLayer.appendChild(svgElement('path', { class: 'route-casing', d }));
        const path = svgElement('path', { class: `route-segment risk-${segment.riskLevel}`, d });
        const title = svgElement('title');
        title.textContent = `${segment.riskLabel} · ${segment.distanceKm} km · ${segment.description}`;
        path.appendChild(title);
        routeLayer.appendChild(path);
      });
      fitPoints(routePoints);
    },
    clearFocus: () => highlightLayer.replaceChildren(),
    focusZone(zone) {
      highlightLayer.replaceChildren();
      const ring = zone.rings[0]?.length
        ? svgElement('path', { class: 'map-focus-ring', d: pathFromPoints(zone.rings[0], true) })
        : svgElement('circle', {
          class: 'map-focus-ring is-circle',
          cx: zone.radarCenter[0],
          cy: zone.radarCenter[1],
          r: zone.radarRadius || 30
        });
      highlightLayer.appendChild(ring);
      const boundsPoints = zone.rings[0]?.length ? zone.rings[0] : circlePoints(zone.radarCenter, zone.radarRadius || 30);
      fitPoints(boundsPoints);
    },
    focusSegment(points) {
      highlightLayer.replaceChildren();
      highlightLayer.appendChild(svgElement('path', { class: 'map-focus-line', d: pathFromPoints(points) }));
      fitPoints(points);
    },
    setSonarPreview(centerPoint, edgePoint, threatLevel = 'tier_2') {
      previewLayer.replaceChildren();
      if (!centerPoint || !edgePoint) return;
      previewLayer.appendChild(svgElement('circle', {
        class: `placement-preview risk-${threatLevel.replace('_', '-')}`,
        cx: centerPoint[0],
        cy: centerPoint[1],
        r: Math.hypot(edgePoint[0] - centerPoint[0], edgePoint[1] - centerPoint[1])
      }));
    }
  };
}
