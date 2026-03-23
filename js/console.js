// G1on Editor · Console de Log v1
// Sistema de log persistente — captura tudo, salva em localStorage, exportável

(function(){

// ── STORE ─────────────────────────────────────────────────────────────
const MAX_ENTRIES = 2000;
const LS_KEY = 'g1on_console_log';
let entries = [];
let paused = false;
let filterText = '';
let filterLevel = 'all'; // all | midi | op | error

// Carregar log anterior do localStorage
try {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) entries = JSON.parse(saved);
} catch(e) {}

// Salvar no localStorage (debounced)
let _saveTimer = null;
function saveToStorage() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES))); } catch(e) {}
  }, 500);
}

// Níveis e cores
const LEVELS = {
  'midi-tx':  { label: '→TX',    color: '#7c3aed', bg: 'rgba(124,58,237,.08)'  },
  'midi-rx':  { label: '←RX',    color: '#06b6d4', bg: 'rgba(6,182,212,.08)'   },
  'ok':       { label: '✓ OK',   color: '#10b981', bg: 'rgba(16,185,129,.08)'  },
  'error':    { label: '✗ ERR',  color: '#ef4444', bg: 'rgba(239,68,68,.1)'    },
  'warn':     { label: '⚠ WARN', color: '#f59e0b', bg: 'rgba(245,158,11,.08)'  },
  'info':     { label: 'ℹ INFO', color: '#3b82f6', bg: 'rgba(59,130,246,.06)'  },
  'op':       { label: '◈ OP',   color: '#e8e8f0', bg: 'rgba(255,255,255,.04)' },
  'patch':    { label: '♪ PATCH',color: '#a78bfa', bg: 'rgba(167,139,250,.07)' },
  'storage':  { label: '◫ STOR', color: '#34d399', bg: 'rgba(52,211,153,.07)'  },
  'debug':    { label: '◦ DBG',  color: '#5a5a7a', bg: 'transparent'           },
};

// ── API PÚBLICA ───────────────────────────────────────────────────────
const L = window.L = {};

