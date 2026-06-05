/**
 * app/symbol-nav.js
 * Symbol/TF/exchange navigation, keyboard controls, indicator worker,
 * and live trade tick processing.
 *
 * Owns: _initSymSeq (race guard), klineWs, tradeStream, indicatorWorker.
 */

import { state, resetCandleState }            from '../state/store.js';
import { loadSettings, saveSettings, saveCollapsed, loadCollapsed } from '../state/persistence.js';
import * as dom                               from '../ui/dom.js';
import { fmt, fmtSym, TF_MS }                from '../utils/helpers.js';
import { ctx, setConnStatus, showToast }      from './context.js';
import {
  addCandleToState,
  ensureAvwapState,
  recomputeAvwap,
  setAnchorMode,
  getAnchorMode,
}                                             from './candle-state.js';
import { writeAvwapLabel }                    from './ui-updaters.js';
import { updateDeltaTicker }                  from './ui-updaters.js';
import { computeAndRender }                   from './render-pipeline.js';
import { drawAll, applyChartTheme, resizeChart } from './chart-manager.js';
import {
  scheduleRender,
  cancelPendingRender,
  RenderPriority,
}                                             from '../engine/renderer.js';
import { KlineWebSocket, TradeStream, fetchKlines } from '../services/exchange.js';
import { setScrExchange }                     from './screener-panel.js';
import { checkAlerts }                        from './sidebar-widgets.js';

// ── Module-scope refs ──────────────────────────────────────────────────────────

let klineWs         = null;
let tradeStream     = null;
let indicatorWorker = null;
let workerPending   = false;
let workerQueue     = null;
let _initSymSeq     = 0;

// ── Worker ─────────────────────────────────────────────────────────────────────

export function initIndicatorWorker() {
  try {
    indicatorWorker = new Worker(new URL('../workers/indicator.worker.js', import.meta.url));
    indicatorWorker.onmessage = e => {
      workerPending = false;
      if (e.data.type === 'result') _onWorkerResult(e.data);
      if (workerQueue) {
        const q = workerQueue;
        workerQueue = null;
        dispatchToWorker(q);
      }
    };
    indicatorWorker.onerror = () => { indicatorWorker = null; };
  } catch (e) {
    indicatorWorker = null;
  }
}

export function dispatchToWorker(candles) {
  if (!indicatorWorker) return;
  if (workerPending) { workerQueue = candles; return; }
  workerPending = true;
  indicatorWorker.postMessage({ type: 'calc_all', candles, params: { vpBins: 24 } });
}

function _onWorkerResult(data) {
  if (data.vp) {
    state.workerVP = data.vp;
    dom.batch(() => {
      // Import lazily to avoid circular (ui-updaters → candle-state → symbol-nav)
      import('./ui-updaters.js').then(({ updateVPLabels }) => updateVPLabels(data.vp));
    });
  }
  if (data.regime) state.regime = { ...state.regime, ...data.regime };
  scheduleRender(RenderPriority.PARTIAL);
}

// ── Live trade tick processing ────────────────────────────────────────────────

export function processTradeTick({ price, qty, side }) {
  const signedQty = side === 'buy' ? qty : -qty;
  if (side === 'buy') { state.tradeStreamDelta += qty; state.tradeBuyVol  += qty; }
  else                { state.tradeStreamDelta -= qty; state.tradeSellVol += qty; }

  if (state.currentCandle) {
    state.currentCandle._realDelta = (state.currentCandle._realDelta || 0) + signedQty;
  }

  state.tradeTickBuf.push({ price, side, ts: Date.now() });
  if (state.tradeTickBuf.length > 50) state.tradeTickBuf.shift();

  updateDeltaTicker();
}

// ── Stream lifecycle ───────────────────────────────────────────────────────────

/** Close both WebSocket streams. Used by replay.js. */
export function closeStreams() {
  klineWs?.close();     klineWs = null;
  tradeStream?.close(); tradeStream = null;
}

