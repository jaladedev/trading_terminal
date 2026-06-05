/**
 * app/mtf-panel.js
 * Multi-timeframe confluence panel: state, scan orchestration, rendering.
 *
 * Reads screener results via getScrResults() — never by reaching into
 * screener-panel.js module scope directly.
 */

import { state }                               from '../state/store.js';
import * as dom                                from '../ui/dom.js';
import { fmt, fmtSym, TF_ORDER }               from '../utils/helpers.js';
import { showToast, escHtml, sanitizeSym }     from './context.js';
import { getScrResults, getScrExchange }        from './screener-panel.js';
import { batchFetchScreener }                  from '../services/exchange.js';
import { analyseSymbol, calcTFSnapshot }        from '../services/screener.js';
import { saveCollapsed }                        from '../state/persistence.js';

// ── Module-scope state ────────────────────────────────────────────────────────

let mtfCoins   = [];
let mtfTFs     = ['5m', '15m', '30m', '1h', '4h'];
let mtfResults = [];
let mtfFilter  = 'all';
let mtfRunning = false;

const MTF_TOP_N_FROM_SCR = 20;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initMTF() {
  _mtfUpdateCoinCount();
}

// ── Coin list management ──────────────────────────────────────────────────────

function _mtfUpdateCoinCount() {
  const el = document.getElementById('mtf-coin-count');
  if (el) el.textContent = `${mtfCoins.length} coin${mtfCoins.length !== 1 ? 's' : ''}`;
}

export function mtfAddCoin() {
  const inp = document.getElementById('mtf-coin-inp');
  if (!inp) return;
  const sym = sanitizeSym(inp.value);
  if (!sym) { showToast('Invalid symbol — letters and numbers only'); inp.value = ''; return; }
  if (mtfCoins.includes(sym)) { showToast(`${sym} already added`); inp.value = ''; return; }
  mtfCoins.push(sym);
  _mtfUpdateCoinCount();
  showToast(`✓ ${sym} added`);
  inp.value = '';
}

export function mtfClearCoins() {
  mtfCoins   = [];
  mtfResults = [];
  _mtfUpdateCoinCount();
  renderMTFTable();
}

export function mtfLoadFromScreener() {
  const results = getScrResults();
  if (!results.length) { showToast('Run screener first'); return; }
  const top = [...results]
    .sort((a, b) => b.score - a.score)
    .slice(0, MTF_TOP_N_FROM_SCR)
    .map(r => r.sym);
  mtfCoins = [...new Set([...mtfCoins, ...top])];
  _mtfUpdateCoinCount();
  showToast(`✓ Loaded ${top.length} coins from screener`);
}

export function mtfLoadWatchlist() {
  if (!state.watchlist.length) { showToast('Watchlist is empty'); return; }
  mtfCoins = [...new Set([...mtfCoins, ...state.watchlist])];
  _mtfUpdateCoinCount();
  showToast(`✓ Loaded ${state.watchlist.length} watchlist coins`);
}

export function mtfScanCurrent() {
  const sym = state.sym;
  if (!sym) { showToast('No symbol loaded'); return; }

  if (!mtfCoins.includes(sym)) {
    mtfCoins.unshift(sym);
    _mtfUpdateCoinCount();
  }

  const card = document.getElementById('card-mtf');
  if (card?.classList.contains('collapsed')) {
    card.classList.remove('collapsed');
    saveCollapsed('card-mtf', false);
  }
  card?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  showToast(`Scanning ${fmtSym(sym)} across ${mtfTFs.join(', ')}…`);
  runMTFScan();
}

// ── TF / filter controls ──────────────────────────────────────────────────────

export function toggleMTFTf(tf, btn) {
  const idx = mtfTFs.indexOf(tf);
  if (idx >= 0) {
    if (mtfTFs.length === 1) { showToast('Need at least one TF'); return; }
    mtfTFs.splice(idx, 1);
  } else {
    mtfTFs.push(tf);
    mtfTFs.sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b));
  }
  btn?.classList.toggle('active', mtfTFs.includes(tf));
}

