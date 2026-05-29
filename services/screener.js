/**
 * services/screener.js
 * Screener engine: processes raw kline data into scored ScreenerResult objects.
 * Runs analysis in a Web Worker for non-blocking UI.
 */

import { calcEMAArray, calcRSIArray, calcATR, getFibLevels, nearestFib } from '../indicators/engine.js';
import { calcTrendAge } from '../indicators/regime.js';
import { fmtSym } from '../utils/helpers.js';

// ── Curated Tier List ─────────────────────────────────────────────────────────

export const SCR_CURATED_TIERS = {
  BTCUSDT:'T1', ETHUSDT:'T1', SOLUSDT:'T1', BNBUSDT:'T1', XRPUSDT:'T1',
  AVAXUSDT:'T2', LINKUSDT:'T2', SUIUSDT:'T2', APTUSDT:'T2', TONUSDT:'T2',
  NEARUSDT:'T2', INJUSDT:'T2', TIAUSDT:'T2', SEIUSDT:'T2', STXUSDT:'T2',
  DOGEUSDT:'MEME', SHIBUSDT:'MEME', PEPEUSDT:'MEME', BONKUSDT:'MEME', WIFUSDT:'MEME',
  FLOKIUSDT:'MEME', MEMEUSDT:'MEME', POPCATUSDT:'MEME', TURBOUSDT:'MEME',
  ARBUSDT:'L2', OPUSDT:'L2', MATICUSDT:'L2', ZKSYNCUSDT:'L2',
  UNIUSDT:'DeFi', AAVEUSDT:'DeFi', CRVUSDT:'DeFi', GMXUSDT:'DeFi',
  FETUSDT:'AI', AGIXUSDT:'AI', WLDUSDT:'AI', RENDERUSDT:'AI', TAOAUSDT:'AI',
  FILUSDT:'Infra', ARUSDT:'Infra', HBARUSDT:'Infra', FLOWUSDT:'Infra',
  AXSUSDT:'Game', IMXUSDT:'Game', GALAUSDT:'Game',
  BNBUSDT:'CEX', OKBUSDT:'CEX', CROKUSDT:'CEX',
};

export const SCR_DEFAULT_COINS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'AVAXUSDT','LINKUSDT','SUIUSDT','APTUSDT','TONUSDT',
  'DOGEUSDT','PEPEUSDT','BONKUSDT','WIFUSDT',
  'ARBUSDT','OPUSDT','MATICUSDT',
  'UNIUSDT','AAVEUSDT',
  'FETUSDT','WLDUSDT','RENDERUSDT',
];

// ── Single-Symbol Analysis ────────────────────────────────────────────────────

/**
 * Analyses one symbol's multi-timeframe kline data and returns a ScreenerResult.
 * @param {string}  sym
 * @param {Record<string,Candle[]>} tfData   tf → candle array
 * @param {string}  primaryTf  — timeframe to base primary signal on
 * @param {number}  fetchedAt
 * @param {string}  source
 */
