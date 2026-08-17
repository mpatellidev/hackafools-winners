# DustNav

O DustNav é uma aplicação local de planejamento de rotas para um cenário de
sobrevivência. O sistema representa o território como um grafo, calcula caminhos
entre setores e compara distância com exposição a terreno hostil, regiões de
risco e sonares.

A aplicação é executada por um servidor Node.js sem dependências externas e
inclui uma interface responsiva construída com HTML, CSS, JavaScript e SVG.

## Funcionalidades

- Mapa interativo com zoom, deslocamento e seleção de setores.
- Grafo de navegação formado por nós e corredores conectados.
- Destaque visual para origem, destino e nós intermediários da rota.
- Regiões territoriais com limites semelhantes a divisões administrativas.
- Sonares animados que se expandem do centro até o alcance máximo.
- Três níveis de sonar:
  - verde: risco baixo;
  - amarelo/laranja: risco moderado;
  - vermelho: risco alto.
- Duas estratégias calculadas para cada travessia:
  - **Rota direta:** considera somente a menor distância durante a escolha do caminho;
  - **Maior sobrevivência:** minimiza a exposição a sonares, zonas e outros perigos.
- Cálculo de chance de sobrevivência, tempo, combustível e exposição.
- Cadastro de pontos comunitários ligados automaticamente ao grafo.
- Cadastro de zonas de perigo no formato de novos sonares.
- Persistência local dos registros comunitários.
- Randomização dos sonares nativos a cada inicialização do servidor.

## Requisitos

