const http = require('http');
const fs = require('fs');
const path = require('path');
const { WastelandRouter } = require('./routing-engine');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const publicDir = path.join(rootDir, 'public');
const dataDir = path.join(__dirname, 'data');
const communityFile = path.join(dataDir, 'community.json');
const communityZonesFile = path.join(dataDir, 'community-zones.json');

// ==========================================
// CARREGAMENTO DOS GEOJSONS EM MEMÓRIA
// ==========================================
let nodesData = {};
let edgesData = {};
let zonesData = {};
const router = new WastelandRouter();

try {
  nodesData = JSON.parse(fs.readFileSync(path.join(dataDir, 'nodes.geojson'), 'utf-8'));
  edgesData = JSON.parse(fs.readFileSync(path.join(dataDir, 'edges.geojson'), 'utf-8'));
  zonesData = JSON.parse(fs.readFileSync(path.join(dataDir, 'zones.geojson'), 'utf-8'));
  router.loadFromGeojson(nodesData, edgesData, zonesData);
  console.log(
    `Motor de rotas carregado: ${nodesData.features?.length || 0} nós, ` +
    `${edgesData.features?.length || 0} vias, ${zonesData.features?.length || 0} zonas de perigo.`
  );
} catch (err) {
  console.error('ALERTA CRÍTICO: falha ao carregar os dados do wasteland em backend/data —', err.message);
}

// ==========================================
// LOCAIS COMPARTILHADOS PELA COMUNIDADE (persistidos em data/community.json)
// ==========================================
function loadCommunityStore() {
  try {
    const raw = fs.readFileSync(communityFile, 'utf-8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    // Repõe na mesma ordem em que foram criados, pra religar cada um aos
    // nós mais próximos exatamente como da primeira vez.
    entries.forEach((entry) => router.addCommunityNode(entry));
    console.log(`Locais da comunidade carregados: ${entries.length}.`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Aviso: não foi possível ler backend/data/community.json —', err.message);
    }
  }
}

function appendCommunityStore(entry) {
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(communityFile, 'utf-8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  entries.push(entry);
  fs.writeFileSync(communityFile, JSON.stringify(entries, null, 2), 'utf-8');
}

loadCommunityStore();

// ==========================================
// ZONAS DE PERIGO REPORTADAS PELA COMUNIDADE (persistidas em data/community-zones.json)
// ==========================================
function loadCommunityZonesStore() {
  try {
    const raw = fs.readFileSync(communityZonesFile, 'utf-8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    // Repõe na mesma ordem em que foram criadas, pra recalcular o peso das
    // arestas afetadas exatamente como da primeira vez.
    entries.forEach((entry) => router.addDangerZone(entry));
    console.log(`Zonas de perigo da comunidade carregadas: ${entries.length}.`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Aviso: não foi possível ler backend/data/community-zones.json —', err.message);
    }
  }
}

function appendCommunityZonesStore(entry) {
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(communityZonesFile, 'utf-8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  entries.push(entry);
  fs.writeFileSync(communityZonesFile, JSON.stringify(entries, null, 2), 'utf-8');
}

loadCommunityZonesStore();

function mergedNodesData() {
  return { ...nodesData, features: [...(nodesData.features || []), ...router.communityNodeFeatures] };
}

function mergedEdgesData() {
  return { ...edgesData, features: [...(edgesData.features || []), ...router.communityEdgeFeatures] };
}

function mergedZonesData() {
  return { ...zonesData, features: [...(zonesData.features || []), ...router.communityZoneFeatures] };
}

// ==========================================
// HELPERS DE API (JSON)
// ==========================================
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('Corpo da requisição muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', reject);
  });
}

const COMMUNITY_CATEGORIES = new Set(['recurso', 'seguro', 'comum']);

// Nível de periculosidade que o usuário escolhe ao reportar uma zona: um
// seletor simples de 3 níveis, que traduz pros mesmos campos numéricos já
// usados em data/zones.geojson (danger_multiplier, stealth_penalty) — assim
// quem reporta não precisa inventar números, só escolher baixo/médio/alto.
const THREAT_TIERS = {
  tier_1: { danger_multiplier: 1.4, stealth_penalty: 0.9 },
  tier_2: { danger_multiplier: 1.9, stealth_penalty: 0.6 },
  tier_3: { danger_multiplier: 2.6, stealth_penalty: 0.4 }
};

async function handleApi(req, res, pathname) {
  if (pathname === '/api/v1/layers' && req.method === 'GET') {
    sendJson(res, 200, { nodes: mergedNodesData(), zones: mergedZonesData(), edges: mergedEdgesData() });
    return;
  }

  if (pathname === '/api/v1/community/nodes' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }

    const label = String(body.label ?? '').trim().slice(0, 80);
    const category = body.category;
    const lon = Number(body.lon);
    const lat = Number(body.lat);

    if (!label) {
      sendJson(res, 400, { error: 'label é obrigatório.' });
      return;
    }
    if (!COMMUNITY_CATEGORIES.has(category)) {
      sendJson(res, 400, { error: "category deve ser 'recurso', 'seguro' ou 'comum'." });
      return;
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      sendJson(res, 400, { error: 'lon/lat inválidos.' });
      return;
    }
    if (router.adjacency.size === 0) {
      sendJson(res, 409, { error: 'Grafo ainda não carregado — não há nós pra ligar este local.' });
      return;
    }

    const { id, nodeFeature, edgeFeatures } = router.addCommunityNode({ label, category, lon, lat });
    appendCommunityStore({ id, label, category, lon, lat });

    sendJson(res, 201, { node: nodeFeature, edges: edgeFeatures });
    return;
  }

  if (pathname === '/api/v1/zones' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }

    const name = String(body.name ?? '').trim().slice(0, 80);
    const description = String(body.description ?? '').trim().slice(0, 240);
    const biomeFocus = String(body.biome_focus ?? 'scorched_desert').trim() || 'scorched_desert';
    const tier = THREAT_TIERS[body.threat_level];
    const corner1 = body.corner1;
    const corner2 = body.corner2;

    if (!name) {
      sendJson(res, 400, { error: 'name é obrigatório.' });
      return;
    }
    if (!tier) {
      sendJson(res, 400, { error: "threat_level deve ser 'tier_1', 'tier_2' ou 'tier_3'." });
      return;
    }
    const isValidCorner = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);
    if (!isValidCorner(corner1) || !isValidCorner(corner2)) {
      sendJson(res, 400, { error: 'corner1/corner2 devem ser pares [lon, lat] válidos.' });
      return;
    }

    const [lon1, lat1] = corner1;
    const [lon2, lat2] = corner2;
    const minLon = Math.min(lon1, lon2);
    const maxLon = Math.max(lon1, lon2);
    const minLat = Math.min(lat1, lat2);
    const maxLat = Math.max(lat1, lat2);

    if (maxLon - minLon < 0.001 || maxLat - minLat < 0.001) {
      sendJson(res, 400, { error: 'Área da zona pequena demais — escolha dois cantos mais afastados.' });
      return;
    }
    if (router.adjacency.size === 0) {
      sendJson(res, 409, { error: 'Grafo ainda não carregado — tente novamente em instantes.' });
      return;
    }

    const rings = [[
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat]
    ]];

    const zoneInput = {
      name,
      biomeFocus,
      zoneType: 'community_hazard',
      threatLevel: body.threat_level,
      dangerMultiplier: tier.danger_multiplier,
      stealthPenalty: tier.stealth_penalty,
      description: description || 'Zona de perigo reportada pela comunidade.',
      rings
    };

    const { id, zoneFeature } = router.addDangerZone(zoneInput);
    appendCommunityZonesStore({ id, ...zoneInput });

    sendJson(res, 201, { zone: zoneFeature });
    return;
  }

  if (pathname === '/api/v1/routes/calculate' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }

    const { origin_id: originId, destination_id: destinationId } = body;
    if (!originId || !destinationId) {
      sendJson(res, 400, { error: 'origin_id e destination_id são obrigatórios.' });
      return;
    }
    const navigationMode = body.navigation_mode === 'direct' ? 'direct' : 'survival';

    const result = router.calculateRoute(originId, destinationId, navigationMode);
    if (result.error) {
      sendJson(res, 404, { error: result.error });
    } else {
      sendJson(res, 200, result);
    }
    return;
  }

  sendJson(res, 404, { error: `Rota de API desconhecida: ${req.method} ${pathname}` });
}