export function analyseSymbol(sym, tfData, primaryTf, fetchedAt, source) {
  const primary = tfData[primaryTf];
  if (!primary || primary.length < 20) {
    return null;
  }

  const closes = primary.map(c => c.c);
  const e9s    = calcEMAArray(closes, 9);
  const e20s   = calcEMAArray(closes, 20);
  const e50s   = calcEMAArray(closes, 50);
  const rsiArr = calcRSIArray(closes);
  const atr    = calcATR(primary, 14);

  const lastE9  = e9s[e9s.length-1];
  const lastE20 = e20s[e20s.length-1];
  const lastE50 = e50s[e50s.length-1];
  const rsi     = rsiArr[rsiArr.length-1];
  const price   = primary[primary.length-1].c;
  const price24 = primary[0].c;
  const chgPct  = price24 > 0 ? (price - price24) / price24 * 100 : 0;

  // Bull/bear stack
  const bullStack = lastE9 > lastE20 && lastE20 > lastE50;
  const bearStack = lastE9 < lastE20 && lastE20 < lastE50;

  // Signal
  let signal = 'tang', signalClass = 'tang', signalLabel = 'NEUTRAL';
  if (bullStack && rsi !== null && rsi >= 40 && rsi < 75) {
    signal = 'bull'; signalClass = 'bull'; signalLabel = '▲ BULL';
  } else if (bearStack && rsi !== null && rsi <= 60 && rsi > 25) {
    signal = 'bear'; signalClass = 'bear'; signalLabel = '▼ BEAR';
  } else if (bullStack) {
    signal = 'bull'; signalClass = 'bull'; signalLabel = '▲ BULL';
  } else if (bearStack) {
    signal = 'bear'; signalClass = 'bear'; signalLabel = '▼ BEAR';
  }

  // Trend age
  const trendAge = calcTrendAge(e9s, e20s, e50s);

  // Volume spike (compare last 3 candles vs 20-bar average)
  const volAvg   = primary.slice(-20,-3).reduce((a,c) => a+c.v, 0) / 17;
  const volRecent= primary.slice(-3).reduce((a,c) => a+c.v, 0) / 3;
  const volRatio = volAvg > 0 ? volRecent / volAvg : null;
  const volSpike = volRatio !== null && volRatio >= 2.5;
  const volHot   = volRatio !== null && volRatio >= 1.5 && !volSpike;

  // EMA20 distance %
  const e20dist  = lastE20 > 0 ? (price - lastE20) / lastE20 * 100 : null;

  // 24h range position
  const h24 = Math.max(...primary.map(c => c.h));
  const l24 = Math.min(...primary.map(c => c.l));
  const hlPos= (h24 - l24) > 0 ? ((price - l24) / (h24 - l24)) * 100 : 50;

  // Recent EMA crossover
  let recentCross = false;
  if (e9s.length > 5) {
    for (let i = e9s.length - 5; i < e9s.length - 1; i++) {
      const prevBull = e9s[i-1] > e20s[i-1];
      const currBull = e9s[i] > e20s[i];
      if (prevBull !== currBull) { recentCross = true; break; }
    }
  }

  // Fib proximity
  const fibLevels = getFibLevels(primary.slice(-50));
  const fib = fibLevels ? nearestFib(price, fibLevels) : null;
  const fibProximity = fib && fib.distPct < 3
    ? {
      ...fib,
      dir: fib.price < price ? 'support' : 'resistance',
      dirLabel: fib.price < price ? '↓support' : '↑resistance',
      strength: Math.max(0, 100 - fib.distPct * 30),
    }
    : null;

  // MTF confluence
  const mtfTfs = Object.keys(tfData);
  const mtfBreakdown = mtfTfs.map(tf => {
    const arr = tfData[tf];
    if (!arr || arr.length < 20) return { tf, signal: 'none' };
    const c = arr.map(x => x.c);
    const me9  = calcEMAArray(c, 9);
    const me20 = calcEMAArray(c, 20);
    const me50 = calcEMAArray(c, 50);
    const mr   = calcRSIArray(c);
    const le9  = me9[me9.length-1], le20 = me20[me20.length-1], le50 = me50[me50.length-1];
    const lr   = mr[mr.length-1];
    let s = 'tang';
    if (le9 > le20 && le20 > le50 && (lr === null || (lr >= 40 && lr < 75))) s = 'bull';
    else if (le9 < le20 && le20 < le50 && (lr === null || (lr <= 60 && lr > 25))) s = 'bear';
    else if (le9 > le20 && le20 > le50) s = 'bull';
    else if (le9 < le20 && le20 < le50) s = 'bear';
    return { tf, signal: s, e9: le9, e20: le20, e50: le50 };
  });

  const validMtf  = mtfBreakdown.filter(m => m.signal !== 'none');
  const bullCount = validMtf.filter(m => m.signal === 'bull').length;
  const bearCount = validMtf.filter(m => m.signal === 'bear').length;
  const dominated = Math.max(bullCount, bearCount);
  const mtfDir    = bullCount > bearCount ? 'bull' : bearCount > bullCount ? 'bear' : 'neutral';
  const mtfFull   = dominated === validMtf.length && validMtf.length > 1;
  const mtfMost   = dominated > validMtf.length / 2 && !mtfFull;
  const mtfScore  = validMtf.length > 0 ? (dominated / validMtf.length) * 100 : 0;

  // Composite score
  let score = 0;
  if (bullStack || bearStack) score += 25;
  if (mtfFull)   score += 30;
  else if (mtfMost) score += 15;
  if (volSpike)  score += 15;
  else if (volHot) score += 8;
  if (recentCross) score += 10;
  if (rsi !== null) {
    const rsiOk = signal === 'bull'
      ? (rsi > 45 && rsi < 70)
      : (rsi < 55 && rsi > 30);
    if (rsiOk) score += 10;
  }
  if (fibProximity && fibProximity.tier === 'gold') score += 10;
  if (trendAge <= 3 && trendAge > 0) score += 10;
  if (hlPos >= 75)  score -= 5;
  if (hlPos <= 25)  score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    sym, price, chgPct, signal, signalClass, signalLabel,
    rsi, score, bullStack, bearStack,
    stackLabel: bullStack ? '9>20>50' : bearStack ? '9<20<50' : 'MIXED',
    trendAge, volRatio, volSpike, volHot, e20dist,
    hlPos, nearHigh: hlPos >= 80, nearLow: hlPos <= 20,
    recentCross, fibProximity,
    mtfDir, mtfScore, mtfFull, mtfMost, mtfBreakdown,
    bullCount, bearCount, availTFs: validMtf.length, totalTFs: mtfBreakdown.length,
    fetchedAt, source, tfData,
    atr, e9: lastE9, e20: lastE20, e50: lastE50,
  };
}

