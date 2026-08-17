# Backend

Servidor único em Node, sem dependências externas (`http`/`fs` puros):

- Serve a aplicação frontend em modo estático.
- Serve a API real de rotas SCAR (`routing-engine.js`), que lê os dados de
  `data/*.geojson` e compara perfis seguro, equilibrado e rápido por Dijkstra.

## Como rodar

```bash
node backend/server.js
```

A aplicação principal fica disponível em http://localhost:3000/.

## Endpoints

- `GET /api/v1/health` — estado do núcleo e dos dados locais.
- `GET /api/v1/layers` — retorna nós, arestas e zonas de perigo (GeoJSON).
- `POST /api/v1/routes/calculate` — compara rotas entre dois nós.
  ```json
  { "origin_id": "node_canyon_hideout", "destination_id": "node_dead_pass" }
  ```
