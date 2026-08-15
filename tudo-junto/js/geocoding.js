import { placeMarker } from './markers.js';
import { map } from './map.js';

export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=pt`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
  return res.json();
}

export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
  const data = await res.json();
  return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function setupInputSearch(inputId, sugId, type) {
  let timer;
  const input = document.getElementById(inputId);
  const sug = document.getElementById(sugId);
  const group = document.getElementById(inputId.replace('Input', 'Group'));

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { 
      sug.style.display = 'none'; 
      return; 
    }
    
    timer = setTimeout(async () => {
      const results = await geocode(q);
      if (!results.length) { 
        sug.style.display = 'none'; 
        return; 
      }
      
      sug.innerHTML = results.map(r => `
        <div class="suggestion-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.display_name}">
          <div class="sug-name">${r.display_name.split(',').slice(0,2).join(',')}</div>
          <div class="sug-addr">${r.display_name.split(',').slice(2,4).join(',')}</div>
        </div>
      `).join('');
      sug.style.display = 'block';
      
      sug.querySelectorAll('.suggestion-item').forEach(el => {
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat);
          const lon = parseFloat(el.dataset.lon);
          placeMarker(type, lat, lon, el.dataset.name);
          map.setView([lat, lon], 14);
          sug.style.display = 'none';
          input.value = el.dataset.name.split(',')[0];
        });
      });
    }, 400);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#${inputId.replace('Input','Group')}`)) {
      sug.style.display = 'none';
    }
  });
}