/**
 * app/screener-panel.js
 * Screener feature: state, fetch orchestration, filtering, sorting, rendering.
 *
 * Other modules (MTF) access screener results via getScrResults() — never
 * by reaching into this module's scope directly.
 */

import { state }                                    from '../state/store.js';
import * as dom                                     from '../ui/dom.js';
import { fmt, fmtK, fmtSym, TF_ORDER }             from '../utils/helpers.js';
import { showToast, escHtml, sanitizeSym }          from './context.js';
import { batchFetchScreener }                       from '../services/exchange.js';
import {
  analyseSymbol, calcTFSnapshot,
  applyScreenerFilters, sortScreenerResults,
  SCR_DEFAULT_COINS, SCR_CURATED_TIERS,
} from '../services/screener.js';
import { getScreenerTextFilter }                    from '../components/search.js';
import { saveCollapsed }                            from '../state/persistence.js';

// ── Module-scope state ────────────────────────────────────────────────────────

const SCR_COINS_DEFAULT = SCR_DEFAULT_COINS;
const SCR_COINS_CURATED = Object.values(SCR_CURATED_TIERS)
  .flat()
  .filter((v, i, a) => a.indexOf(v) === i);

const SCR_AUTO_INTERVAL_MS = 5 * 60 * 1000;

let scrListMode  = 'default';
let scrCoinList  = [...SCR_COINS_DEFAULT];
let scrExchange  = 'bybit';
let scrTFs       = ['5m', '15m', '1h', '4h'];
let scrFilter    = 'all';
let scrSortKey   = 'score';
let scrSortAsc   = false;
let scrRunning   = false;
let scrResults   = [];
let scrAutoTimer = null;

// ── Public getter (used by mtf-panel.js) ──────────────────────────────────────

/** Returns a snapshot of current screener results. Do not mutate. */
export function getScrResults() { return scrResults; }

/** Returns the current screener exchange setting. */
export function getScrExchange() { return scrExchange; }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initScreener() {
  _scrUpdateCoinCount();
}

// ── Coin list management ──────────────────────────────────────────────────────

function _scrUpdateCoinCount() {
  const el = document.getElementById('scr-coin-count');
  if (el) el.textContent = `${scrCoinList.length} coins`;
}