// ── Screener Filters ──────────────────────────────────────────────────────────

export function applyScreenerFilters(results, filter) {
  if (filter === 'all') return results;
  return results.filter(r => {
    if (filter === 'bull')    return r.signal === 'bull';
    if (filter === 'bear')    return r.signal === 'bear';
    if (filter === 'hot')     return r.volSpike || r.volHot;
    if (filter === 'cross')   return r.recentCross;
    if (filter === 'breakout')return r.mtfFull && (r.volSpike || r.volHot);
    return true;
  });
}

export function sortScreenerResults(results, key, asc) {
  return [...results].sort((a, b) => {
    let av = a[key], bv = b[key];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    return asc ? av - bv : bv - av;
  });
}

// ── Sector Rotation Detector ──────────────────────────────────────────────────

/**
 * Given screener results, returns a sector breakdown showing which categories
 * are showing bullish vs bearish signals.
 */
export function detectSectorRotation(results) {
  const sectors = {};

  results.forEach(r => {
    const tier = SCR_CURATED_TIERS[r.sym] || 'Other';
    if (!sectors[tier]) sectors[tier] = { bull: 0, bear: 0, total: 0 };
    sectors[tier].total++;
    if (r.signal === 'bull') sectors[tier].bull++;
    if (r.signal === 'bear') sectors[tier].bear++;
  });

  return Object.entries(sectors).map(([name, s]) => ({
    name,
    bullPct: s.total > 0 ? Math.round(s.bull / s.total * 100) : 0,
    bearPct: s.total > 0 ? Math.round(s.bear / s.total * 100) : 0,
    total:   s.total,
    bias:    s.bull > s.bear ? 'bull' : s.bear > s.bull ? 'bear' : 'neutral',
  })).sort((a, b) => b.bullPct - a.bullPct);
}
