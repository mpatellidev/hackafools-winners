export const state = {
  src: null,       // { id, label }
  dst: null,       // { id, label }
  mode: 'survival', // 'survival' | 'direct' — bate com RouteRequest.navigation_mode
  pickMode: null,   // 'src' | 'dst' | null
  running: false
};
