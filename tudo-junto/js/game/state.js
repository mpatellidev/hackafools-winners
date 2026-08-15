import { modes } from './graph-data.js';

export const state = {
  src: null,       // { id, label }
  dst: null,       // { id, label }
  mode: modes[0].id,
  pickMode: null,  // 'src' | 'dst' | null
  running: false
};
