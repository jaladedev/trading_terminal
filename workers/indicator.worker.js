/**
 * workers/indicator.worker.js
 * Off-main-thread indicator calculations.
 * Handles EMA, RSI, Volume Profile.
 *
 * Usage (from main thread):
 *   const worker = new Worker('workers/indicator.worker.js');
 *   worker.postMessage({ type: 'calc_all', candles: [...], params: { vpBins: 24 } });
 *   worker.onmessage = e => { const { e9s, e20s, e50s, rsi, vp } = e.data; }
 */

/* eslint-env worker */

self.onmessage = function(e) {
  const { type, candles, params } = e.data;

  if (type === 'calc_all') {
    const result = calcAll(candles, params);
    self.postMessage({ type: 'result', ...result });
  }

  if (type === 'calc_screener') {
    const result = calcScreenerBatch(e.data.symbols, e.data.tfData, e.data.tfs);
    self.postMessage({ type: 'screener_result', results: result });
  }
};

// ── EMA ───────────────────────────────────────────────────────────────────────

function ema(arr, period) {
  const k = 2 / (period + 1);
  let state = null;
  return arr.map(v => {
    state = state === null ? v : v * k + state * (1 - k);
    return state;
  });
}

// ── Wilder RSI ────────────────────────────────────────────────────────────────

function wilderRSI(closes, period) {
  if (closes.length < period + 1) return Array(closes.length).fill(null);
  const result = Array(period).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    gains  += Math.max(0, ch);
    losses += Math.max(0, -ch);
  }
  let ag = gains / period, al = losses / period;
  result.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(0, ch))  / period;
    al = (al * (period - 1) + Math.max(0, -ch)) / period;
    result.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return result;
}

// ── ATR ───────────────────────────────────────────────────────────────────────

function calcATR(candles, period) {
  if (!candles || candles.length < 2) return null;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
  });
  const n = Math.min(period, trs.length);
  return trs.slice(-n).reduce((a, b) => a + b, 0) / n;
}

// ── Volume Profile ────────────────────────────────────────────────────────────

function calcVolProfile(candles, bins) {
  if (!candles.length) return null;
  const pMin = Math.min(...candles.map(c => c.l));
  const pMax = Math.max(...candles.map(c => c.h));
  const step = (pMax - pMin) / bins || 0.001;
  const profile = Array(bins).fill(0);

  candles.forEach(c => {
    const bin = Math.min(bins - 1, Math.floor((c.c - pMin) / step));
    profile[bin] += c.v;
  });

  const totalVol = profile.reduce((a, b) => a + b, 0) || 1;
  const maxVol   = Math.max(...profile) || 1;
  const pocBin   = profile.indexOf(maxVol);
  const poc      = pMin + step * (pocBin + 0.5);

  // Value Area (70% of volume)
  const vaTarget = totalVol * 0.7;
  const sorted   = profile.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  let acc = 0;
  const vaBins = new Set();
  for (const { v, i } of sorted) {
    acc += v; vaBins.add(i);
    if (acc >= vaTarget) break;
  }
  const vaBinArr = [...vaBins].sort((a, b) => a - b);
  const vah = pMin + step * (Math.max(...vaBinArr) + 1);
  const val = pMin + step * Math.min(...vaBinArr);

  return { poc, vah, val, profile, pMin, pMax, step, bins };
}

// ── ADX ───────────────────────────────────────────────────────────────────────

function calcADX(candles, period) {
  if (candles.length < period * 2) return null;
  const trs = [], plusDMs = [], minusDMs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)));
    const up = c.h - prev.h, down = prev.l - c.l;
    plusDMs.push(up > down && up > 0 ? up : 0);
    minusDMs.push(down > up && down > 0 ? down : 0);
  }
  let smTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smP  = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smM  = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  const dxs = [];
  for (let i = period; i < trs.length; i++) {
    smTR = smTR - smTR / period + trs[i];
    smP  = smP  - smP  / period + plusDMs[i];
    smM  = smM  - smM  / period + minusDMs[i];
    const pDI = smTR > 0 ? 100 * smP / smTR : 0;
    const mDI = smTR > 0 ? 100 * smM / smTR : 0;
    dxs.push({ dx: (pDI + mDI) > 0 ? 100 * Math.abs(pDI - mDI) / (pDI + mDI) : 0, pDI, mDI });
  }
  if (dxs.length < period) return null;
  let adx = dxs.slice(-period).reduce((a, b) => a + b.dx, 0) / period;
  for (let i = dxs.length - period + 1; i < dxs.length; i++) {
    adx = (adx * (period - 1) + dxs[i].dx) / period;
  }
  const last = dxs[dxs.length - 1];
  return { adx, plusDI: last.pDI, minusDI: last.mDI };
}

// ── Efficiency Ratio ──────────────────────────────────────────────────────────

function calcER(candles, period) {
  if (candles.length < period + 1) return null;
  const slice = candles.slice(-period - 1);
  const net   = Math.abs(slice[slice.length - 1].c - slice[0].c);
  const path  = slice.slice(1).reduce((a, c, i) => a + Math.abs(c.c - slice[i].c), 0);
  return path > 0 ? net / path : 0;
}

// ── Main calc_all ─────────────────────────────────────────────────────────────

