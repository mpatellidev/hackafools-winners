import { map } from './map.js';
import { state, markers } from './state.js';
import { updateRunBtn, resetAlgoUI } from './ui.js';

export function makeIcon(color, letter) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:36px;height:36px;border-radius:50% 50% 50% 0;
      background:${color};
      border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      font-family:'Syne',sans-serif;font-weight:800;font-size:14px;
      color:#000;
      transform:rotate(-45deg);
      box-shadow:0 4px 16px rgba(0,0,0,.5);
    "><span style="transform:rotate(45deg)">${letter}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -38]
  });
}

export function placeMarker(type, lat, lon, label) {
  if (markers[type]) map.removeLayer(markers[type]);
  
  const color = type === 'src' ? '#00b8ff' : '#ff5c8a';
  const letter = type === 'src' ? 'A' : 'B';
  
  markers[type] = L.marker([lat, lon], { icon: makeIcon(color, letter) })
    .addTo(map)
    .bindPopup(`<strong>${type === 'src' ? '📍 Origem' : '🎯 Destino'}</strong><br>${label}`);
    
  state[type] = { lat, lon, label };
  
  const inputEl = document.getElementById(type === 'src' ? 'srcInput' : 'dstInput');
  if (inputEl) {
    const short = label.length > 40 ? label.substring(0, 40) + '...' : label;
    inputEl.value = short;
  }
  
  updateRunBtn();
  resetAlgoUI();
}