/**
 * engine/backtest.js
 * Historical backtesting engine.
 *
 * Architecture:
 *   BacktestEngine   — iterates candles bar-by-bar, manages open positions
 *   StrategyRunner   — evaluates entry/exit rules per bar
 *   MetricsCalc      — computes win rate, profit factor, expectancy, drawdown, Sharpe
 *   WalkForward      — splits data into in-sample/out-of-sample windows
 *
 */

import { calcEMAArray, calcRSIArray, calcATR, calcATRArray } from '../indicators/engine.js';
import { detectRegime }    from '../indicators/regime.js';
import { detectSwingPoints, detectStructureBreaks } from '../indicators/structure.js';

// ── Strategy Definitions ──────────────────────────────────────────────────────

export const STRATEGIES = {
  EMA_PULLBACK: {
    id:    'ema_pullback',
    label: 'EMA Pullback',
    desc:  'Enter on pullback to EMA9/20 in direction of EMA50 trend. ATR stop.',
  },
  EMA_CROSS: {
    id:    'ema_cross',
    label: 'EMA Crossover',
    desc:  'Enter on EMA9/20 crossover with RSI confirmation. ATR stop.',
  },
  RSI_MEAN_REVERT: {
    id:    'rsi_mean_revert',
    label: 'RSI Mean Reversion',
    desc:  'Enter on RSI <30 (long) or >70 (short) with EMA50 trend filter.',
  },
  BREAKOUT: {
    id:    'breakout',
    label: 'Structure Breakout',
    desc:  'Enter on break of recent swing high/low with volume confirmation.',
  },
  VWAP_BOUNCE: {
    id:    'vwap_bounce',
    label: 'VWAP Bounce',
    desc:  'Enter on price touch of VWAP with EMA trend confirmation.',
  },
};

// ── Trade State ───────────────────────────────────────────────────────────────

class Trade {
  constructor({ entryIdx, entryPrice, dir, stopPrice, targetPrice, tpPrices, size, atr }) {
    this.entryIdx    = entryIdx;
    this.entryPrice  = entryPrice;
    this.dir         = dir;        // 'long' | 'short'
    this.stopPrice   = stopPrice;
    this.targetPrice = targetPrice;
    this.tpPrices    = tpPrices || [];  // [tp1, tp2, tp3]
    this.size        = size;            // notional $
    this.atr         = atr;
    this.exitIdx     = null;
    this.exitPrice   = null;
    this.exitReason  = null;    // 'tp' | 'sl' | 'trail' | 'eod' | 'signal'
    this.pnl         = null;
    this.rr          = null;
    this.mae         = 0;       // max adverse excursion
    this.mfe         = 0;       // max favourable excursion
    this.barDuration = 0;
    this._trailStop  = null;
    this._tpHit      = 0;       // partial TP index hit
    this._scaled     = false;
  }

  get isOpen() { return this.exitIdx === null; }
  get isLong()  { return this.dir === 'long'; }

  // Called each bar while open
  updateExcursions(candle) {
    const { h, l } = candle;
    if (this.isLong) {
      const adverse   = this.entryPrice - l;
      const favorable = h - this.entryPrice;
      if (adverse   > this.mae) this.mae = adverse;
      if (favorable > this.mfe) this.mfe = favorable;
    } else {
      const adverse   = h - this.entryPrice;
      const favorable = this.entryPrice - l;
      if (adverse   > this.mae) this.mae = adverse;
      if (favorable > this.mfe) this.mfe = favorable;
    }
    this.barDuration++;
  }

  close(exitIdx, exitPrice, reason, feeRate = 0) {
    this.exitIdx   = exitIdx;
    this.exitPrice = exitPrice;
    this.exitReason = reason;

    const priceDiff = this.isLong
      ? exitPrice - this.entryPrice
      : this.entryPrice - exitPrice;

    const grossPnl = (priceDiff / this.entryPrice) * this.size;
    const fees     = this.size * feeRate * 2;
    this.pnl       = grossPnl - fees;

    const risk  = Math.abs(this.entryPrice - this.stopPrice);
    this.rr     = risk > 0 ? priceDiff / risk : 0;
    return this;
  }
}

