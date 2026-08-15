export const map = L.map('map', {
  center: [-23.55, -46.63],
  zoom: 13,
  zoomControl: true,
  attributionControl: false
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19,
  subdomains: 'abcd'
}).addTo(map);

L.control.attribution({
  position: 'bottomright',
  prefix: 'RouteFinder © OpenStreetMap'
}).addTo(map);