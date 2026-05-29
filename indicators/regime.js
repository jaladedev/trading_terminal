/**
 * indicators/regime.js
 * Market regime detection: trending, ranging, choppy.
 * Implemented without external dependencies using:
 *   - ADX (Average Directional Index) for trend strength
 *   - ATR normalised as % of price (volatility)
 *   - EMA slope + spacing for trend direction
 *   - Price efficiency ratio for choppiness
 */

import { calcATR } from './engine.js';

// ── ADX (Wilder's) ────────────────────────────────────────────────────────────

/**
 * Calculate ADX, +DI, -DI.
 * Returns { adx, plusDI, minusDI } or null if insufficient data.
 */
export function calcADX(candles, period = 14) {
  if (candles.length < period * 2) return null;

  const trs = [], plusDMs = [], minusDMs = [];

  for (let i = 1; i < candles.length; i++) {
    const c    = candles[i];
    const prev = candles[i - 1];
    const tr   = Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
    const upMove   = c.h - prev.h;
    const downMove = prev.l - c.l;
    trs.push(tr);
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder's smoothed ATR, +DM, -DM
  let smTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smPlus  = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smMinus = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxVals = [];
  for (let i = period; i < trs.length; i++) {
    smTR    = smTR    - smTR / period    + trs[i];
    smPlus  = smPlus  - smPlus / period  + plusDMs[i];
    smMinus = smMinus - smMinus / period + minusDMs[i];

    const plusDI  = smTR > 0 ? 100 * smPlus  / smTR : 0;
    const minusDI = smTR > 0 ? 100 * smMinus / smTR : 0;
    const dx      = (plusDI + minusDI) > 0
      ? 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI)
      : 0;
    dxVals.push({ dx, plusDI, minusDI });
  }

  if (dxVals.length < period) return null;

  // ADX = Wilder smoothed DX
  let adx = dxVals.slice(-period).reduce((a, b) => a + b.dx, 0) / period;
  for (let i = dxVals.length - period + 1; i < dxVals.length; i++) {
    adx = (adx * (period - 1) + dxVals[i].dx) / period;
  }

  const last = dxVals[dxVals.length - 1];
  return { adx, plusDI: last.plusDI, minusDI: last.minusDI };
}

// ── Efficiency Ratio (Kaufman) ────────────────────────────────────────────────
/** Measures directional efficiency of recent price move. 1 = perfectly trending, 0 = choppy */
export function calcEfficiencyRatio(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const slice = candles.slice(-period - 1);
  const netMove = Math.abs(slice[slice.length - 1].c - slice[0].c);
  const pathLen = slice.slice(1).reduce((a, c, i) => a + Math.abs(c.c - slice[i].c), 0);
  return pathLen > 0 ? netMove / pathLen : 0;
}

// ── EMA Slope ─────────────────────────────────────────────────────────────────
/** Returns slope as % change of EMA20 over last N candles */
export function calcEMASlope(ema20s, period = 5) {
  if (ema20s.length < period + 1) return 0;
  const recent = ema20s.slice(-period - 1).filter(v => v !== null);
  if (recent.length < 2) return 0;
  const first = recent[0], last = recent[recent.length - 1];
  return first > 0 ? ((last - first) / first) * 100 : 0;
}

// ── Main Regime Classifier ────────────────────────────────────────────────────

/**
 * Returns a MarketRegime object:
 * {
 *   type:    'trending' | 'ranging' | 'choppy',
 *   dir:     'bull' | 'bear' | 'neutral',
 *   label:   string,
 *   adx:     number,
 *   atr:     number,
 *   atrPct:  number,
 *   er:      number,  // efficiency ratio
 *   slope:   number,
 *   plusDI:  number,
 *   minusDI: number,
 * }
 */