// ── Main Backtest Engine ──────────────────────────────────────────────────────

export class BacktestEngine {
  constructor(config) {
    this.candles     = config.candles || [];
    this.strategy    = config.strategy || STRATEGIES.EMA_PULLBACK;
    this.capital     = config.capital    ?? 1000;
    this.riskPct     = config.riskPct    ?? 1;      // % of capital per trade
    this.leverage    = config.leverage   ?? 10;
    this.feeRate     = config.feeRate    ?? 0.0002;
    this.rrRatio     = config.rrRatio    ?? 2;
    this.atrMultiple = config.atrMultiple ?? 2;
    this.trailStop   = config.trailStop  ?? false;
    this.partialTPs  = config.partialTPs ?? true;   // scale out at 1R, 2R
    this.maxOpenTrades = config.maxOpenTrades ?? 1;
    this.warmupBars  = config.warmupBars ?? 60;     // bars before trading starts
    this.onProgress  = config.onProgress ?? null;   // (pct) => void

    // Pre-computed indicators
    this._closes = null;
    this._e9s = null;
    this._e20s = null;
    this._e50s = null;
    this._rsi  = null;
    this._atrs = null;
  }

  // ── Pre-compute indicators ────────────────────────────────────────────────

  _precompute() {
    this._closes = this.candles.map(c => c.c);
    this._e9s    = calcEMAArray(this._closes, 9);
    this._e20s   = calcEMAArray(this._closes, 20);
    this._e50s   = calcEMAArray(this._closes, 50);
    this._rsi    = calcRSIArray(this._closes, 14);
    this._atrs   = calcATRArray(this.candles, 14);

    // VWAP (simple session reset each day)
    this._vwap = this._calcVWAPArray(this.candles);
  }