export function scrSetListMode(mode, btn) {
  scrListMode = mode;
  scrCoinList = mode === 'curated' ? [...SCR_COINS_CURATED] : [...SCR_COINS_DEFAULT];
  _scrUpdateCoinCount();
  document.querySelectorAll('.scr-list-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const legend = document.getElementById('scr-tier-legend');
  if (legend) legend.style.display = mode === 'curated' ? 'flex' : 'none';
}

export function scrAddCustomCoin() {
  const inp  = document.getElementById('scr-coin-inp');
  if (!inp) return;
  const coin = sanitizeSym(inp.value);
  if (!coin) { showToast('Invalid symbol — letters and numbers only'); inp.value = ''; return; }
  if (scrCoinList.includes(coin)) { showToast(`${coin} already in list`); inp.value = ''; return; }
  scrCoinList.unshift(coin);
  _scrUpdateCoinCount();
  showToast(`✓ Added ${coin} (${scrCoinList.length} total)`);
  inp.value = '';
}

export function scrResetCoins() {
  scrCoinList = scrListMode === 'curated' ? [...SCR_COINS_CURATED] : [...SCR_COINS_DEFAULT];
  _scrUpdateCoinCount();
  showToast(`Reset to ${scrCoinList.length} ${scrListMode === 'curated' ? 'curated' : 'default'} coins`);
}

export async function scrFetchTopCoins(n, btn) {
  const fetchAll = (n == null);
  const origText = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    let symbols = [];
    const blocked = /UP|DOWN|BULL|BEAR|3L|3S|5L|5S|2L|2S|USDC|BUSD|TUSD|USDP|DAI|UST|FRAX|GUSD/;

    if (scrExchange === 'bybit') {
      const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', { signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      let filtered = (d?.result?.list || [])
        .filter(t => t.symbol.endsWith('USDT') && !blocked.test(t.symbol))
        .sort((a, b) => +b.turnover24h - +a.turnover24h);
      if (!fetchAll) filtered = filtered.slice(0, n);
      symbols = filtered.map(t => t.symbol);

    } else if (scrExchange === 'okx') {
      const r = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP', { signal: AbortSignal.timeout(15000) });
      const d = await r.json();
      let filtered = (d?.data || [])
        .filter(t => t.instId.endsWith('-USDT-SWAP') && !blocked.test(t.instId))
        .sort((a, b) => +b.volCcy24h - +a.volCcy24h);
      if (!fetchAll) filtered = filtered.slice(0, n);
      symbols = filtered.map(t => t.instId.replace('-USDT-SWAP', '') + 'USDT');

    } else {
      // Binance — route through proxy to avoid CORS (H-10 fix)
      const WORKER = 'https://terminal.ayodejialalade29.workers.dev';
      let r = await fetch(`${WORKER}?exchange=binance&endpoint=ticker24hr`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`Proxy returned ${r.status}. Try switching to Bybit or OKX.`);
      const d = await r.json();
      let filtered = d
        .filter(t => t.symbol.endsWith('USDT') && !blocked.test(t.symbol))
        .sort((a, b) => +b.quoteVolume - +a.quoteVolume);
      if (!fetchAll) filtered = filtered.slice(0, n);
      symbols = filtered.map(t => t.symbol);
    }

    if (!symbols.length) throw new Error('No symbols returned');
    const userAdded = scrCoinList.filter(s => !SCR_COINS_DEFAULT.includes(s) && !symbols.includes(s));
    scrCoinList = [...new Set([...symbols, ...userAdded])];
    _scrUpdateCoinCount();
    const label = fetchAll ? 'ALL' : 'top ' + symbols.length;
    showToast(`✓ Loaded ${label} coins from ${scrExchange} (${scrCoinList.length} total)`);

  } catch (e) {
    showToast(`❌ Failed to fetch from ${scrExchange}: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

// ── Filter / sort controls ────────────────────────────────────────────────────

export function scrSetFilter(filter, btn) {
  scrFilter = filter;
  document.querySelectorAll('.scr-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelector(`.scr-filter-btn[onclick*="'${filter}'"]`)?.classList.add('active');
  }
  renderScreenerTable();
}

export function scrSort(key) {
  if (scrSortKey === key) scrSortAsc = !scrSortAsc;
  else { scrSortKey = key; scrSortAsc = false; }
  const headers = ['sym', 'price', 'chg', 'signal', 'rsi', 'score', 'stack', 'mtf', 'vol', 'dist', 'hlpos', 'age'];
  const ths = document.querySelectorAll('#scr-table th');
  ths.forEach(th => th.classList.remove('sort-asc', 'sort-desc'));
  const idx = headers.indexOf(key);
  if (idx >= 0 && ths[idx]) ths[idx].classList.add(scrSortAsc ? 'sort-asc' : 'sort-desc');
  renderScreenerTable();
}

export function setScrTF(tf, btn) {
  const idx = scrTFs.indexOf(tf);
  if (idx >= 0) {
    if (scrTFs.length === 1) { showToast('Select at least one TF'); return; }
    scrTFs.splice(idx, 1);
  } else {
    scrTFs.push(tf);
    scrTFs.sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b));
  }
  btn?.classList.toggle('active', scrTFs.includes(tf));
}

// ── Run scan ──────────────────────────────────────────────────────────────────

export async function runScreener() {
  if (scrRunning) return;
  scrRunning = true;

  const btn = dom.el['scr-run-btn'];
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning…'; }
  dom.show(dom.el['scr-progress'], true);

  const coins     = scrCoinList.length ? scrCoinList : SCR_DEFAULT_COINS;
  const activeTFs = TF_ORDER.filter(t => scrTFs.includes(t));

  const rawData = await batchFetchScreener(coins, activeTFs, scrExchange, ({ done, total, sym }) => {
    const pct = Math.round(done / total * 100);
    dom.setStyle(dom.el['scr-progress-bar'], 'width', pct + '%');
    dom.setText(dom.el['scr-progress-lbl'], `${done}/${total} — ${sym}`);
  });

  scrResults = [];

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

    const r = analyseSymbol(
      sym,
      tfCandles[primaryTf],
      primaryTf,
      snapshotMap,
      activeTFs,
      Date.now(),
      scrExchange,
    );
    if (r) scrResults.push(r);
  });

  // Update HTF conflict flag for the currently-viewed symbol
  const currentResult = scrResults.find(r => r.sym === state.sym);
  state.currentSymHTFConflict = currentResult?.higherTFConflict ?? false;

  renderScreenerTable();
  scrRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '▶ Scan'; }
  dom.show(dom.el['scr-progress'], false);
  showToast(`Screener done: ${scrResults.length} symbols`);
}

// ── Auto scan ─────────────────────────────────────────────────────────────────

export function toggleScrAuto() {
  if (scrAutoTimer) {
    clearTimeout(scrAutoTimer);
    scrAutoTimer = null;
    showToast('Auto-scan off');
  } else {
    const scheduleNext = async () => {
      await runScreener();
      if (scrAutoTimer !== null) {
        scrAutoTimer = setTimeout(scheduleNext, SCR_AUTO_INTERVAL_MS);
      }
    };
    scrAutoTimer = setTimeout(scheduleNext, 0);
    showToast('Auto-scan: every 5 minutes');
  }
}

// ── Render table ──────────────────────────────────────────────────────────────

export function clearScreenerFilter() {
  const el = document.getElementById('scr-text-filter');
  if (el) { el.value = ''; el.dispatchEvent(new Event('input')); }
}

export function renderScreenerTable() {
  const tbody = dom.el['scr-tbody'];
  if (!tbody) return;

  const textQ = getScreenerTextFilter();
  let rows = applyScreenerFilters(scrResults, scrFilter).filter(r =>
    !textQ || r.sym.includes(textQ) || r.sym.replace('USDT', '').includes(textQ)
  );
  rows = sortScreenerResults(rows, scrSortKey, scrSortAsc);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="14" class="scr-empty">No results — run a scan first</td></tr>';
    return;
  }

  // Apply column header hints once
  const thead = document.querySelector('#scr-table thead tr');
  if (thead && !thead.dataset.hintsApplied) {
    const hints = [
      ['sym',    'Symbol — click to trade'],
      ['price',  'Last traded price'],
      ['chg',    '24-hour price change %'],
      ['signal', 'EMA 9/20/50 stack direction'],
      ['rsi',    'RSI-14 (>70 overbought, <30 oversold)'],
      ['score',  'Composite setup quality score (0–100)'],
      ['stack',  'EMA order: 9 vs 20 vs 50'],
      ['mtf',    'Weighted multi-timeframe confluence — higher TFs count more'],
      ['vol',    'Volume vs 20-bar avg · ✓ direction-aligned · ⚠ opposed'],
      ['dist',   '% distance of price from EMA20'],
      ['hlpos',  'Price in 24h range · ✓ = good entry side · ⚠ = extended'],
      ['age',    'Candles since last EMA9/20 cross'],
      ['fib',    'Nearest Fib level and direction'],
    ];
    const ths = thead.querySelectorAll('th');
    hints.forEach(([, tip], i) => {
      if (ths[i]) { ths[i].setAttribute('title', tip); ths[i].style.cursor = 'pointer'; }
    });
    thead.dataset.hintsApplied = '1';
  }

  const top5 = new Set([...rows].sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.sym));

  tbody.innerHTML = rows.map(r => {
    const safeSym  = escHtml(r.sym);
    const safeDisp = escHtml(fmtSym(r.sym));

    const chgCls   = r.chgPct >= 0 ? 'pos' : 'neg';
    const isTop5   = top5.has(r.sym);
    const rowStyle = isTop5 ? 'background:rgba(0,229,160,0.04);border-left:2px solid rgba(0,229,160,0.5)' : '';

    const scoreCol = r.score >= 75 ? '#00e5a0' : r.score >= 50 ? '#4da6ff' : r.score >= 30 ? '#ffb82e' : '#3d4460';
    const stackCol = r.bullStack ? '#00e5a0' : r.bearStack ? '#ff3d5a' : '#ffb82e';
    const stackTxt = r.bullStack ? '9>20>50' : r.bearStack ? '9<20<50' : '⚠ MIX';

    const mtfStr = r.availTFs > 0 ? `${r.mtfScore}%` : '—';
    const mtfCol = r.higherTFConflict ? '#ff3d5a'
                 : r.mtfFull          ? '#00e5a0'
                 : r.mtfMost          ? '#ffb82e'
                 :                      'var(--text2)';
    const mtfTitle = r.higherTFConflict ? 'Higher TF contradicts signal' : '';

    const volCol  = r.volSpike && r.volAligned  ? '#00e5a0'
                  : r.volSpike && r.volOpposed  ? '#ff3d5a'
                  : r.volHot                    ? '#ffb82e'
                  :                               'var(--text2)';
    const volBg   = r.volSpike && r.volAligned  ? 'rgba(0,229,160,0.10)'
                  : r.volSpike && r.volOpposed  ? 'rgba(255,61,90,0.10)'
                  : r.volHot                    ? 'rgba(255,184,46,0.08)'
                  :                               'transparent';
    const volMark = r.volSpike && r.volAligned  ? '🔥✓'
                  : r.volSpike && r.volOpposed  ? '🔥⚠'
                  : r.volHot  && r.volAligned   ? '⚡✓'
                  : r.volHot                    ? '⚡'
                  :                               '';
    const volStr  = r.volRatio != null ? r.volRatio.toFixed(1) + 'x' : '—';

    const distAbs = r.e20dist != null ? Math.abs(r.e20dist) : null;
    const distCol = distAbs != null ? (distAbs <= 1 ? '#00e5a0' : distAbs > 5 ? '#ff3d5a' : 'var(--text2)') : 'var(--text2)';
    const distStr = distAbs != null ? (r.e20dist >= 0 ? '+' : '-') + distAbs.toFixed(1) + '%' : '—';

    const hlPos    = r.hlPos ?? 50;
    const hlBarCol = hlPos >= 80 ? '#ff3d5a' : hlPos <= 20 ? '#00e5a0' : '#4da6ff';
    const hlLabel  = hlPos >= 80 ? 'High' : hlPos <= 20 ? 'Low' : Math.round(hlPos) + '%';
    const hlMark   = (r.signal === 'bull' && r.nearLow)   ? ' ✓'
                   : (r.signal === 'bear' && r.nearHigh)  ? ' ✓'
                   : (r.signal === 'bull' && r.nearHigh)  ? ' ⚠'
                   : (r.signal === 'bear' && r.nearLow)   ? ' ⚠'
                   :                                         '';
    const hlMarkCol = hlMark === ' ✓' ? '#00e5a0' : hlMark === ' ⚠' ? '#ffb82e' : 'var(--text2)';

    const ageTxt = r.trendAge != null ? r.trendAge + 'c' : '—';
    const ageCol  = r.trendAge <= 3  ? '#00e5a0'
                  : r.trendAge <= 8  ? '#4da6ff'
                  : r.trendAge <= 40 ? 'var(--text3)'
                  :                    '#ff3d5a';

    let fibTxt = '—', fibCol = 'var(--text3)';
    if (r.fibProximity) {
      const { label, tier, dirLabel } = r.fibProximity;
      fibTxt = `${label} ${dirLabel}`;
      fibCol = tier === 'gold' ? '#a78bff' : tier === 'key' ? '#4da6ff' : 'var(--text2)';
    }

    const badges = [];
    if (r.divAligned)       badges.push(`<span title="RSI divergence confirms signal" style="font-size:8px;color:#00e5a0">Div✓</span>`);
    if (r.divOpposed)       badges.push(`<span title="RSI divergence contradicts signal" style="font-size:8px;color:#ff3d5a">Div⚠</span>`);
    if (r.accelAligned)     badges.push(`<span title="Momentum accelerating" style="font-size:8px;color:#ffb82e">Accel</span>`);
    if (r.higherTFConflict) badges.push(`<span title="Higher TF opposes signal" style="font-size:8px;color:#ff3d5a">HTF⚠</span>`);

    return `<tr style="${rowStyle}">
      <td>
        <span class="scr-sym" onclick="TT.loadCoinFromScreener('${safeSym}')">${safeDisp}${isTop5 ? '⭐' : ''}</span>
        <div style="display:flex;gap:3px;margin-top:2px;flex-wrap:wrap">
          <span style="font-size:8px;color:var(--text3);font-family:var(--mono)">${r.primaryTf || '—'}</span>
          ${badges.join('')}
        </div>
      </td>
      <td class="scr-price">${fmt(r.price)}</td>
      <td class="scr-chg ${chgCls}">${(r.chgPct >= 0 ? '+' : '') + r.chgPct.toFixed(2) + '%'}</td>
      <td><span class="signal-badge signal-${r.signal}">${r.signalLabel}</span></td>
      <td class="scr-rsi">${r.rsi !== null ? Math.round(r.rsi) : '—'}</td>
      <td>
        <div class="score-bar">
          <div class="score-track">
            <div class="score-fill" style="width:${r.score}%;background:${scoreCol}"></div>
          </div>
          <span style="font-size:9px;color:${scoreCol};font-family:var(--mono);font-weight:700;min-width:24px">${r.score}</span>
        </div>
      </td>
      <td><span style="font-family:var(--mono);font-size:9px;font-weight:700;color:${stackCol}">${stackTxt}</span></td>
      <td title="${mtfTitle}"><span style="font-family:var(--mono);font-size:9px;font-weight:700;color:${mtfCol}">${mtfStr}${r.higherTFConflict ? ' ⚠' : ''}</span></td>
      <td title="Vol ratio: ${r.volRatio != null ? r.volRatio.toFixed(2) : '—'}x${r.volSpike ? ' | 🔥 Spike' : r.volHot ? ' | ⚡ Hot' : ''}${r.volAligned ? ' | ✓ Aligned' : r.volOpposed ? ' | ⚠ Opposed' : ''}">
        <span style="font-family:var(--mono);font-size:9px;font-weight:700;color:${volCol};background:${volBg};border-radius:6px;padding:1px 5px">${volStr}${volMark}</span>
      </td>
      <td><span style="font-family:var(--mono);font-size:9px;color:${distCol}">${distStr}</span></td>
      <td title="24h High: ${fmt(r.hi24)} | Low: ${fmt(r.lo24)} | Position: ${Math.round(hlPos)}%">
        <div style="position:relative;width:36px;height:6px;background:var(--bg3);border-radius:2px;display:inline-block">
          <div style="position:absolute;left:0;top:0;height:100%;width:${hlPos}%;background:${hlBarCol};border-radius:2px"></div>
        </div>
        <span style="font-family:var(--mono);font-size:8px;color:${hlMarkCol};margin-left:3px">${hlLabel}${hlMark}</span>
      </td>
      <td><span style="font-family:var(--mono);font-size:9px;color:${ageCol}">${ageTxt}</span></td>
      <td><span style="font-family:var(--mono);font-size:9px;color:${fibCol}">${fibTxt}</span></td>
      <td><button class="scr-trade-btn" onclick="TT.loadCoinFromScreener('${safeSym}')">Trade →</button></td>
    </tr>`;
  }).join('');
}

// ── Exchange sync (called by symbol-nav when exchange switches) ───────────────

export function setScrExchange(name) {
  scrExchange = name;
}
