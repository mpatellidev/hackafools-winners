import json
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from core.engine import WastelandRouter

app = FastAPI(title="DustNav Routing API", version="1.1.0")

# ==========================================
# MIDDLEWARE CORS (Integração Frontend)
# ==========================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# CARREGAMENTO DOS GEOJSONS EM MEMÓRIA
# ==========================================
router = WastelandRouter()

try:
    with open("data/nodes.geojson", "r", encoding="utf-8") as fn:
        nodes_data = json.load(fn)
    with open("data/edges.geojson", "r", encoding="utf-8") as fe:
        edges_data = json.load(fe)
    with open("data/zones.geojson", "r", encoding="utf-8") as fz:
        zones_data = json.load(fz)
    
    # Engine alimentada com nós, arestas e zonas simultaneamente
    router.load_from_geojson(nodes_data, edges_data, zones_data)
except FileNotFoundError as e:
    print(f"ALERTA CRÍTICO: Arquivo de mapa não encontrado - {e}")
    # Cria fallbacks vazios se não houver dados locais ainda para evitar que o servidor crashe
    nodes_data, edges_data, zones_data = {}, {}, {}

# ==========================================
# SCHEMAS DE VALIDAÇÃO (Pydantic)
# ==========================================
class RouteRequest(BaseModel):
    origin_id: str
    destination_id: str
    navigation_mode: Literal["survival", "direct"] = "survival"

# ==========================================
# ENDPOINTS
# ==========================================
@app.get("/api/v1/layers", summary="Retorna os artefatos geográficos para o Mapa Frontend")
def get_layers():
    """
    Entrega as Zonas de Perigo (Polígonos) e os POIs (Pontos) 
    para o Agente 3 renderizar na interface.
    """
    return {
        "nodes": nodes_data,
        "zones": zones_data
    }

@app.post("/api/v1/routes/calculate", summary="Calcula a rota de sobrevivência S.C.A.R.")
def calculate_route(payload: RouteRequest):
    """
    Processa a requisição usando o dígrafo carregado em memória.
    Validação Literal garante que mode seja estritamente 'survival' ou 'direct'.
    """
    result = router.calculate_route(
        origin_id=payload.origin_id, 
        destination_id=payload.destination_id, 
        mode=payload.navigation_mode
    )
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
        
    return result