  _calcVWAPArray(candles) {
    let cumPV = 0, cumV = 0, sessionKey = '';
    return candles.map(c => {
      if (c.t) {
        const d   = new Date(c.t);
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
        if (key !== sessionKey) { cumPV = 0; cumV = 0; sessionKey = key; }
      }
      const tp = (c.h + c.l + c.c) / 3;
      cumPV += tp * c.v; cumV += c.v;
      return cumV > 0 ? cumPV / cumV : c.c;
    });
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  run() {
    if (this.candles.length < this.warmupBars + 10) {
      return { trades: [], metrics: null, equity: [], error: 'Not enough candles' };
    }

    this._precompute();

    const trades    = [];
    let openTrades  = [];
    let equity      = this.capital;
    const equityCurve = [{ idx: 0, value: equity }];

    for (let i = this.warmupBars; i < this.candles.length; i++) {
      const c = this.candles[i];

      // ── Update open trades ────────────────────────────────────────────
      for (const trade of [...openTrades]) {
        trade.updateExcursions(c);

        // Update trailing stop
        if (this.trailStop && trade._tpHit >= 1) {
          const atr = this._atrs[i] || trade.atr;
          const newTrail = trade.isLong
            ? c.c - atr * this.atrMultiple
            : c.c + atr * this.atrMultiple;
          if (trade._trailStop === null) {
            trade._trailStop = newTrail;
          } else {
            if (trade.isLong  && newTrail > trade._trailStop) trade._trailStop = newTrail;
            if (!trade.isLong && newTrail < trade._trailStop) trade._trailStop = newTrail;
          }
        }

        const stopToUse = trade._trailStop ?? trade.stopPrice;

        // Check partial TPs
        if (this.partialTPs && trade._tpHit < trade.tpPrices.length) {
          const nextTP = trade.tpPrices[trade._tpHit];
          const tpHit  = trade.isLong ? c.h >= nextTP : c.l <= nextTP;
          if (tpHit) {
            trade._tpHit++;
            // Move stop to breakeven after TP1
            if (trade._tpHit === 1) {
              if (trade.isLong  && trade.stopPrice < trade.entryPrice) trade.stopPrice = trade.entryPrice;
              if (!trade.isLong && trade.stopPrice > trade.entryPrice) trade.stopPrice = trade.entryPrice;
            }
          }
        }

        // Check stop loss
        const slHit = trade.isLong ? c.l <= stopToUse : c.h >= stopToUse;
        if (slHit) {
          trade.close(i, stopToUse, 'sl', this.feeRate);
          openTrades = openTrades.filter(t => t !== trade);
          trades.push(trade);
          equity += trade.pnl;
          equityCurve.push({ idx: i, value: equity });
          continue;
        }

        // Check take profit
        const tpHit = trade.isLong ? c.h >= trade.targetPrice : c.l <= trade.targetPrice;
        if (tpHit) {
          trade.close(i, trade.targetPrice, 'tp', this.feeRate);
          openTrades = openTrades.filter(t => t !== trade);
          trades.push(trade);
          equity += trade.pnl;
          equityCurve.push({ idx: i, value: equity });
        }
      }

      // ── Check for new entries ─────────────────────────────────────────
      if (openTrades.length < this.maxOpenTrades) {
        const signal = this._evalStrategy(i);
        if (signal) {
          const atr   = this._atrs[i];
          if (!atr) continue;

          const { dir, entry, stop } = signal;
          const stopDist = Math.abs(entry - stop);
          if (stopDist <= 0) continue;

          // Risk-based sizing
          const riskUSD = equity * (this.riskPct / 100);
          const tokens  = riskUSD / stopDist;
          const size    = tokens * entry;

          // TP levels
          const tp1 = dir === 'long' ? entry + stopDist     : entry - stopDist;
          const tp2 = dir === 'long' ? entry + stopDist * 2 : entry - stopDist * 2;
          const tp3 = dir === 'long' ? entry + stopDist * this.rrRatio : entry - stopDist * this.rrRatio;

          const trade = new Trade({
            entryIdx:    i,
            entryPrice:  entry,
            dir,
            stopPrice:   stop,
            targetPrice: tp3,
            tpPrices:    [tp1, tp2],
            size,
            atr,
          });

          openTrades.push(trade);
        }
      }

      // Progress callback every 100 bars
      if (this.onProgress && i % 100 === 0) {
        this.onProgress(Math.round((i / this.candles.length) * 100));
      }
    }

    // Close any remaining open trades at last bar
    const lastC = this.candles[this.candles.length - 1];
    for (const trade of openTrades) {
      trade.close(this.candles.length - 1, lastC.c, 'eod', this.feeRate);
      trades.push(trade);
      equity += trade.pnl;
    }
    equityCurve.push({ idx: this.candles.length - 1, value: equity });

    const metrics = calcMetrics(trades, this.capital, equityCurve, this.candles);

    return { trades, metrics, equityCurve, initialCapital: this.capital };
  }

  // ── Strategy Evaluators ───────────────────────────────────────────────────

  _evalStrategy(i) {
    switch (this.strategy.id) {
      case 'ema_pullback':    return this._emaPullback(i);
      case 'ema_cross':       return this._emaCross(i);
      case 'rsi_mean_revert': return this._rsiMeanRevert(i);
      case 'breakout':        return this._breakout(i);
      case 'vwap_bounce':     return this._vwapBounce(i);
      default:                return null;
    }
  }

  _emaPullback(i) {
    if (i < 3) return null;
    const e9   = this._e9s[i],  e20 = this._e20s[i], e50 = this._e50s[i];
    const pe9  = this._e9s[i-1], pe20 = this._e20s[i-1];
    const rsi  = this._rsi[i];
    const c    = this.candles[i];
    const pc   = this.candles[i - 1];
    const atr  = this._atrs[i];
    if (!e9 || !e20 || !e50 || !atr || rsi === null) return null;

    // Bull: EMA stack + candle just touched EMA9 from above
    if (e9 > e20 && e20 > e50 && rsi > 40 && rsi < 65) {
      const touchedEMA9 = pc.l <= e9 * 1.002 && c.c > e9;
      if (touchedEMA9) {
        const entry = c.c;
        const stop  = Math.min(e20, c.l) * 0.9995;
        return { dir: 'long', entry, stop };
      }
    }

    // Bear: inverted EMA stack + bounce off EMA9 from below
    if (e9 < e20 && e20 < e50 && rsi < 60 && rsi > 35) {
      const touchedEMA9 = pc.h >= e9 * 0.998 && c.c < e9;
      if (touchedEMA9) {
        const entry = c.c;
        const stop  = Math.max(e20, c.h) * 1.0005;
        return { dir: 'short', entry, stop };
      }
    }

    return null;
  }

  _emaCross(i) {
    if (i < 2) return null;
    const e9   = this._e9s[i],  e20 = this._e20s[i], e50 = this._e50s[i];
    const pe9  = this._e9s[i-1], pe20 = this._e20s[i-1];
    const rsi  = this._rsi[i];
    const c    = this.candles[i];
    const atr  = this._atrs[i];
    if (!e9 || !e20 || !e50 || !pe9 || !pe20 || !atr || rsi === null) return null;

    const bullCross = pe9 <= pe20 && e9 > e20;
    const bearCross = pe9 >= pe20 && e9 < e20;

    if (bullCross && e50 && e9 > e50 && rsi < 70) {
      return { dir: 'long',  entry: c.c, stop: c.c - atr * this.atrMultiple };
    }
    if (bearCross && e50 && e9 < e50 && rsi > 30) {
      return { dir: 'short', entry: c.c, stop: c.c + atr * this.atrMultiple };
    }
    return null;
  }

  _rsiMeanRevert(i) {
    if (i < 2) return null;
    const e50  = this._e50s[i];
    const rsi  = this._rsi[i];
    const prsi = this._rsi[i - 1];
    const c    = this.candles[i];
    const atr  = this._atrs[i];
    if (!e50 || rsi === null || prsi === null || !atr) return null;

    // RSI oversold bounce (long when price > EMA50)
    if (prsi < 30 && rsi > prsi && c.c > e50) {
      return { dir: 'long',  entry: c.c, stop: c.l - atr * 0.5 };
    }
    // RSI overbought fade (short when price < EMA50)
    if (prsi > 70 && rsi < prsi && c.c < e50) {
      return { dir: 'short', entry: c.c, stop: c.h + atr * 0.5 };
    }
    return null;
  }

  _breakout(i) {
    if (i < 20) return null;
    const lookback = 20;
    const window   = this.candles.slice(i - lookback, i);
    const hi       = Math.max(...window.map(c => c.h));
    const lo       = Math.min(...window.map(c => c.l));
    const c        = this.candles[i];
    const pc       = this.candles[i - 1];
    const e50      = this._e50s[i];
    const atr      = this._atrs[i];
    const rsi      = this._rsi[i];
    if (!e50 || !atr || rsi === null) return null;

    // Volume spike check (2× average)
    const volAvg = window.reduce((a, x) => a + x.v, 0) / lookback;

    // Bullish breakout
    if (pc.c < hi && c.c > hi && c.c > e50 && c.v > volAvg * 1.5 && rsi < 80) {
      return { dir: 'long',  entry: c.c, stop: hi - atr * 0.5 };
    }
    // Bearish breakdown
    if (pc.c > lo && c.c < lo && c.c < e50 && c.v > volAvg * 1.5 && rsi > 20) {
      return { dir: 'short', entry: c.c, stop: lo + atr * 0.5 };
    }
    return null;
  }

  _vwapBounce(i) {
    if (i < 2) return null;
    const vwap = this._vwap[i];
    const pvwap= this._vwap[i - 1];
    const e20  = this._e20s[i];
    const e50  = this._e50s[i];
    const c    = this.candles[i];
    const pc   = this.candles[i - 1];
    const atr  = this._atrs[i];
    const rsi  = this._rsi[i];
    if (!vwap || !e20 || !e50 || !atr || rsi === null) return null;

    // Price dipped to VWAP and bounced back above — bullish
    const bullBounce = pc.l <= vwap * 1.001 && c.c > vwap && e20 > e50 && rsi < 65;
    const bearBounce = pc.h >= vwap * 0.999 && c.c < vwap && e20 < e50 && rsi > 35;

    if (bullBounce) return { dir: 'long',  entry: c.c, stop: c.l - atr * 0.5 };
    if (bearBounce) return { dir: 'short', entry: c.c, stop: c.h + atr * 0.5 };
    return null;
  }
}

// ── Metrics Calculator ────────────────────────────────────────────────────────

/**
 * Calculates full performance metrics from a list of closed trades.
 */
export function calcMetrics(trades, initialCapital, equityCurve, candles) {
  if (!trades.length) return null;

  const closed  = trades.filter(t => t.pnl !== null);
  const wins    = closed.filter(t => t.pnl > 0);
  const losses  = closed.filter(t => t.pnl <= 0);
  const total   = closed.length;

  const winRate = total > 0 ? wins.length / total : 0;

  const grossWin  = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const netPnl    = grossWin - grossLoss;

  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  const avgWin  = wins.length   > 0 ? grossWin  / wins.length   : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  // Average RR
  const rrVals = closed.filter(t => t.rr !== null).map(t => t.rr);
  const avgRR  = rrVals.length > 0 ? rrVals.reduce((a, b) => a + b, 0) / rrVals.length : null;

  // Drawdown
  const { maxDrawdown, maxDrawdownPct, drawdownCurve } = calcDrawdown(equityCurve);

  // Sharpe-like ratio (annualised)
  const sharpe = calcSharpe(equityCurve, candles);

  // Consecutive wins/losses
  let maxConsecWins = 0, maxConsecLoss = 0, cw = 0, cl = 0;
  closed.forEach(t => {
    if (t.pnl > 0) { cw++; cl = 0; maxConsecWins = Math.max(maxConsecWins, cw); }
    else           { cl++; cw = 0; maxConsecLoss = Math.max(maxConsecLoss, cl); }
  });

  // Average trade duration (bars)
  const avgBars = closed.length > 0
    ? closed.reduce((a, t) => a + t.barDuration, 0) / closed.length
    : 0;

  // MAE / MFE averages
  const avgMAE = closed.length > 0 ? closed.reduce((a, t) => a + t.mae, 0) / closed.length : 0;
  const avgMFE = closed.length > 0 ? closed.reduce((a, t) => a + t.mfe, 0) / closed.length : 0;

  // Exit reason breakdown
  const byReason = {};
  closed.forEach(t => {
    if (!byReason[t.exitReason]) byReason[t.exitReason] = { count: 0, pnl: 0 };
    byReason[t.exitReason].count++;
    byReason[t.exitReason].pnl += t.pnl;
  });

  // Risk of ruin (simplified Monte Carlo estimate)
  const riskOfRuin = estimateRiskOfRuin(winRate, avgWin, avgLoss, initialCapital, 0.5);

  return {
    total,
    wins:    wins.length,
    losses:  losses.length,
    winRate: Math.round(winRate * 100),
    winRateRaw: winRate,

    grossWin, grossLoss, netPnl,
    profitFactor,
    expectancy,
    avgRR,
    avgWin, avgLoss,

    maxDrawdown, maxDrawdownPct,
    sharpe,

    maxConsecWins, maxConsecLoss,
    avgBars, avgMAE, avgMFE,
    byReason,
    riskOfRuin,

    finalEquity: equityCurve[equityCurve.length - 1]?.value ?? initialCapital,
    totalReturn: ((equityCurve[equityCurve.length - 1]?.value ?? initialCapital) - initialCapital) / initialCapital * 100,

    drawdownCurve,
  };
}

function calcDrawdown(equityCurve) {
  let peak = -Infinity;
  let maxDD = 0, maxDDPct = 0;
  const curve = equityCurve.map(({ idx, value }) => {
    if (value > peak) peak = value;
    const dd    = peak - value;
    const ddPct = peak > 0 ? dd / peak * 100 : 0;
    if (dd > maxDD)  maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
    return { idx, value, drawdown: dd, drawdownPct: ddPct };
  });
  return { maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, drawdownCurve: curve };
}

function calcSharpe(equityCurve, candles) {
  if (equityCurve.length < 2) return null;
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i-1].value;
    const curr = equityCurve[i].value;
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  // Annualise assuming ~252 trading days (approximate for crypto: ~365)
  return (mean / std) * Math.sqrt(365);
}

