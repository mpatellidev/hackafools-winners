const STORAGE_KEY = 'dustnav.tour.completed.v1';

function buildSteps() {
  return [
    {
      target: null,
      eyebrow: 'PROTOCOLO DE ORIENTAÇÃO',
      title: 'BEM-VINDO AO DUSTNAV',
      body: 'Este é o sistema de cartografia de sobrevivência. Vamos percorrer as funcionalidades principais em poucos passos — o mapa e o painel continuam funcionando normalmente enquanto você segue o guia.'
    },
    {
      target: '#mapCanvas',
      eyebrow: 'CARTOGRAFIA',
      title: 'MAPA OPERACIONAL',
      body: 'Arraste para deslocar a visão. Cada nó é um setor navegável: clique em um para marcá-lo como origem e em outro para marcá-lo como destino.'
    },
    {
      target: '.map-legend',
      eyebrow: 'LEGENDA',
      title: 'RISCO DO TRECHO',
      body: 'As cores mostram o nível de perigo de cada corredor percorrido pela rota ativa: do verde (baixo) ao vermelho (crítico).'
    },
    {
      target: '.map-controls',
      eyebrow: 'NAVEGAÇÃO',
      title: 'CONTROLES DE VISUALIZAÇÃO',
      body: 'Aproxime, afaste ou centralize a cartografia completa a qualquer momento com estes botões.'
    },
    {
      target: '.route-form',
      eyebrow: 'PROTOCOLO SCAR / 04',
      title: 'ORIGEM E DESTINO',
      body: 'Digite o nome de um setor ou use MARCAR e clique no mapa para definir os dois pontos da travessia. O botão ⇅ inverte origem e destino.',
      requiresPanel: true
    },
    {
      target: '#calculateRoute',
      eyebrow: 'CÁLCULO',
      title: 'CALCULAR ROTAS',
      body: 'Com origem e destino definidos, calcule as rotas. O DustNav compara a rota direta com a de maior sobrevivência, mostrando distância, tempo, exposição e combustível.',
      requiresPanel: true
    },
    {
      target: '#fieldIntelligence > summary',
      eyebrow: 'CAMPO',
      title: 'INTELIGÊNCIA DE CAMPO',
      body: 'Expanda esta seção para ver zonas mapeadas, registrar pontos comunitários (recursos, abrigos, locais) e reportar novas zonas de perigo. Tudo entra no cálculo de sobrevivência.',
      requiresPanel: true
    },
    {
      target: null,
      eyebrow: 'PRONTO',
      title: 'BOA TRAVESSIA',
      body: 'Você já conhece o essencial. Reabra este guia a qualquer momento pelo botão GUIA no topo da tela.'
    }
  ];
}

let overlayEl = null;
let spotlightEl = null;
let cardEl = null;
let dotsEl = null;
let backBtn = null;
let nextBtn = null;
let skipBtn = null;
let steps = [];
let currentStep = 0;
let panelForcedOpen = false;
let panelWasOpenInitially = false;
let resizeHandler = null;

function isMobile() {
  return window.innerWidth < 761;
}

function ensurePanelVisible(requiresPanel) {
  if (!requiresPanel || !isMobile()) return;
  const panel = document.getElementById('routePanel');
  if (!panel.classList.contains('is-open')) {
    panel.classList.add('is-open');
    document.getElementById('panelScrim').hidden = false;
  }
  panelForcedOpen = true;
}

function restorePanel() {
  if (panelForcedOpen && !panelWasOpenInitially) {
    document.getElementById('routePanel').classList.remove('is-open');
    document.getElementById('panelScrim').hidden = true;
  }
  panelForcedOpen = false;
}

