import logging
import networkx as nx
from typing import Dict, Any, List
from shapely.geometry import shape, LineString

logger = logging.getLogger(__name__)


class WastelandRouter:
    # NOTE: manter esta lista sincronizada com os valores de "terrain_type"
    # usados em data/edges.geojson. Qualquer valor ausente aqui cai
    # silenciosamente no multiplicador padrão (1.0x) — ver _terrain_multiplier().
    TERRAIN_MULTIPLIERS = {
        "asphalt_ruins": 1.0,
        "highway_ruins": 1.1,
        "safe_pass": 1.0,
        "killzone_highway": 1.0,
        "packed_dirt": 1.2,
        "dirt_track": 1.2,
        "canyon_trail": 1.3,
        "sheltered_canyon": 1.2,
        "ambush_corridor": 1.3,
        "hostile_trail": 1.4,
        "sand_dunes": 1.8,
        "dune_bypass": 1.5,
        "storm_plains": 1.6,
        "radioactive_crater": 2.5,
    }

    def __init__(self):
        self.graph = nx.DiGraph()
        self.nodes_data: Dict[str, Dict[str, Any]] = {}
        self.danger_zones: List[Dict[str, Any]] = []

    def load_from_geojson(self, nodes_geojson: Dict[str, Any], edges_geojson: Dict[str, Any], zones_geojson: Dict[str, Any] = None) -> None:
        """Carrega nós (POIs), arestas (vias bidirecionais) e polígonos de zonas perigosas."""
        
        # 1. Carrega Zonas de Perigo (Polígonos) via Shapely
        if zones_geojson:
            for feature in zones_geojson.get("features", []):
                geom = shape(feature["geometry"])
                props = feature.get("properties", {})
                self.danger_zones.append({
                    "geometry": geom,
                    "properties": props
                })

        # 2. Carrega Vértices (POIs)
        # O id pode vir no campo GeoJSON padrão (Feature.id) OU dentro de
        # properties.id — o dataset atual usa o segundo formato.
        for feature in nodes_geojson.get("features", []):
            props = feature.get("properties", {})
            node_id = feature.get("id") or props.get("id")
            if node_id is None:
                raise ValueError(
                    f"Nó sem identificador (nem Feature.id nem properties.id): {feature}"
                )
            coords = feature["geometry"]["coordinates"]
            self.nodes_data[node_id] = {"coords": coords, **props}
            self.graph.add_node(node_id, coords=coords, **props)

        # 3. Carrega Arestas (Estradas/Trilhas com suporte Bidirecional)
        for feature in edges_geojson.get("features", []):
            props = feature["properties"]
            u = props["source_node"]
            v = props["target_node"]
            
            # "distance_km" é o nome usado no dataset atual; "base_distance_km"
            # é mantido como fallback por compatibilidade com dados antigos.
            dist = props.get("distance_km", props.get("base_distance_km", 1.0))
            danger = props.get("danger_level", 0)
            terrain = props.get("terrain_type", "asphalt_ruins")
            one_way = props.get("one_way", False)
            geometry_coords = feature["geometry"]["coordinates"]

            # Intersecção com Zonas de Perigo
            edge_line = LineString(geometry_coords)
            zone_penalty = 1.0
            for zone in self.danger_zones:
                if edge_line.intersects(zone["geometry"]):
                    zone_props = zone["properties"]
                    # "danger_multiplier" é o nome usado no dataset atual;
                    # "penalty_multiplier" é mantido como fallback.
                    zone_penalty *= zone_props.get(
                        "danger_multiplier", zone_props.get("penalty_multiplier", 1.0)
                    )

            # Cálculos S.C.A.R.
            if terrain not in self.TERRAIN_MULTIPLIERS:
                logger.warning(
                    "terrain_type '%s' (aresta %s) não mapeado em TERRAIN_MULTIPLIERS; "
                    "usando multiplicador padrão 1.0x",
                    terrain,
                    feature.get("id", f"{u}_{v}"),
                )
            terrain_mult = self.TERRAIN_MULTIPLIERS.get(terrain, 1.0)
            direct_weight = dist * terrain_mult
            survival_weight = (dist * (1.0 + (danger * 1.5)) * terrain_mult) * zone_penalty

            edge_attrs = {
                "edge_id": feature.get("id", f"{u}_{v}"),
                "distance_km": dist,
                "danger_level": danger,
                "terrain_type": terrain,
                "direct_weight": direct_weight,
                "survival_weight": survival_weight,
                "zone_penalty": zone_penalty
            }

            # Aresta original (ida)
            self.graph.add_edge(u, v, geometry=geometry_coords, **edge_attrs)

            # Aresta reversa (volta), a menos que explicitamente one_way
            if not one_way:
                # Inverte a lista de coordenadas da LineString para que o caminho desenhe corretamente na volta
                self.graph.add_edge(v, u, geometry=geometry_coords[::-1], **edge_attrs)

    def calculate_route(self, origin_id: str, destination_id: str, mode: str = "survival") -> Dict[str, Any]:
        """Calcula o melhor caminho usando NetworkX."""
        weight_attr = "survival_weight" if mode == "survival" else "direct_weight"

        try:
            path_nodes = nx.shortest_path(self.graph, source=origin_id, target=destination_id, weight=weight_attr)
        except nx.NetworkXNoPath:
            return {"error": "Sem rota viável. O caminho está bloqueado."}
        except nx.NodeNotFound as e:
            return {"error": f"Localização desconhecida: {str(e)}"}

        total_distance = 0.0
        total_danger = 0
        route_coordinates: List[List[float]] = []

        for i in range(len(path_nodes) - 1):
            u, v = path_nodes[i], path_nodes[i+1]
            edge_data = self.graph[u][v]
            
            total_distance += edge_data["distance_km"]
            total_danger += edge_data["danger_level"]
            
            # Acumula coordenadas sem duplicar o ponto de intersecção
            edge_coords = edge_data["geometry"]
            if not route_coordinates:
                route_coordinates.extend(edge_coords)
            else:
                route_coordinates.extend(edge_coords[1:])

        fuel_estimate = round(total_distance * 0.8, 1)

        return {
            "type": "Feature",
            "properties": {
                "navigation_mode": mode,
                "path_nodes": path_nodes,
                "total_distance_km": round(total_distance, 2),
                "total_danger_score": total_danger,
                "estimated_fuel_liters": fuel_estimate,
                "survival_probability": max(1, int(100 - (total_danger * 8.5)))
            },
            "geometry": {
                "type": "LineString",
                "coordinates": route_coordinates
            }
        }