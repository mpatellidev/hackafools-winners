import { logCount as logCounter, state } from './state.js'; // Importa referência

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function setProgress(pct, label) {
  const fill = document.getElementById('progFill');
  const labelEl = document.getElementById('progLabel');
  const pctEl = document.getElementById('progPct');
  if (fill) fill.style.width = pct + '%';
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = pct + '%';
}

export function addLog(type, msg) {
  const container = document.getElementById('logEntries');
  const countSpan = document.getElementById('logCount');
  
  if (!container) return;
  
  // Incrementa contador global
  if (typeof window.__logCount === 'undefined') window.__logCount = 0;
  window.__logCount++;
  
  const el = document.createElement('div');
  el.className = `log-entry type-${type}`;
  el.innerHTML = `
    <div class="log-dot"></div>
    <div class="log-text">${msg}</div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  
  if (countSpan) {
    countSpan.textContent = `${window.__logCount} entrada${window.__logCount !== 1 ? 's' : ''}`;
  }
}

export function resetLogCount() {
  window.__logCount = 0;
  const countSpan = document.getElementById('logCount');
  if (countSpan) countSpan.textContent = '0 entradas';
  const container = document.getElementById('logEntries');
  if (container) container.innerHTML = '';
}