export function mtfSetFilter(f, btn) {
  mtfFilter = f;
  document.querySelectorAll('#card-mtf .scr-filter-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderMTFTable();
}

// ── Run scan ──────────────────────────────────────────────────────────────────

export async function runMTFScan() {
  if (mtfRunning) return;
  if (!mtfCoins.length) { showToast('Add coins first'); return; }

  mtfRunning = true;
  const btn     = document.getElementById('mtf-scan-btn');
  const prog    = document.getElementById('mtf-progress');
  const progBar = document.getElementById('mtf-progress-bar');
  const progLbl = document.getElementById('mtf-progress-lbl');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning…'; }
  if (prog) prog.style.display = 'block';

  const activeTFs = TF_ORDER.filter(t => mtfTFs.includes(t));
  const exch      = getScrExchange();

  // Use cached screener results where possible
  const scrCache  = new Map(getScrResults().map(r => [r.sym, r]));
  const needFetch = mtfCoins.filter(s => !scrCache.has(s));
  const useCache  = mtfCoins.filter(s =>  scrCache.has(s));

  mtfResults = [];

  useCache.forEach(sym => {
    const r = scrCache.get(sym);
    mtfResults.push({
      sym,
      price:     r.price,
      signal:    r.signal,
      tfs:       r.mtfBreakdown || activeTFs.map(t => ({ tf: t, signal: 'none', weight: 1 })),
      score:     r.score,
      mtfScore:  r.mtfScore,
      mtfFull:   r.mtfFull,
      conflict:  r.higherTFConflict,
      fromCache: true,
    });
  });

  if (needFetch.length) {
    const rawData = await batchFetchScreener(needFetch, activeTFs, exch, ({ done, total, sym }) => {
      const pct = Math.round((useCache.length + done) / mtfCoins.length * 100);
      if (progBar) progBar.style.width = pct + '%';
      if (progLbl) progLbl.textContent = `${useCache.length + done}/${mtfCoins.length} — ${sym}`;
    });

    rawData.forEach((tfCandles, sym) => {
      const primaryTf = activeTFs.find(t => tfCandles[t]?.length >= 15);
      if (!primaryTf) return;

      const snapshotMap = {};
      activeTFs.forEach(tf => {
        const candles = tfCandles[tf];
        if (!candles?.length) return;
        const snap = calcTFSnapshot(candles, tf);
        if (snap) snapshotMap[tf] = snap;
      });

      const r = analyseSymbol(sym, tfCandles[primaryTf], primaryTf, snapshotMap, activeTFs, Date.now(), exch);
      if (!r) return;

      mtfResults.push({
        sym,
        price:     r.price,
        signal:    r.signal,
        tfs:       r.mtfBreakdown || activeTFs.map(t => ({ tf: t, signal: 'none', weight: 1 })),
        score:     r.score,
        mtfScore:  r.mtfScore,
        mtfFull:   r.mtfFull,
        conflict:  r.higherTFConflict,
        fromCache: false,
      });
    });
  }

  mtfResults.sort((a, b) => {
    if (a.mtfFull && !b.mtfFull) return -1;
    if (!a.mtfFull && b.mtfFull) return  1;
    return b.mtfScore - a.mtfScore;
  });

  renderMTFTable();
  mtfRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '▶ Scan'; }
  if (prog) prog.style.display = 'none';
  showToast(`MTF scan done — ${mtfResults.length} coins (${useCache.length} cached, ${needFetch.length} fetched)`);
}

// ── Render table ──────────────────────────────────────────────────────────────