// ── Core: load a symbol ────────────────────────────────────────────────────────

export async function initSym(sym, tf) {
  const seq  = ++_initSymSeq;
  state.sym  = sym;
  state.tf   = tf;
  resetCandleState();

  ensureAvwapState();
  state.avwapVals  = [];
  state.avwapCumPV = 0;
  state.avwapCumV  = 0;
  state.anchorIdx  = null;
  writeAvwapLabel();

  cancelPendingRender();
  klineWs?.close();     klineWs = null;
  tradeStream?.close(); tradeStream = null;

  // Update active pill buttons
  document.querySelectorAll('#sym-group .pill-btn').forEach(b => {
    b.classList.remove('active', 'sym-active');
    const m = b.getAttribute('onclick')?.match(/'([A-Z]+)'/);
    if (m?.[1] === sym) b.classList.add('active', 'sym-active');
  });
  document.querySelectorAll('#tf-group .pill-btn').forEach(b => {
    b.classList.remove('active');
    if (b.dataset.tf === tf) b.classList.add('active');
  });

  document.title = `${fmtSym(sym)} · ${tf} — TradingTerminal`;
  setConnStatus('warn', `Loading ${fmtSym(sym)}…`);

  // Fetch initial candles
  const candles = await fetchKlines(state.exchange, sym, tf);
  if (seq !== _initSymSeq) return; // stale — another initSym fired

  if (candles?.length) {
    candles.forEach(c => addCandleToState(c));
    state.openPrice = candles[0]?.c || 0;
    setConnStatus('ok', `${state.exchange} · ${fmtSym(sym)} · ${tf}`);
  } else {
    setConnStatus('err', `Failed to load ${fmtSym(sym)}`);
    return;
  }

  state.livePrice = state.candles[state.candles.length - 1]?.c || 0;

  // Re-apply session anchor if mode is active
  if (getAnchorMode() === 'session') {
    _applySessionAnchor(true);
  }

  computeAndRender();
  dispatchToWorker([...state.candles]);
  saveSettings();

  // Open kline WebSocket
  klineWs = new KlineWebSocket({
    exchName: state.exchange,
    sym,
    tf,
    onCandle: (candle, confirmed) => {
      if (seq !== _initSymSeq) return;
      if (confirmed) {
        // Preserve real delta accumulated on the live candle
        const realDelta = state.currentCandle?.t === candle.t
          ? state.currentCandle._realDelta
          : undefined;
        addCandleToState(realDelta != null ? { ...candle, _realDelta: realDelta } : candle);
        state.currentCandle = null;
        scheduleRender(RenderPriority.PARTIAL);
        dispatchToWorker([...state.candles]);
      } else {
        const priorDelta = state.currentCandle?.t === candle.t
          ? state.currentCandle._realDelta
          : undefined;
        state.currentCandle = priorDelta != null ? { ...candle, _realDelta: priorDelta } : candle;
        state.livePrice     = candle.c;
        checkAlerts(candle.c);
        scheduleRender(RenderPriority.LIVE);
      }
    },
    onStatus: setConnStatus,
  });
  klineWs.connect();

  // Open trade stream
  tradeStream = new TradeStream({
    exchName: state.exchange,
    sym,
    onTick: tick => {
      if (seq !== _initSymSeq) return;
      processTradeTick(tick);
    },
  });
  tradeStream.connect();
}

// ── Navigation helpers ─────────────────────────────────────────────────────────

export function switchSym(sym)   { initSym(sym, state.tf); }
export function switchTF(tf)     { initSym(state.sym, tf); }

export function switchExchange(name, btn) {
  state.exchange = name;
  setScrExchange(name);   // keep screener in sync
  document.querySelectorAll('#exch-group .pill-btn').forEach(b => b.classList.remove('active', 'sym-active'));
  btn.classList.add('active', 'sym-active');
  initSym(state.sym, state.tf);
}