/**
 * Monte Carlo risk of ruin estimate.
 * rorTarget = fraction of capital that constitutes "ruin" (e.g. 0.5 = 50% loss)
 */
function estimateRiskOfRuin(winRate, avgWin, avgLoss, capital, rorTarget) {
  if (avgLoss === 0 || avgWin === 0) return null;
  // Kelly fraction
  const w = winRate, l = 1 - w;
  const b = avgWin / avgLoss;
  const kelly = (w * b - l) / b;
  if (kelly <= 0) return 1; // negative expectancy = certain ruin

  // Simplified analytic approximation
  const a = (l / w) * (avgLoss / avgWin);
  if (a >= 1) return 1;
  const ruinLevel = Math.round(capital * rorTarget);
  // P(ruin) ≈ (a)^(currentCapital / avgLoss)
  return Math.min(1, Math.pow(a, ruinLevel / avgLoss));
}

// ── Walk-Forward Analysis ─────────────────────────────────────────────────────

/**
 * Splits candles into N windows of (in-sample + out-of-sample).
 * Runs backtest on each window and returns aggregated metrics.
 *
 * @param {Candle[]} candles
 * @param {object}   engineConfig   (minus candles)
 * @param {object}   wfOptions      { windows: 4, inSamplePct: 0.7 }
 */
