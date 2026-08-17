const WIDTH = 980;
const HEIGHT = 520;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ZOOM_DURATION_MS = 850; // keep in sync with #worldGroup's transition-duration in world.css

const stage = document.getElementById('worldStage');
const loading = document.getElementById('worldLoading');
const svg = document.getElementById('worldMap');
const group = document.getElementById('worldGroup');
const readout = document.getElementById('worldReadout');
const readoutName = document.getElementById('worldReadoutName');
const transition = document.getElementById('worldTransition');

let locked = false;

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function showReadout(name) {
  if (locked) return;
  readoutName.textContent = name;
  readout.hidden = false;
}

function hideReadout() {
  readout.hidden = true;
}

function selectTerritory(node) {
  if (locked) return;
  locked = true;
  hideReadout();
  node.blur();

  // Zooming a transform across ~180 non-scaling-stroke paths every frame is
  // what caused the visible stutter — drop every other shape from the render
  // tree immediately so only the selected country is left animating.
  svg.classList.add('is-zooming');
  document.querySelectorAll('.territory').forEach((el) => el.classList.toggle('is-selected', el === node));

  const bbox = node.getBBox();
  const viewBox = svg.viewBox.baseVal;
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  const scale = Math.min(12, Math.max(3.5, 220 / Math.max(bbox.width, bbox.height, 1)));
  const targetX = viewBox.width / 2 - centerX * scale;
  const targetY = viewBox.height / 2 - centerY * scale;

  // A single rAF isn't reliably enough for the browser to commit the "before"
  // frame separately from the "after" one on a page this size.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      group.style.transform = `translate(${targetX}px, ${targetY}px) scale(${scale})`;
    });
  });

  // transitionend on this group is unreliable here — with real click/focus
  // handling and ~180 sibling visibility changes landing in the same frame,
  // Chromium can silently skip dispatching it. A fixed clock matching the CSS
  // duration is what actually keeps the hand-off from stalling.
  window.setTimeout(() => {
    transition.classList.add('is-active');
    window.setTimeout(() => { window.location.href = 'scar.html'; }, 420);
  }, ZOOM_DURATION_MS + 80);
}

function wireTerritory(element, name) {
  element.setAttribute('tabindex', '0');
  element.setAttribute('role', 'button');
  element.setAttribute('aria-label', `Selecionar ${name} e acessar a cartografia local`);
  element.addEventListener('pointerenter', () => showReadout(name));
  element.addEventListener('focus', () => showReadout(name));
  element.addEventListener('pointerleave', hideReadout);
  element.addEventListener('blur', hideReadout);
  element.addEventListener('click', () => selectTerritory(element));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectTerritory(element);
    }
  });
}

async function init() {
  const topology = await fetch('vendor/countries-110m.json').then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  const countries = topojson.feature(topology, topology.objects.countries);

  const projection = d3.geoNaturalEarth1().fitSize([WIDTH, HEIGHT], countries);
  const pathGenerator = d3.geoPath(projection);

  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  group.appendChild(svgElement('path', { class: 'world-sphere', d: pathGenerator({ type: 'Sphere' }) }));

  const graticuleGroup = svgElement('g', { class: 'graticule', 'aria-hidden': 'true' });
  graticuleGroup.appendChild(svgElement('path', { d: pathGenerator(d3.geoGraticule10()) }));
  group.appendChild(graticuleGroup);

  countries.features.forEach((feature) => {
    const d = pathGenerator(feature);
    if (!d) return;
    const name = feature.properties?.name || 'Território desconhecido';
    const element = svgElement('path', { class: 'territory', d });
    element.dataset.name = name;
    wireTerritory(element, name);
    group.appendChild(element);
  });

  loading.hidden = true;
  svg.removeAttribute('hidden');
  stage.setAttribute('aria-busy', 'false');
}

init().catch((error) => {
  console.error('DustNav world map failed to load:', error);
  loading.innerHTML = '<strong>MAPA INDISPONÍVEL</strong><small>Não foi possível carregar as fronteiras territoriais.</small>';
});