export function renderMTFTable() {
  const tbody    = document.getElementById('mtf-tbody');
  const theadRow = document.getElementById('mtf-thead-row');
  if (!tbody || !theadRow) return;

  const activeTFs = TF_ORDER.filter(t => mtfTFs.includes(t));

  const TF_WEIGHT = { '1m':1, '3m':1, '5m':1, '15m':2, '30m':2, '1h':3, '4h':5, '1d':8 };

  theadRow.innerHTML = `
    <th>Symbol</th>
    <th>Price</th>
    <th>Overall</th>
    ${activeTFs.map(tf => `<th title="Weight: ${TF_WEIGHT[tf] || 1}×">${tf}</th>`).join('')}
    <th>Score</th>
    <th></th>
  `;

  let rows = mtfResults.filter(r => {
    const bullCount = r.tfs.filter(t => t.signal === 'bull').length;
    const bearCount = r.tfs.filter(t => t.signal === 'bear').length;
    const total     = r.tfs.filter(t => t.signal !== 'none').length;
    switch (mtfFilter) {
      case 'full_bull': return bullCount === total && total > 0;
      case 'full_bear': return bearCount === total && total > 0;
      case 'conflict':  return r.conflict;
      case 'clean':     return !r.conflict;
      default:          return true;
    }
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${activeTFs.length + 4}" class="scr-empty">${mtfResults.length ? 'No coins match filter' : 'No results — run a scan first'}</td></tr>`;
    return;
  }

  const SIG_COLOR = { bull: '#00e5a0', bear: '#ff3d5a', tang: '#ffb82e', none: 'var(--text3)' };
  const SIG_LABEL = { bull: '▲', bear: '▼', tang: '~', none: '—' };
  const SIG_BG    = { bull: 'rgba(0,229,160,0.12)', bear: 'rgba(255,61,90,0.12)', tang: 'rgba(255,184,46,0.08)', none: 'transparent' };

  tbody.innerHTML = rows.map(r => {
    const safeSym  = escHtml(r.sym);
    const safeDisp = escHtml(fmtSym(r.sym));

    const bullCount  = r.tfs.filter(t => t.signal === 'bull').length;
    const bearCount  = r.tfs.filter(t => t.signal === 'bear').length;
    const total      = r.tfs.filter(t => t.signal !== 'none').length;
    const allBull    = bullCount === total && total > 0;
    const allBear    = bearCount === total && total > 0;
    const overallCol = allBull ? '#00e5a0' : allBear ? '#ff3d5a' : r.conflict ? '#ff3d5a' : '#ffb82e';
    const overallTxt = allBull ? '▲ Full Bull' : allBear ? '▼ Full Bear' : r.conflict ? '⚠ Conflict' : `${bullCount}B ${bearCount}S`;
    const scoreCol   = r.score >= 75 ? '#00e5a0' : r.score >= 50 ? '#4da6ff' : r.score >= 30 ? '#ffb82e' : '#3d4460';
    const cacheTag   = r.fromCache
      ? `<span title="Using cached screener data" style="font-size:7px;color:var(--text3);font-family:var(--mono)">cached</span>`
      : '';

    const tfMap   = Object.fromEntries(r.tfs.map(t => [t.tf, t.signal]));
    const tfCells = activeTFs.map(tf => {
      const sig = tfMap[tf] || 'none';
      return `<td style="text-align:center;background:${SIG_BG[sig]}">
        <span style="font-family:var(--mono);font-size:11px;font-weight:700;color:${SIG_COLOR[sig]}"
              title="${tf}: ${sig}">${SIG_LABEL[sig]}</span>
      </td>`;
    }).join('');

    return `<tr>
      <td>
        <span class="scr-sym" onclick="TT.loadCoinFromScreener('${safeSym}')">${safeDisp}</span>
        <div style="margin-top:2px">${cacheTag}</div>
      </td>
      <td class="scr-price" style="font-size:10px">${fmt(r.price)}</td>
      <td><span style="font-family:var(--mono);font-size:9px;font-weight:700;color:${overallCol}">${overallTxt}</span></td>
      ${tfCells}
      <td>
        <div class="score-bar">
          <div class="score-track">
            <div class="score-fill" style="width:${r.score}%;background:${scoreCol}"></div>
          </div>
          <span style="font-size:9px;color:${scoreCol};font-family:var(--mono);font-weight:700;min-width:24px">${r.score}</span>
        </div>
      </td>
      <td><button class="scr-trade-btn" onclick="TT.loadCoinFromScreener('${safeSym}')">Trade →</button></td>
    </tr>`;
  }).join('');
}