L.log = function(level, msg, detail) {
  const entry = {
    id: Date.now() + Math.random(),
    ts: new Date().toISOString(),
    level,
    msg: String(msg),
    detail: detail !== undefined ? String(detail) : null,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  saveToStorage();
  if (!paused) renderEntry(entry);
};

// Atalhos semânticos
L.midiTx  = (msg, detail) => L.log('midi-tx', msg, detail);
L.midiRx  = (msg, detail) => L.log('midi-rx', msg, detail);
L.ok      = (msg, detail) => L.log('ok',      msg, detail);
L.error   = (msg, detail) => L.log('error',   msg, detail);
L.warn    = (msg, detail) => L.log('warn',    msg, detail);
L.info    = (msg, detail) => L.log('info',    msg, detail);
L.op      = (msg, detail) => L.log('op',      msg, detail);
L.patch   = (msg, detail) => L.log('patch',   msg, detail);
L.storage = (msg, detail) => L.log('storage', msg, detail);
L.debug   = (msg, detail) => L.log('debug',   msg, detail);

// Interceptar console.error e console.warn globais
const _cerr = console.error.bind(console);
const _cwarn = console.warn.bind(console);
console.error = (...a) => { _cerr(...a); L.error(a.map(String).join(' ')); };
console.warn  = (...a) => { _cwarn(...a); L.warn(a.map(String).join(' ')); };

// Capturar erros JS não tratados
window.addEventListener('error', e => {
  L.error(`[Uncaught] ${e.message}`, `${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', e => {
  L.error(`[UnhandledPromise] ${String(e.reason)}`);
});

// ── UI ────────────────────────────────────────────────────────────────
let consoleEl = null;
let listEl = null;
let isOpen = false;
let isExpanded = false;

function buildUI() {
  if (consoleEl) return;

  consoleEl = document.createElement('div');
  consoleEl.id = 'g1con';
  consoleEl.style.cssText = [
    'position:fixed;bottom:0;left:0;right:0;z-index:2000',
    'background:#0a0a12;border-top:2px solid #7c3aed',
    'font-family:var(--mono);font-size:.65rem;color:#e8e8f0',
    'display:none;flex-direction:column',
    'transition:height .2s',
  ].join(';');

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = [
    'display:flex;align-items:center;gap:8px;padding:4px 12px',
    'border-bottom:1px solid rgba(124,58,237,.3);flex-shrink:0',
    'background:#0d0d1a;user-select:none;cursor:row-resize',
  ].join(';');

  hdr.innerHTML = `
    <span style="color:#7c3aed;font-weight:700;letter-spacing:1px">◈ CONSOLE</span>
    <span id="g1con-count" style="color:#5a5a7a;font-size:.58rem"></span>
    <div style="display:flex;gap:6px;margin-left:4px">
      <span class="g1con-filter" data-level="all"    style="padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid rgba(124,58,237,.4);color:#7c3aed">TUDO</span>
      <span class="g1con-filter" data-level="midi"   style="padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid rgba(255,255,255,.1);color:#5a5a7a">MIDI</span>
      <span class="g1con-filter" data-level="op"     style="padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid rgba(255,255,255,.1);color:#5a5a7a">OPS</span>
      <span class="g1con-filter" data-level="error"  style="padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid rgba(255,255,255,.1);color:#5a5a7a">ERROS</span>
    </div>
    <input id="g1con-search" placeholder="filtrar..." style="
      flex:1;max-width:200px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
      color:#e8e8f0;font-family:var(--mono);font-size:.6rem;padding:2px 7px;border-radius:3px;outline:none
    "/>
    <div style="display:flex;gap:8px;align-items:center;margin-left:auto">
      <span id="g1con-pause" title="Pausar rolagem" style="cursor:pointer;color:#5a5a7a;padding:1px 6px;border:1px solid rgba(255,255,255,.1);border-radius:3px">⏸</span>
      <span id="g1con-expand" title="Expandir/recolher" style="cursor:pointer;color:#5a5a7a">⤢</span>
      <span id="g1con-export" title="Exportar log completo" style="cursor:pointer;color:#34d399;padding:1px 6px;border:1px solid rgba(52,211,153,.3);border-radius:3px">↓ LOG</span>
      <span id="g1con-clear" title="Limpar console (mantém histórico salvo)" style="cursor:pointer;color:#ef4444;padding:1px 6px;border:1px solid rgba(239,68,68,.2);border-radius:3px">CLR</span>
      <span id="g1con-close" style="cursor:pointer;color:#5a5a7a;font-size:.9rem;padding:0 4px">✕</span>
    </div>
  `;

  // List
  listEl = document.createElement('div');
  listEl.id = 'g1con-list';
  listEl.style.cssText = 'overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:#1e1e30 transparent;';

  consoleEl.appendChild(hdr);
  consoleEl.appendChild(listEl);
  document.body.appendChild(consoleEl);

  setHeight(false);

  // ── Eventos ──
  // Filtro por nível
  hdr.querySelectorAll('.g1con-filter').forEach(btn => {
    btn.onclick = () => {
      filterLevel = btn.dataset.level;
      hdr.querySelectorAll('.g1con-filter').forEach(b => {
        b.style.color = '#5a5a7a';
        b.style.borderColor = 'rgba(255,255,255,.1)';
      });
      btn.style.color = '#7c3aed';
      btn.style.borderColor = 'rgba(124,58,237,.4)';
      rebuildList();
    };
  });

  // Busca
  document.getElementById('g1con-search').oninput = e => {
    filterText = e.target.value.toLowerCase().trim();
    rebuildList();
  };

  // Pause
  document.getElementById('g1con-pause').onclick = function() {
    paused = !paused;
    this.style.color = paused ? '#f59e0b' : '#5a5a7a';
    this.textContent = paused ? '▶' : '⏸';
    this.title = paused ? 'Retomar rolagem' : 'Pausar rolagem';
    if (!paused) { rebuildList(); scrollToBottom(); }
  };

  // Expand
  document.getElementById('g1con-expand').onclick = function() {
    isExpanded = !isExpanded;
    setHeight(isExpanded);
    this.textContent = isExpanded ? '⤡' : '⤢';
  };

  // Export
  document.getElementById('g1con-export').onclick = exportLog;

  // Clear
  document.getElementById('g1con-clear').onclick = () => {
    if (confirm('Limpar visualização? O log salvo no localStorage é mantido.')) {
      listEl.innerHTML = '';
      L.info('Console limpo (histórico preservado no armazenamento local)');
    }
  };

  // Close
  document.getElementById('g1con-close').onclick = () => {
    consoleEl.style.display = 'none';
    isOpen = false;
    const btn = document.getElementById('g1con-btn');
    if (btn) btn.style.background = '';
  };

  // Resize por drag no header
  let dragging = false, dragY = 0, dragH = 0;
  hdr.onmousedown = e => {
    if (e.target.closest('span,input,button')) return;
    dragging = true; dragY = e.clientY;
    dragH = consoleEl.offsetHeight;
    document.onmousemove = e2 => {
      if (!dragging) return;
      const h = Math.max(120, Math.min(window.innerHeight * .85, dragH + (dragY - e2.clientY)));
      consoleEl.style.height = h + 'px';
    };
    document.onmouseup = () => { dragging = false; document.onmousemove = document.onmouseup = null; };
  };
}

function setHeight(expanded) {
  consoleEl.style.height = expanded ? Math.round(window.innerHeight * .65) + 'px' : '220px';
}

function scrollToBottom() {
  if (!paused) listEl.scrollTop = listEl.scrollHeight;
}

function matchFilter(entry) {
  if (filterLevel !== 'all') {
    if (filterLevel === 'midi'  && !entry.level.startsWith('midi')) return false;
    if (filterLevel === 'op'    && !['op','patch','storage','ok'].includes(entry.level)) return false;
    if (filterLevel === 'error' && !['error','warn'].includes(entry.level)) return false;
  }
  if (filterText) {
    const hay = (entry.msg + (entry.detail||'') + entry.level).toLowerCase();
    if (!hay.includes(filterText)) return false;
  }
  return true;
}

function renderEntry(entry) {
  if (!listEl) return;
  if (!matchFilter(entry)) return;

  const lv = LEVELS[entry.level] || LEVELS.debug;
  const time = entry.ts.slice(11, 23); // HH:MM:SS.mmm

  const row = document.createElement('div');
  row.dataset.id = entry.id;
  row.style.cssText = [
    'display:flex;gap:0;align-items:flex-start',
    'border-bottom:1px solid rgba(255,255,255,.03)',
    `background:${lv.bg}`,
    'padding:2px 0;',
  ].join(';');

  // Timestamp
  const tsEl = document.createElement('span');
  tsEl.style.cssText = 'color:#3a3a5a;padding:0 6px;flex-shrink:0;font-size:.58rem;line-height:1.6;min-width:86px';
  tsEl.textContent = time;

  // Level badge
  const lvEl = document.createElement('span');
  lvEl.style.cssText = `color:${lv.color};padding:0 6px;flex-shrink:0;font-size:.6rem;font-weight:700;line-height:1.6;min-width:64px;`;
  lvEl.textContent = lv.label;

  // Message
  const msgEl = document.createElement('span');
  msgEl.style.cssText = 'flex:1;padding:0 6px;line-height:1.6;word-break:break-all;white-space:pre-wrap;';
  msgEl.textContent = entry.msg;

  // Detail (collapsible for long MIDI hex strings)
  row.appendChild(tsEl);
  row.appendChild(lvEl);
  row.appendChild(msgEl);

  if (entry.detail) {
    const isLong = entry.detail.length > 60;
    if (isLong) {
      const detailToggle = document.createElement('span');
      detailToggle.style.cssText = 'color:#3a3a5a;padding:0 6px;cursor:pointer;flex-shrink:0;font-size:.58rem;line-height:1.6';
      detailToggle.textContent = '[+]';
      let detailShowing = false;
      const detailEl = document.createElement('div');
      detailEl.style.cssText = 'display:none;padding:1px 6px 3px 170px;color:#5a5a7a;word-break:break-all;font-size:.58rem';
      detailEl.textContent = entry.detail;
      detailToggle.onclick = () => {
        detailShowing = !detailShowing;
        detailEl.style.display = detailShowing ? 'block' : 'none';
        detailToggle.textContent = detailShowing ? '[-]' : '[+]';
      };
      row.appendChild(detailToggle);
      listEl.appendChild(row);
      listEl.appendChild(detailEl);
    } else {
      const detailEl = document.createElement('span');
      detailEl.style.cssText = 'color:#5a5a7a;padding:0 6px;font-size:.6rem;line-height:1.6';
      detailEl.textContent = entry.detail;
      row.appendChild(detailEl);
      listEl.appendChild(row);
    }
  } else {
    listEl.appendChild(row);
  }

  updateCount();
  scrollToBottom();
}

function rebuildList() {
  if (!listEl) return;
  listEl.innerHTML = '';
  const visible = entries.filter(matchFilter);
  visible.forEach(renderEntry);
  updateCount();
  scrollToBottom();
}

function updateCount() {
  const el = document.getElementById('g1con-count');
  if (el) el.textContent = `${entries.length} entradas`;
}

function exportLog() {
  const lines = entries.map(e => {
    const t = e.ts.slice(0,23).replace('T',' ');
    const lv = (LEVELS[e.level]?.label || e.level).replace(/[✓✗⚠ℹ◈♪◫◦→←]/g,'').trim();
    let line = `[${t}] [${lv.padEnd(5)}] ${e.msg}`;
    if (e.detail) line += `\n${''.padEnd(33)}  ${e.detail}`;
    return line;
  }).join('\n');

  const blob = new Blob([lines], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `g1on-log-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
  a.click();
  L.ok(`Log exportado: ${entries.length} entradas`);
}

// ── TOGGLE ────────────────────────────────────────────────────────────
L.toggle = function() {
  buildUI();
  isOpen = !isOpen;
  consoleEl.style.display = isOpen ? 'flex' : 'none';
  if (isOpen) {
    rebuildList();
    scrollToBottom();
  }
  const btn = document.getElementById('g1con-btn');
  if (btn) btn.style.background = isOpen ? 'rgba(124,58,237,.15)' : '';
};

L.open = function() { buildUI(); isOpen = true; consoleEl.style.display = 'flex'; rebuildList(); scrollToBottom(); };

// Adicionar botão CONSOLE na toolbar quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  const toolbar = document.querySelector('.toolbar');
  const debugBtn = document.getElementById('bd');
  if (toolbar && debugBtn) {
    const btn = document.createElement('button');
    btn.id = 'g1con-btn';
    btn.className = 'btn';
    btn.textContent = 'CONSOLE';
    btn.style.cssText = 'color:#7c3aed;border-color:rgba(124,58,237,.4)';
    btn.title = 'Console de log completo (erros, MIDI, operações)';
    btn.onclick = L.toggle;
    toolbar.insertBefore(btn, debugBtn);
  }

  // Log inicial
  L.info('G1on Editor iniciado', `v5 · ${new Date().toLocaleString('pt-BR')}`);
});

// ── ATALHO DE TECLADO ─────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); L.toggle(); }
});

})();
