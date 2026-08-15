import { initUI, updateRunBtn, resetAlgoUI } from './js/ui.js';
import { map } from './js/map.js';
import { setupInputSearch, reverseGeocode } from './js/geocoding.js';
import { placeMarker } from './js/markers.js';
import { state, markers, layers } from './js/state.js';

// Elementos visuais de pick
const pickBadge = document.getElementById('pickBadge');
const mapHint = document.getElementById('mapHint');

function setPickMode(mode) {
    state.pickMode = mode;
    if (mode) {
        const txt = mode === 'src' ? '📍 Clique no mapa: ORIGEM' : '🎯 Clique no mapa: DESTINO';
        if (pickBadge) {
            pickBadge.textContent = txt;
            pickBadge.classList.add('visible');
        }
        map.getContainer().style.cursor = 'crosshair';
    } else {
        if (pickBadge) {
            pickBadge.classList.remove('visible');
        }
        map.getContainer().style.cursor = '';
    }
}

function showHint(msg, ms) {
    if (!mapHint) return;
    mapHint.textContent = msg;
    mapHint.classList.add('visible');
    if (ms && ms < 9999) {
        setTimeout(() => {
            if (mapHint) mapHint.classList.remove('visible');
        }, ms);
    }
}

// Inicializa UI
initUI();

// Configura buscas
setupInputSearch('srcInput', 'srcSug', 'src');
setupInputSearch('dstInput', 'dstSug', 'dst');

// Click no mapa
map.on('click', async (e) => {
    if (!state.pickMode) return;

    const { lat, lng } = e.latlng;
    showHint('Buscando endereço...', 99999);

    try {
        const label = await reverseGeocode(lat, lng);
        placeMarker(state.pickMode, lat, lng, label);
        map.setView([lat, lng], 15);

        setPickMode(null);
        if (mapHint) mapHint.classList.remove('visible');
    } catch (error) {
        console.error('Erro ao buscar endereço:', error);
        showHint('Erro ao buscar endereço', 2000);
        setPickMode(null);
    }
});

// Botões de pick
const pickSrcBtn = document.getElementById('pickSrcBtn');
const pickDstBtn = document.getElementById('pickDstBtn');

if (pickSrcBtn) {
    pickSrcBtn.onclick = () => {
        setPickMode(state.pickMode === 'src' ? null : 'src');
    };
}

if (pickDstBtn) {
    pickDstBtn.onclick = () => {
        setPickMode(state.pickMode === 'dst' ? null : 'dst');
    };
}

// Limpar tudo
const clearBtn = document.getElementById('clearBtn');
if (clearBtn) {
    clearBtn.onclick = () => {
        setPickMode(null);
        ['src', 'dst'].forEach(type => {
            if (markers[type]) {
                map.removeLayer(markers[type]);
                markers[type] = null;
            }
            state[type] = null;
            const input = document.getElementById(type + 'Input');
            if (input) input.value = '';
        });

        if (layers.route) {
            map.removeLayer(layers.route);
            layers.route = null;
        }

        layers.anim.forEach(l => map.removeLayer(l));
        layers.anim.length = 0;

        updateRunBtn();
        resetAlgoUI();
    };
}

// Limpar campos individuais (caso não estejam no ui.js)
const srcClear = document.getElementById('srcClear');
const dstClear = document.getElementById('dstClear');

if (srcClear) {
    srcClear.onclick = () => {
        if (markers.src) {
            map.removeLayer(markers.src);
            markers.src = null;
        }
        state.src = null;
        const input = document.getElementById('srcInput');
        if (input) input.value = '';
        updateRunBtn();
        resetAlgoUI();
    };
}

if (dstClear) {
    dstClear.onclick = () => {
        if (markers.dst) {
            map.removeLayer(markers.dst);
            markers.dst = null;
        }
        state.dst = null;
        const input = document.getElementById('dstInput');
        if (input) input.value = '';
        updateRunBtn();
        resetAlgoUI();
    };
}

// Mensagem inicial
showHint('Use os botões abaixo do painel para definir os pontos, ou busque por endereço', 4000);