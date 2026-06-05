/**
 * app/candle-state.js
 * Owns all incremental (streaming) indicator updates that happen on every
 * confirmed candle or AVWAP anchor operation.
 *
 * Rule: no DOM reads/writes, no render scheduling, no chart calls.
 * Pure state mutation + audio feedback.
 */

import { state }                                     from '../state/store.js';
import {
  updEMA, emaK, calcWilderRSI, updVWAP,
  computeLiveVwap, computeLiveBands, updCVD,
} from '../indicators/engine.js';
import { playCrossSound }                            from './context.js';

// ── AVWAP anchor mode ─────────────────────────────────────────────────────────
// Kept here (not in state/store.js) because it's a UI interaction mode, not
// serialisable trading data. Only candle-state + symbol-nav need to know it.

let _anchorMode = null;   // null | 'session'

export function getAnchorMode()         { return _anchorMode; }
export function setAnchorMode(mode)     { _anchorMode = mode; }

// ── Candle window size ────────────────────────────────────────────────────────

const CANDLE_WINDOW = 500;

// ── AVWAP state helpers ───────────────────────────────────────────────────────

export function ensureAvwapState() {
  if (!Array.isArray(state.avwapVals))         state.avwapVals  = [];
  if (typeof state.avwapCumPV !== 'number')    state.avwapCumPV = 0;
  if (typeof state.avwapCumV  !== 'number')    state.avwapCumV  = 0;
  if (state.anchorIdx === undefined)           state.anchorIdx  = null;
}

// ── Live value readers ────────────────────────────────────────────────────────

export function getLatestAvwap() {
  if (!Array.isArray(state.avwapVals) || state.avwapVals.length === 0) return null;
  const v = state.avwapVals[state.avwapVals.length - 1];
  return (v != null && !isNaN(v)) ? v : null;
}

export function getLatestVwap() {
  const lastVwap = state.vwapVals[state.vwapVals.length - 1] ?? null;
  if (!state.currentCandle) return lastVwap;
  return computeLiveVwap(
    state.currentCandle,
    { cumPV: state.vwapCumPV, cumV: state.vwapCumV },
    lastVwap,
    state.vwapSessionKey,
  );
}

export function getLatestCvd() {
  const lastCvd = state.cvdVals[state.cvdVals.length - 1] ?? null;
  if (!state.currentCandle || state.currentCandle._realDelta == null) return lastCvd;
  return state.cvdRunning + state.currentCandle._realDelta;
}

// ── Index offset helper ───────────────────────────────────────────────────────

/** Re-index a list of { idx, … } objects by adding `offset`. */
export function offsetIndexed(items, offset) {
  return items.map(item => ({ ...item, idx: item.idx + offset }));
}

// ── Core: add one confirmed candle ────────────────────────────────────────────