export function runWalkForward(candles, engineConfig, wfOptions = {}) {
  const numWindows  = wfOptions.windows      || 4;
  const inSamplePct = wfOptions.inSamplePct  || 0.7;

  const totalBars  = candles.length;
  const windowSize = Math.floor(totalBars / numWindows);
  const results    = [];

  for (let w = 0; w < numWindows; w++) {
    const start  = w * windowSize;
    const end    = Math.min(start + windowSize, totalBars);
    const split  = start + Math.floor((end - start) * inSamplePct);

    const inSample  = candles.slice(start, split);
    const outSample = candles.slice(split, end);

    const isResult  = new BacktestEngine({ ...engineConfig, candles: inSample  }).run();
    const oosResult = new BacktestEngine({ ...engineConfig, candles: outSample }).run();

    results.push({
      window:     w + 1,
      inSample:   { bars: inSample.length,  metrics: isResult.metrics  },
      outSample:  { bars: outSample.length, metrics: oosResult.metrics },
      degradation: isResult.metrics && oosResult.metrics
        ? (isResult.metrics.winRate - oosResult.metrics.winRate)
        : null,
    });
  }

  // Aggregate OOS metrics
  const oosTrades = results.flatMap(r => r.outSample?.metrics ? [r.outSample.metrics] : []);
  const aggregateOOS = {
    avgWinRate:   oosTrades.reduce((a, m) => a + m.winRate, 0) / oosTrades.length || 0,
    avgNetPnl:    oosTrades.reduce((a, m) => a + m.netPnl, 0) / oosTrades.length || 0,
    avgDrawdown:  oosTrades.reduce((a, m) => a + m.maxDrawdownPct, 0) / oosTrades.length || 0,
    consistency:  results.filter(r => r.outSample?.metrics?.winRate >= 40).length / numWindows,
  };

  return { windows: results, aggregateOOS };
}

// ── Batch Strategy Comparison ─────────────────────────────────────────────────

/**
 * Runs all built-in strategies on the same candle set and returns a ranked summary.
 */
export async function compareStrategies(candles, baseConfig = {}) {
  const results = [];

  for (const strategy of Object.values(STRATEGIES)) {
    const engine = new BacktestEngine({ ...baseConfig, candles, strategy });
    const result = engine.run();
    results.push({
      strategy: strategy.label,
      id:       strategy.id,
      metrics:  result.metrics,
      trades:   result.trades.length,
    });

    // Yield to event loop between strategies
    await new Promise(r => setTimeout(r, 0));
  }

  return results.sort((a, b) => {
    if (!a.metrics) return 1;
    if (!b.metrics) return -1;
    return (b.metrics.netPnl || 0) - (a.metrics.netPnl || 0);
  });
}