const API_ROOT = '/api/v1';

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, options);
  } catch (error) {
    console.error('DustNav network error:', error);
    throw new Error('Sem comunicação com o núcleo local do DustNav.');
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* non-JSON response */ }
  if (!response.ok) {
    const message = payload?.error || 'O núcleo local não conseguiu concluir a operação.';
    const error = new Error(message);
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export const api = {
  health: () => request('/health'),
  layers: () => request('/layers'),
  routes: (originId, destinationId) => request('/routes/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin_id: originId, destination_id: destinationId })
  }),
  addCommunityNode: (label, category, lon, lat) => request('/community/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, category, lon, lat })
  }),
  addSonar: (name, description, threatLevel, center, edge) => request('/sonars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, threat_level: threatLevel, center, edge })
  })
};