export function addCandleToState(c) {
  // Reject out-of-order candles
  if (state.candles.length > 0 && c.t) {
    const last = state.candles[state.candles.length - 1].t;
    if (last && c.t < last) return;
  }

  // ── EMA streaming update ───────────────────────────────────────────────────
  const prevE9  = state.e9;
  const prevE20 = state.e20;
  state.e9  = updEMA(state.e9,  c.c, emaK(9));
  state.e20 = updEMA(state.e20, c.c, emaK(20));
  state.e50 = updEMA(state.e50, c.c, emaK(50));
  state.e9s.push(state.e9);
  state.e20s.push(state.e20);
  state.e50s.push(state.e50);

  // ── Wilder RSI streaming update ────────────────────────────────────────────
  const rsiRes = calcWilderRSI(c.c, state.prevClose, {
    avgGain: state.rmaAvgGain,
    avgLoss: state.rmaAvgLoss,
    _gains:  state._rsiGains  || [],
    _losses: state._rsiLosses || [],
  });
  state.rmaAvgGain  = rsiRes.avgGain;
  state.rmaAvgLoss  = rsiRes.avgLoss;
  state._rsiGains   = rsiRes._gains;
  state._rsiLosses  = rsiRes._losses;
  state.rsiVals.push(rsiRes.rsi);
  state.prevClose   = c.c;

  // ── VWAP + Welford bands streaming update ──────────────────────────────────
  const vwapRes = updVWAP(c, {
    cumPV:      state.vwapCumPV,
    cumV:       state.vwapCumV,
    m2:         state.vwapM2,
    sessionKey: state.vwapSessionKey,
  });
  state.vwapCumPV      = vwapRes.newState.cumPV;
  state.vwapCumV       = vwapRes.newState.cumV;
  state.vwapM2         = vwapRes.newState.m2;
  state.vwapSessionKey = vwapRes.newState.sessionKey;
  state.vwapVals.push(vwapRes.vwap);
  state.vwapBandVals.push(vwapRes.bands);

  // ── CVD streaming update ───────────────────────────────────────────────────
  const cvdRes = updCVD(c, state.cvdRunning, state.cvdEmaRun, state.CVD_EMA_K, state.cvdResetMode, state.cvdSessionKey);
  state.cvdRunning    = cvdRes.newRunning;
  state.cvdEmaRun     = cvdRes.newEmaRun;
  state.cvdSessionKey = cvdRes.newSessionKey;
  state.cvdVals.push(state.cvdRunning);
  state.cvdEmaVals.push(state.cvdEmaRun);

  // ── Crossover detection ────────────────────────────────────────────────────
  if (prevE9 !== null && prevE20 !== null) {
    const bullCross = prevE9 <= prevE20 && state.e9 > state.e20;
    const bearCross = prevE9 >= prevE20 && state.e9 < state.e20;
    if (bullCross || bearCross) {
      state.crossovers.push({
        type:  bullCross ? 'bull' : 'bear',
        price: c.c,
        idx:   state.candles.length,
        time:  c.t || Date.now(),
      });
      if (state.crossovers.length > 8) state.crossovers.shift();
      playCrossSound(bullCross ? 'bull' : 'bear');
    }
  }

  // ── Push candle ────────────────────────────────────────────────────────────
  state.candles.push(c);

  // ── AVWAP incremental update ───────────────────────────────────────────────
  if (state.anchorIdx !== null) {
    _appendAvwapBar(c);
  }

  // ── Rolling window eviction ────────────────────────────────────────────────
  if (state.candles.length > CANDLE_WINDOW) {
    state.candles.shift();
    state.e9s.shift();   state.e20s.shift();  state.e50s.shift();
    state.rsiVals.shift();
    state.vwapVals.shift(); state.vwapBandVals.shift();
    state.cvdVals.shift();  state.cvdEmaVals.shift();

    if (state.anchorIdx !== null) {
      state.anchorIdx--;
      if (state.anchorIdx < 0) {
        if (_anchorMode === 'session') {
          // Re-anchor to the new oldest candle
          state.anchorIdx  = 0;
          state.avwapVals  = [];
          state.avwapCumPV = 0;
          state.avwapCumV  = 0;
          recomputeAvwap();
        } else {
          // Manual anchor evicted — clear it
          state.anchorIdx  = null;
          state.avwapVals  = [];
          state.avwapCumPV = 0;
          state.avwapCumV  = 0;
          _anchorMode      = null;
          // Notify via dynamic import to avoid circular dep on context.js
          import('./context.js').then(({ showToast }) =>
            showToast('AVWAP anchor evicted (window full) — re-anchor with A', 'warn')
          );
        }
      } else {
        state.avwapVals.shift();
      }
    }

    state.crossovers = state.crossovers
      .map(x => ({ ...x, idx: x.idx - 1 }))
      .filter(x => x.idx >= 0);
  }
}

// ── AVWAP helpers ─────────────────────────────────────────────────────────────

function _appendAvwapBar(c) {
  const tp  = (c.h + c.l + c.c) / 3;
  const vol = (c.v > 0) ? c.v : 0;
  state.avwapCumPV += tp * vol;
  state.avwapCumV  += vol;
  const v = state.avwapCumV > 0 ? state.avwapCumPV / state.avwapCumV : c.c;
  if (v != null && !isNaN(v)) state.avwapVals.push(v);
}

export function recomputeAvwap() {
  if (state.anchorIdx === null) return;
  const slice = state.candles.slice(state.anchorIdx);
  let cumPV = 0, cumV = 0;
  state.avwapVals = slice.map(c => {
    const tp  = (c.h + c.l + c.c) / 3;
    const vol = (c.v > 0) ? c.v : 0;
    cumPV += tp * vol;
    cumV  += vol;
    return cumV > 0 ? cumPV / cumV : c.c;
  });
  state.avwapCumPV = cumPV;
  state.avwapCumV  = cumV;
}

// ── Live AVWAP (current unconfirmed candle) ───────────────────────────────────

/**
 * Compute the live AVWAP value for the current (unconfirmed) candle.
 * Used by chart-manager.js when building the live candle object for LWC.
 */
export function computeLiveAvwap() {
  if (state.anchorIdx === null || state.avwapCumV <= 0 || !state.currentCandle) return null;
  const c   = state.currentCandle;
  const tp  = (c.h + c.l + c.c) / 3;
  const vol = c.v > 0 ? c.v : 0;
  const liveV = state.avwapCumV + vol;
  return liveV > 0 ? (state.avwapCumPV + tp * vol) / liveV : null;
}

// ── Live VWAP bands (current unconfirmed candle) ──────────────────────────────

export function computeLiveVwapBands() {
  if (!state.currentCandle) return null;
  const liveVwap = getLatestVwap();
  if (!liveVwap) return null;
  return computeLiveBands(
    state.currentCandle,
    { cumPV: state.vwapCumPV, cumV: state.vwapCumV, m2: state.vwapM2 },
    liveVwap,
  );
}