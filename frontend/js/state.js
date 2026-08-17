export const state = {
  origin: null,
  destination: null,
  routes: [],
  activeRouteId: null,
  loading: false,
  pickMode: null,
  placement: null
};

export function activeRoute() {
  return state.routes.find((route) => route.id === state.activeRouteId) || state.routes[0] || null;
}