// ==========================================
// ARQUIVOS ESTÁTICOS (frontend)
// ==========================================
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function serveStatic(req, res, safeUrl) {
  const staticDir = safeUrl.startsWith('/public/') ? publicDir : frontendDir;
  const requestPath = safeUrl === '/' ? '/index.html' : safeUrl.startsWith('/public/') ? safeUrl.slice('/public'.length) : safeUrl;
  const normalizedPath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(staticDir, normalizedPath);

  const isInsideStaticDir = filePath.startsWith(staticDir);

  if (!isInsideStaticDir) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? path.join(filePath, 'index.html')
    : filePath;

  if (!fs.existsSync(finalPath)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  fs.readFile(finalPath, (error, content) => {
    if (error) {
      res.statusCode = 500;
      res.end('Internal server error');
      return;
    }

    const ext = path.extname(finalPath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const safeUrl = rawUrl.split('?')[0];

  if (safeUrl.startsWith('/api/')) {
    handleApi(req, res, safeUrl).catch((err) => {
      console.error('Erro inesperado na API:', err);
      sendJson(res, 500, { error: 'Erro interno do servidor.' });
    });
    return;
  }

  serveStatic(req, res, safeUrl);
});

const port = Number(process.env.PORT || 3000);

server.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`A porta ${port} já está em uso. Encerre a outra instância do servidor ou inicie com PORT=3001.`);
    process.exitCode = 1;
    return;
  }
  console.error('Não foi possível iniciar o servidor:', err.message);
  process.exitCode = 1;
});

server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