export function loadCoinFromScreener(sym) {
  initSym(sym, state.tf);
  document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Controls ───────────────────────────────────────────────────────────────────

export function setDirection(dir) {
  state.currentDir = dir;
  scheduleRender(RenderPriority.FULL);
}

export function setRRRatio(v) {
  state.rrRatio = +v || 2;
  scheduleRender(RenderPriority.FULL);
}

export function toggleOverlay(key, btn) {
  if (key === 'fib') state.overlayFib = !state.overlayFib;
  if (key === 'vp')  state.overlayVP  = !state.overlayVP;
  if (key === 'div') state.overlayDiv = !state.overlayDiv;
  btn?.classList.toggle('active');
  scheduleRender(RenderPriority.FULL);
}

export function toggleTheme() {
  state.isDark = !state.isDark;
  document.body.classList.toggle('light', !state.isDark);
  applyChartTheme(state.isDark ? 'dark' : 'light');
  const btn = document.querySelector('.theme-btn');
  if (btn) btn.textContent = state.isDark ? '🌙' : '☀️';
}

export function toggleCard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('collapsed');
  saveCollapsed(id, el.classList.contains('collapsed'));
}

// ── Leverage input handler (called from index.html inline script) ──────────────

export function onLeverageInput(val) {
  const v       = Math.min(100, Math.max(1, val || 1));
  const slider  = document.getElementById('lev-slider');
  const manual  = document.getElementById('lev-manual');
  const display = document.getElementById('lev-display');
  if (slider)  slider.value  = v;
  if (manual)  manual.value  = v;
  if (display) display.textContent = v + '×';
  if (slider)  slider.style.setProperty('--lev-pct', ((v - 1) / 99 * 100) + '%');
  state.leverage = v;
  scheduleRender(RenderPriority.PARTIAL);
}

// ── AVWAP / anchor ────────────────────────────────────────────────────────────

function _applySessionAnchor(silent = false) {
  if (!state.candles.length) {
    if (!silent) showToast('No candle data');
    return;
  }

  const today = new Date();
  const dk    = `${today.getUTCFullYear()}-${today.getUTCMonth() + 1}-${today.getUTCDate()}`;
  let idx = state.candles.findIndex(c => {
    if (!c.t) return false;
    const d = new Date(c.t);
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` === dk;
  });
  if (idx < 0) idx = 0;

  state.anchorIdx  = idx;
  state.avwapVals  = [];
  state.avwapCumPV = 0;
  state.avwapCumV  = 0;
  recomputeAvwap();
  writeAvwapLabel();

  if (!silent) {
    showToast('AVWAP anchored' + (idx === 0 ? ' (oldest in window)' : ' to session open'));
  }
}

export function anchorToSessionOpen() {
  setAnchorMode('session');
  _applySessionAnchor(false);
  drawAll();
}

export function clearAnchor() {
  setAnchorMode(null);
  state.anchorIdx  = null;
  state.avwapVals  = [];
  state.avwapCumPV = 0;
  state.avwapCumV  = 0;
  writeAvwapLabel();
  drawAll();
}

// ── Keyboard handler ──────────────────────────────────────────────────────────

export function handleKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const k = e.key.toUpperCase();

  if (k === 'L') { state.currentDir = 'long';  scheduleRender(RenderPriority.FULL); showToast('Direction: LONG');  }
  if (k === 'S') { state.currentDir = 'short'; scheduleRender(RenderPriority.FULL); showToast('Direction: SHORT'); }
  if (k === 'R') import('./screener-panel.js').then(({ runScreener }) => runScreener());
  if (k === 'T') toggleTheme();
  if (k === 'V') { state.overlayVP = !state.overlayVP; scheduleRender(RenderPriority.FULL); }
  if (k === '[') { state.rrRatio = Math.max(1,  state.rrRatio - 0.5); setRRRatio(state.rrRatio); }
  if (k === ']') { state.rrRatio = Math.min(10, state.rrRatio + 0.5); setRRRatio(state.rrRatio); }
  if (k === 'A') anchorToSessionOpen();
  if (k === 'X') clearAnchor();
}