function buildOverlay() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'tour-overlay';
  overlayEl.innerHTML = `
    <div class="tour-spotlight" id="tourSpotlight"></div>
    <div class="tour-card" id="tourCard" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
      <span class="eyebrow tour-eyebrow" id="tourEyebrow"></span>
      <h2 id="tourTitle"></h2>
      <p id="tourBody"></p>
      <div class="tour-dots" id="tourDots"></div>
      <div class="tour-actions">
        <button type="button" class="tour-skip" id="tourSkip">PULAR TOUR</button>
        <div class="tour-nav">
          <button type="button" class="tour-back" id="tourBack">VOLTAR</button>
          <button type="button" class="tour-next" id="tourNext">AVANÇAR</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);
  spotlightEl = overlayEl.querySelector('#tourSpotlight');
  cardEl = overlayEl.querySelector('#tourCard');
  dotsEl = overlayEl.querySelector('#tourDots');
  backBtn = overlayEl.querySelector('#tourBack');
  nextBtn = overlayEl.querySelector('#tourNext');
  skipBtn = overlayEl.querySelector('#tourSkip');

  skipBtn.addEventListener('click', endTour);
  backBtn.addEventListener('click', () => goTo(currentStep - 1));
  nextBtn.addEventListener('click', () => {
    if (currentStep === steps.length - 1) endTour();
    else goTo(currentStep + 1);
  });

  resizeHandler = () => positionStep();
  window.addEventListener('resize', resizeHandler);
  document.addEventListener('keydown', onKeydown);
}

function onKeydown(event) {
  if (event.key === 'Escape') endTour();
  else if (event.key === 'ArrowRight') nextBtn.click();
  else if (event.key === 'ArrowLeft' && !backBtn.disabled) backBtn.click();
}

function teardown() {
  window.removeEventListener('resize', resizeHandler);
  document.removeEventListener('keydown', onKeydown);
  overlayEl?.remove();
  overlayEl = null;
  spotlightEl = null;
  cardEl = null;
}

function positionStep() {
  if (!overlayEl) return;
  const step = steps[currentStep];
  const target = step.target ? document.querySelector(step.target) : null;
  let rect;
  if (target) {
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    rect = target.getBoundingClientRect();
  } else {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    rect = { top: cy, left: cx, right: cx, bottom: cy, width: 0, height: 0 };
  }

  spotlightEl.classList.toggle('is-point', !target);
  const pad = 8;
  spotlightEl.style.top = `${rect.top - pad}px`;
  spotlightEl.style.left = `${rect.left - pad}px`;
  spotlightEl.style.width = `${rect.width + pad * 2}px`;
  spotlightEl.style.height = `${rect.height + pad * 2}px`;

  if (!target) {
    cardEl.dataset.placement = 'center';
    cardEl.style.top = '';
    cardEl.style.left = '';
    return;
  }

  const cardRect = cardEl.getBoundingClientRect();
  const spacing = 16;
  const left = Math.min(Math.max(rect.left, spacing), window.innerWidth - cardRect.width - spacing);
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  let top;
  if (spaceBelow >= cardRect.height + spacing || spaceBelow >= spaceAbove) {
    top = Math.min(rect.bottom + spacing, window.innerHeight - cardRect.height - spacing);
    cardEl.dataset.placement = 'bottom';
  } else {
    top = Math.max(rect.top - cardRect.height - spacing, spacing);
    cardEl.dataset.placement = 'top';
  }
  cardEl.style.top = `${Math.max(top, spacing)}px`;
  cardEl.style.left = `${Math.max(left, spacing)}px`;
}

function renderStep() {
  const step = steps[currentStep];
  ensurePanelVisible(step.requiresPanel);

  overlayEl.querySelector('#tourEyebrow').textContent = step.eyebrow;
  overlayEl.querySelector('#tourTitle').textContent = step.title;
  overlayEl.querySelector('#tourBody').textContent = step.body;
  dotsEl.replaceChildren(...steps.map((_, index) => {
    const dot = document.createElement('span');
    dot.className = `tour-dot${index === currentStep ? ' is-active' : ''}`;
    return dot;
  }));

  backBtn.hidden = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  nextBtn.textContent = isLast ? 'CONCLUIR' : 'AVANÇAR';
  skipBtn.hidden = isLast;

  positionStep();
}

function goTo(index) {
  if (index < 0 || index >= steps.length) return;
  currentStep = index;
  renderStep();
}

function endTour() {
  localStorage.setItem(STORAGE_KEY, '1');
  restorePanel();
  teardown();
}

export function startTour({ force = false } = {}) {
  if (overlayEl) return;
  if (!force) {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch { /* storage unavailable, show tour anyway */ }
  }
  steps = buildSteps();
  currentStep = 0;
  panelForcedOpen = false;
  panelWasOpenInitially = document.getElementById('routePanel').classList.contains('is-open');
  buildOverlay();
  renderStep();
}

export function initOnboarding() {
  document.getElementById('tourReplay')?.addEventListener('click', () => startTour({ force: true }));
}