function calcAll(candles, params) {
  const closes = candles.map(c => c.c);
  const e9s    = ema(closes, 9);
  const e20s   = ema(closes, 20);
  const e50s   = ema(closes, 50);
  const rsi    = wilderRSI(closes, 14);
  const vp     = calcVolProfile(candles, params.vpBins || 24);
  const atr    = calcATR(candles, 14);
  const adx    = calcADX(candles, 14);
  const er     = calcER(candles, 14);

  // Regime classification
  let regime = null;
  if (adx !== null && er !== null) {
    const isT = adx.adx >= 25 && er >= 0.4;
    const isC = adx.adx < 20 && er < 0.3;
    const type = isT ? 'trending' : isC ? 'choppy' : 'ranging';
    const dir  = adx.plusDI > adx.minusDI + 5 ? 'bull'
               : adx.minusDI > adx.plusDI + 5 ? 'bear' : 'neutral';
    regime = { type, dir, adx: adx.adx, plusDI: adx.plusDI, minusDI: adx.minusDI, er };
  }

  return { e9s, e20s, e50s, rsi, vp, atr, regime };
}

// ── Screener Batch (run in worker) ────────────────────────────────────────────

function calcScreenerBatch(symbols, allTfData, tfs) {
  return symbols.map(sym => {
    const tfData = allTfData[sym] || {};
    const primary = tfData[tfs[0]];
    if (!primary || primary.length < 20) return null;

    const closes = primary.map(c => c.c);
    const e9s    = ema(closes, 9);
    const e20s   = ema(closes, 20);
    const e50s   = ema(closes, 50);
    const rsi    = wilderRSI(closes, 14);
    const atr    = calcATR(primary, 14);

    const le9  = e9s[e9s.length-1];
    const le20 = e20s[e20s.length-1];
    const le50 = e50s[e50s.length-1];
    const lr   = rsi[rsi.length-1];
    const price = primary[primary.length-1].c;

    const bullStack = le9 > le20 && le20 > le50;
    const bearStack = le9 < le20 && le20 < le50;
    let signal = 'tang';
    if (bullStack && (lr === null || (lr >= 40 && lr < 75))) signal = 'bull';
    else if (bearStack && (lr === null || (lr <= 60 && lr > 25))) signal = 'bear';
    else if (bullStack) signal = 'bull';
    else if (bearStack) signal = 'bear';

    // MTF
    const mtfBreakdown = tfs.map(tf => {
      const arr = tfData[tf];
      if (!arr || arr.length < 20) return { tf, signal: 'none' };
      const c  = arr.map(x => x.c);
      const me9  = ema(c, 9), me20 = ema(c, 20), me50 = ema(c, 50);
      const mr   = wilderRSI(c, 14);
      const le9v = me9[me9.length-1], le20v = me20[me20.length-1], le50v = me50[me50.length-1];
      const lrv  = mr[mr.length-1];
      let s = 'tang';
      if (le9v > le20v && le20v > le50v && (lrv === null || (lrv >= 40 && lrv < 75))) s = 'bull';
      else if (le9v < le20v && le20v < le50v && (lrv === null || (lrv <= 60 && lrv > 25))) s = 'bear';
      else if (le9v > le20v && le20v > le50v) s = 'bull';
      else if (le9v < le20v && le20v < le50v) s = 'bear';
      return { tf, signal: s };
    });

    const validMtf  = mtfBreakdown.filter(m => m.signal !== 'none');
    const bullCount = validMtf.filter(m => m.signal === 'bull').length;
    const bearCount = validMtf.filter(m => m.signal === 'bear').length;
    const dominated = Math.max(bullCount, bearCount);
    const mtfFull   = dominated === validMtf.length && validMtf.length > 1;
    const mtfMost   = dominated > validMtf.length / 2 && !mtfFull;
    const mtfDir    = bullCount > bearCount ? 'bull' : bearCount > bullCount ? 'bear' : 'neutral';

    // Volume
    const volAvg  = primary.slice(-20,-3).reduce((a,c) => a+c.v, 0) / 17;
    const volRec  = primary.slice(-3).reduce((a,c) => a+c.v, 0) / 3;
    const volRatio= volAvg > 0 ? volRec / volAvg : null;
    const volSpike= volRatio !== null && volRatio >= 2.5;
    const volHot  = volRatio !== null && volRatio >= 1.5 && !volSpike;

    // Trend age
    let trendAge = 0;
    const isBull = le9 > le20 && le20 > le50;
    const isBear = le9 < le20 && le20 < le50;
    if (isBull || isBear) {
      for (let i = e9s.length - 1; i >= 0; i--) {
        const ok = isBull
          ? (e9s[i] > e20s[i] && e20s[i] > e50s[i])
          : (e9s[i] < e20s[i] && e20s[i] < e50s[i]);
        if (!ok) break;
        trendAge++;
      }
    }

    // Score
    let score = 0;
    if (bullStack || bearStack) score += 25;
    if (mtfFull)   score += 30;
    else if (mtfMost) score += 15;
    if (volSpike)  score += 15;
    else if (volHot) score += 8;
    if (lr !== null && ((signal==='bull' && lr>45&&lr<70)||(signal==='bear'&&lr<55&&lr>30))) score += 10;
    if (trendAge <= 3 && trendAge > 0) score += 10;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const price24 = primary[0].c;
    const chgPct  = price24 > 0 ? (price - price24) / price24 * 100 : 0;

    return {
      sym, price, chgPct, signal,
      signalClass: signal, signalLabel: signal==='bull'?'▲ BULL':signal==='bear'?'▼ BEAR':'NEUTRAL',
      rsi: lr, score, bullStack, bearStack,
      trendAge, volRatio, volSpike, volHot,
      e20dist: le20>0 ? (price-le20)/le20*100 : null,
      mtfDir, mtfFull, mtfMost, mtfBreakdown,
      bullCount, bearCount, availTFs: validMtf.length,
      atr,
    };
  }).filter(Boolean);
}