export function detectRegime(candles, e20s, livePrice) {
  if (!candles || candles.length < 30) return null;

  const atr    = calcATR(candles, 14) || 0;
  const atrPct = livePrice > 0 ? (atr / livePrice) * 100 : 0;
  const adxRes = calcADX(candles, 14);
  const adx    = adxRes?.adx ?? 0;
  const plusDI = adxRes?.plusDI ?? 0;
  const minusDI= adxRes?.minusDI ?? 0;
  const er     = calcEfficiencyRatio(candles, 14) ?? 0;
  const slope  = calcEMASlope(e20s, 5);

  // ── Classification ──────────────────────────────────────────────────────
  // Trending:  ADX > 25 AND ER > 0.4
  // Choppy:    ADX < 20 AND ER < 0.3
  // Ranging:   everything in between

  let type;
  if (adx >= 25 && er >= 0.4) {
    type = 'trending';
  } else if (adx < 20 && er < 0.3) {
    type = 'choppy';
  } else {
    type = 'ranging';
  }

  // ── Direction ───────────────────────────────────────────────────────────
  let dir = 'neutral';
  if (plusDI > minusDI + 5) dir = 'bull';
  else if (minusDI > plusDI + 5) dir = 'bear';
  // Slope cross-check
  if (dir === 'neutral') {
    if (slope > 0.05) dir = 'bull';
    else if (slope < -0.05) dir = 'bear';
  }

  // ── Volatility squeeze detection ────────────────────────────────────────
  let volatilityNote = '';
  if (atrPct < 0.3) volatilityNote = ' · Low volatility squeeze';
  else if (atrPct > 3) volatilityNote = ' · High volatility';

  // ── Label ───────────────────────────────────────────────────────────────
  const typeLabel = type === 'trending' ? 'TRENDING' : type === 'ranging' ? 'RANGING' : 'CHOPPY';
  const dirLabel  = dir === 'bull' ? '↑ BULL' : dir === 'bear' ? '↓ BEAR' : '↔ NEUTRAL';
  const label     = `${typeLabel} · ${dirLabel}${volatilityNote}`;

  // ── Trading implications ────────────────────────────────────────────────
  let advice = '';
  if (type === 'trending' && dir === 'bull') {
    advice = 'Trend-following longs preferred. Add on pullbacks to EMA9/20. Avoid counter-trend shorts.';
  } else if (type === 'trending' && dir === 'bear') {
    advice = 'Trend-following shorts preferred. Sell bounces into EMA9/20. Avoid counter-trend longs.';
  } else if (type === 'ranging') {
    advice = 'Range-bound. Buy support, sell resistance. Reduce size, target smaller RR. Breakout watch mode.';
  } else if (type === 'choppy') {
    advice = 'Choppy — EMA signals are unreliable. Best to wait for a clearer structure. Reduce size or sit out.';
  }

  return { type, dir, label, advice, adx, plusDI, minusDI, atr, atrPct, er, slope };
}

// ── Trend Persistence Scoring ─────────────────────────────────────────────────

/**
 * Counts how many consecutive closed candles the EMA stack has been in its
 * current alignment (bull = e9>e20>e50, bear = e9<e20<e50).
 */
export function calcTrendAge(e9s, e20s, e50s) {
  if (!e9s.length || !e20s.length || !e50s.length) return 0;
  const n = Math.min(e9s.length, e20s.length, e50s.length);
  if (n === 0) return 0;

  const lastE9  = e9s[n - 1], lastE20 = e20s[n - 1], lastE50 = e50s[n - 1];
  if (!lastE9 || !lastE20 || !lastE50) return 0;

  const isBull = lastE9 > lastE20 && lastE20 > lastE50;
  const isBear = lastE9 < lastE20 && lastE20 < lastE50;
  if (!isBull && !isBear) return 0;

  let age = 0;
  for (let i = n - 1; i >= 0; i--) {
    const e9v = e9s[i], e20v = e20s[i], e50v = e50s[i];
    if (!e9v || !e20v || !e50v) break;
    const inStack = isBull
      ? (e9v > e20v && e20v > e50v)
      : (e9v < e20v && e20v < e50v);
    if (!inStack) break;
    age++;
  }
  return age;
}

// ── Momentum Acceleration ─────────────────────────────────────────────────────

/**
 * Measures momentum acceleration: ROC of ROC over last N candles.
 * Positive = accelerating, Negative = decelerating.
 */
export function calcMomentumAcceleration(closes, period = 5) {
  if (closes.length < period * 2 + 1) return 0;
  const roc1 = (closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period];
  const roc2 = (closes[closes.length - 1 - period] - closes[closes.length - 1 - period * 2]) / closes[closes.length - 1 - period * 2];
  return roc1 - roc2;
}
