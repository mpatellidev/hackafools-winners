# Backend

Servidor único em Node, sem dependências externas (`http`/`fs` puros):

- Serve a aplicação frontend em modo estático.
- Serve a API real de rotas S.C.A.R. (`routing-engine.js`), que lê os dados
  de `data/*.geojson` e calcula o caminho de menor custo (Dijkstra) nos modos
  `survival` (pondera perigo, terreno e zonas de risco) e `direct`.

## Como rodar

```bash
node backend/server.js
```

A aplicação ficará disponível em http://localhost:3000, incluindo o modo
"S.C.A.R." em `/scar.html`.

## Endpoints

- `GET /api/v1/layers` — retorna nós, arestas e zonas de perigo (GeoJSON).
- `POST /api/v1/routes/calculate` — calcula a rota entre dois nós.
  ```json
  { "origin_id": "node_citadel", "destination_id": "node_outpost_omega", "navigation_mode": "survival" }
  ```