- [Node.js](https://nodejs.org/) 18 ou mais recente.
- Um navegador moderno com suporte a módulos JavaScript e SVG.

Fora do mapa global de países (`world.html`), que usa D3.js e o dataset
`world-atlas` vendorizados em `frontend/vendor/`, o projeto não utiliza
bibliotecas externas em tempo de execução.

## Como executar

Clone ou copie o projeto e, no diretório raiz, execute:

```bash
cd backend
npm install
npm start
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

Também é possível iniciar diretamente pela raiz:

```bash
node backend/server.js
```

### Usar outra porta

No PowerShell:

```powershell
$env:PORT=3001
npm start
```

No Bash:

```bash
PORT=3001 npm start
```

## Como usar

0. Ao abrir o sistema, selecione um território no mapa global de operações — por enquanto
   qualquer território leva à mesma cartografia local, com um efeito de zoom até a página
   de setores (`scar.html`).
1. Escolha a origem e o destino clicando nos nós ou utilizando os campos de busca.
2. Selecione **Calcular rotas**.
3. Compare a rota direta com a rota de maior sobrevivência.
4. Clique em uma alternativa para exibi-la no mapa.

Os nós intermediários da alternativa ativa são destacados em laranja.

### Adicionar um ponto comunitário

Em **Inteligência de campo**, escolha recurso, abrigo ou local. Clique no mapa,
informe um nome e registre o ponto. O backend conecta o novo nó aos dois setores
mais próximos.

### Adicionar uma zona de perigo

1. Abra **Inteligência de campo → Zona de perigo**.
2. Selecione **Adicionar sonar**.
3. Clique no mapa para definir o centro.
4. Clique novamente para definir o alcance.
5. Escolha o nível de risco, informe o nome e registre.

O alcance aceito fica entre `0,5 km` e `12 km`. O sonar entra imediatamente no
cálculo de sobrevivência e pode alterar a rota segura recomendada.

## Como as rotas são calculadas

O motor utiliza Dijkstra com pesos diferentes para cada estratégia:

- **Direta:** o peso de cada aresta é somente sua distância em quilômetros.
- **Maior sobrevivência:** o peso combina perigo do corredor, terreno, exposição
  às regiões, pontos de apoio e exposição aos sonares.

A influência das regiões é reduzida. Os sonares são o fator de maior peso, e seu
impacto cresce conforme o nível:

| Nível | Cor | Influência |
|---|---|---|
| `tier_1` | Verde | Baixa |
| `tier_2` | Amarelo/laranja | Moderada |
| `tier_3` | Vermelho | Alta |

A rota direta ignora esses riscos ao escolher o caminho, mas seu percentual de
sobrevivência ainda mostra os perigos realmente atravessados.

## Randomização dos sonares

Ao iniciar o backend, os sonares nativos recebem uma nova configuração:

- deslocamento entre `1,5 km` e `4,5 km`;
- variação de raio entre `5%` e `13%`;
- redistribuição das três cores de risco;
- distância mínima entre centros para evitar aglomerações excessivas.

O mapa e o motor de rotas usam a mesma configuração mantida em memória. Portanto,
é necessário reiniciar o servidor para gerar outra distribuição. Os sonares
criados pela comunidade mantêm os dados com que foram registrados.

## Estrutura do projeto

```text
DustNav/
├── backend/
│   ├── data/
│   │   ├── nodes.geojson          # setores do grafo
│   │   ├── edges.geojson          # corredores entre setores
│   │   ├── zones.geojson          # regiões e sonares nativos
│   │   └── community-zones.json   # perigos comunitários persistidos
│   ├── routing-engine.js          # cálculo de rotas e sobrevivência
│   ├── routing-engine.test.js     # testes automatizados
│   ├── sonar-randomizer.js        # randomização dos sonares nativos
│   └── server.js                  # servidor HTTP, API e arquivos estáticos
├── frontend/
│   ├── css/                       # estilos da interface e do mapa
│   ├── js/
│   │   ├── map/                   # projeção e renderização SVG
│   │   ├── ui/                    # painel e resultados
│   │   ├── api.js                 # cliente da API
│   │   ├── app.js                 # fluxo principal
│   │   ├── state.js               # estado da aplicação
│   │   └── world.js               # seleção de território no mapa global
│   ├── vendor/                     # D3.js, TopoJSON e dataset de países (world-atlas)
│   ├── world.html                 # página inicial — mapa global de países
│   └── scar.html                  # página de setores, rotas e zonas
├── public/                        # recursos estáticos
└── README.md
```

O arquivo `backend/data/community.json` é criado quando o primeiro ponto
comunitário é registrado.

## API

Todas as rotas usam o prefixo `/api/v1`.

### Estado do sistema

```http
GET /api/v1/health
```

### Camadas do mapa

```http
GET /api/v1/layers
```

Retorna nós, arestas, regiões e sonares em GeoJSON.

### Calcular rotas

```http
POST /api/v1/routes/calculate
Content-Type: application/json
```

```json
{
  "origin_id": "node_canyon_hideout",
  "destination_id": "node_dead_pass"
}
```

### Adicionar ponto comunitário

```http
POST /api/v1/community/nodes
Content-Type: application/json
```

```json
{
  "label": "Abrigo da ponte",
  "category": "seguro",
  "lon": 138.5,
  "lat": -30.3
}
```

As categorias aceitas são `recurso`, `seguro` e `comum`.

### Adicionar sonar de perigo

```http
POST /api/v1/sonars
Content-Type: application/json
```

```json
{
  "name": "Radar dos saqueadores",
  "description": "Sinal móvel detectado no corredor.",
  "threat_level": "tier_3",
  "center": [138.6, -30.3],
  "edge": [138.65, -30.3]
}
```

`center` define o centro e `edge` um ponto na borda. O servidor calcula o raio
geográfico entre eles.

## Testes

Na pasta `backend`, execute:

```bash
npm test
```

A suíte cobre carregamento do grafo, validações, rotas direta e segura, exposição
parcial, zonas críticas, sonares, randomização, pontos comunitários e o conjunto
GeoJSON real.

## Persistência

Os pontos e sonares criados pela interface são armazenados em arquivos JSON
locais dentro de `backend/data`. O projeto não utiliza banco de dados nem serviço
externo.

## Tecnologias

- Node.js (`http` e `fs` nativos)
- JavaScript com módulos ES no frontend
- HTML5 e CSS responsivo
- SVG para grafo, regiões, rotas e animações
- GeoJSON para nós, arestas e zonas
- D3.js e TopoJSON (vendorizados) para o mapa global de países em `world.html`
