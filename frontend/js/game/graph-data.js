// Dados do mapa em formato de GRAFO — pensados para serem descartáveis.
//
// Isto é só um exemplo amplo de teste (um mundo de fantasia fictício com
// estradas, trilhas e uma rede de portais). Nada aqui é definitivo: o resto
// do sistema (graph.js, render.js, ui.js, main.js) não sabe nada sobre este
// mapa específico — ele só consome `nodes`, `edges` e `modes` no formato
// abaixo. Pra usar outro mapa de jogo depois, basta substituir os arrays
// deste arquivo (ou carregá-los de um JSON/API) — nenhum outro arquivo
// precisa mudar.
//
// node: { id, label, x, y }
//   x/y são coordenadas livres de desenho (pixels no viewBox do SVG),
//   não representam nenhuma geografia real.
//
// edge: { from, to, weight, type }
//   Tratada como bidirecional pelo motor de grafo (graph.js).
//   `weight` é um custo abstrato (não é metros nem km).
//   `type` é uma tag livre usada pelos modos abaixo para decidir quais
//   arestas cada modo pode usar (ex: montaria não passa por trilhas).
//
// mode: { id, label, icon, allowedTypes, timePerUnit, color }
//   `allowedTypes` filtra quais arestas esse modo pode atravessar —
//   é isso que faz cada modo calcular um caminho diferente.
//   `timePerUnit` só converte o custo total em "minutos" pro card de stats.

export const nodes = [
  { id: 'vila-inicial',     label: 'Vila Inicial',        x: 80,  y: 600 },
  { id: 'porto-tempestade', label: 'Porto da Tempestade', x: 100, y: 380 },
  { id: 'floresta-sombria', label: 'Floresta Sombria',    x: 220, y: 520 },
  { id: 'deserto-ossos',    label: 'Deserto dos Ossos',   x: 250, y: 300 },
  { id: 'ponte-pedra',      label: 'Ponte de Pedra',      x: 350, y: 560 },
  { id: 'pantano-negro',    label: 'Pântano Negro',       x: 300, y: 680 },
  { id: 'ruinas-antigas',   label: 'Ruínas Antigas',      x: 420, y: 300 },
  { id: 'vale-verde',       label: 'Vale Verde',          x: 480, y: 480 },
  { id: 'templo-perdido',   label: 'Templo Perdido',      x: 500, y: 150 },
  { id: 'lago-espelhado',   label: 'Lago Espelhado',      x: 560, y: 380 },
  { id: 'caverna-cristal',  label: 'Caverna de Cristal',  x: 600, y: 220 },
  { id: 'torre-mago',       label: 'Torre do Mago',       x: 650, y: 300 },
  { id: 'montanha-gelida',  label: 'Montanha Gélida',     x: 720, y: 180 },
  { id: 'castelo-real',     label: 'Castelo Real',        x: 780, y: 450 },
  { id: 'vilarejo-leste',   label: 'Vilarejo do Leste',   x: 900, y: 350 },
  { id: 'fortaleza-negra',  label: 'Fortaleza Negra',     x: 850, y: 600 }
];

export const edges = [
  { from: 'vila-inicial',     to: 'floresta-sombria',  weight: 12, type: 'road'  },
  { from: 'vila-inicial',     to: 'porto-tempestade',  weight: 18, type: 'road'  },
  { from: 'floresta-sombria', to: 'ponte-pedra',       weight: 8,  type: 'trail' },
  { from: 'floresta-sombria', to: 'pantano-negro',     weight: 10, type: 'trail' },
  { from: 'ponte-pedra',      to: 'vale-verde',        weight: 14, type: 'road'  },
  { from: 'pantano-negro',    to: 'vale-verde',        weight: 16, type: 'trail' },
  { from: 'porto-tempestade', to: 'deserto-ossos',     weight: 20, type: 'road'  },
  { from: 'deserto-ossos',    to: 'ruinas-antigas',    weight: 15, type: 'road'  },
  { from: 'ruinas-antigas',   to: 'vale-verde',        weight: 10, type: 'road'  },
  { from: 'ruinas-antigas',   to: 'templo-perdido',    weight: 9,  type: 'trail' },
  { from: 'vale-verde',       to: 'lago-espelhado',    weight: 11, type: 'road'  },
  { from: 'lago-espelhado',   to: 'torre-mago',        weight: 13, type: 'road'  },
  { from: 'lago-espelhado',   to: 'castelo-real',      weight: 22, type: 'road'  },
  { from: 'torre-mago',       to: 'caverna-cristal',   weight: 7,  type: 'trail' },
  { from: 'torre-mago',       to: 'templo-perdido',    weight: 12, type: 'road'  },
  { from: 'caverna-cristal',  to: 'montanha-gelida',   weight: 10, type: 'road'  },
  { from: 'templo-perdido',   to: 'montanha-gelida',   weight: 14, type: 'trail' },
  { from: 'castelo-real',     to: 'fortaleza-negra',   weight: 16, type: 'road'  },
  { from: 'castelo-real',     to: 'vilarejo-leste',    weight: 12, type: 'road'  },
  { from: 'montanha-gelida',  to: 'vilarejo-leste',    weight: 18, type: 'road'  },
  { from: 'fortaleza-negra',  to: 'vilarejo-leste',    weight: 9,  type: 'trail' },

  // Rede de portais: atalhos mágicos, só usáveis pelo modo "Rede de Portais".
  { from: 'torre-mago',       to: 'templo-perdido',    weight: 2, type: 'portal' },
  { from: 'torre-mago',       to: 'fortaleza-negra',   weight: 3, type: 'portal' },
  { from: 'vila-inicial',     to: 'castelo-real',      weight: 4, type: 'portal' },
  { from: 'porto-tempestade', to: 'vilarejo-leste',    weight: 5, type: 'portal' }
];

// 'community' é o tipo de aresta usado por community.js para ligar nós
// criados pelos usuários (recursos/locais seguros) aos nós mais próximos do
// grafo-base. Fica liberado em todos os modos: um local compartilhado pela
// comunidade precisa ser alcançável independente de como se está viajando.
export const modes = [
  {
    id: 'walk',
    label: 'A pé',
    icon: '●',
    allowedTypes: ['road', 'trail', 'community'],
    timePerUnit: 1.2,
    color: '#9af46f'
  },
  {
    id: 'mount',
    label: 'Montaria',
    icon: '▲',
    allowedTypes: ['road', 'community'], // trilhas são estreitas demais pra montaria
    timePerUnit: 0.6,
    color: '#b9e47a'
  },
  {
    id: 'portal',
    label: 'Rede de Portais',
    icon: '◎',
    allowedTypes: ['road', 'portal', 'community'], // magia não se sustenta em trilhas
    timePerUnit: 0.3,
    color: '#75dca0'
  }
];
