// Cliente da API real do S.C.A.R. (routing-engine.js, servida pelo próprio
// server.js). As chamadas são sempre relativas ("/api/v1/...").

const BASE = '/api/v1';

async function request(path, options) {
  let res;
  try {
    res = await fetch(BASE + path, options);
  } catch (err) {
    throw new Error('Não foi possível falar com a API. Ela está rodando?');
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.error || detail;
    } catch {
      // resposta não era JSON — mantém o statusText
    }
    throw new Error(detail || `Erro ${res.status}`);
  }

  return res.json();
}

export function fetchLayers() {
  return request('/layers');
}

export function fetchRoute(originId, destinationId, navigationMode) {
  return request('/routes/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin_id: originId,
      destination_id: destinationId,
      navigation_mode: navigationMode
    })
  });
}

/**
 * Compartilha um novo local (recurso/local seguro) com a comunidade. O
 * backend liga esse ponto de verdade ao grafo (nós mais próximos) e ele
 * passa a valer como origem/destino em qualquer cálculo de rota.
 */
export function createCommunityNode(label, category, lon, lat) {
  return request('/community/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, category, lon, lat })
  });
}

/**
 * Reporta uma nova zona de perigo (retângulo definido por dois cantos
 * opostos [lon, lat]). O backend recalcula na hora o peso de qualquer
 * aresta existente que cruze essa área — a zona vale pra qualquer pessoa
 * que calcular rota depois, sem precisar reiniciar o servidor.
 */
export function createDangerZone(name, description, threatLevel, corner1, corner2) {
  return request('/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, threat_level: threatLevel, corner1, corner2 })
  });
}
