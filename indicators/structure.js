/**
 * indicators/structure.js
 * Market structure analysis:
 *   - Swing high / swing low detection
 *   - Break of Structure (BOS)
 *   - Change of Character (CHoCH)
 *   - Liquidity sweeps
 *   - Equal highs / lows
 *   - Previous day / session high-low
 */

// ── Swing Points ──────────────────────────────────────────────────────────────

/**
 * Detects pivot swing highs and lows using a left/right lookback window.
 * @param {Candle[]} candles
 * @param {number}   leftBars  - bars to look left
 * @param {number}   rightBars - bars to look right (requires future bars, so caps at available)
 * @returns {SwingPoint[]}
 */
export function detectSwingPoints(candles, leftBars = 3, rightBars = 3) {
  const swings = [];
  const n = candles.length;

  for (let i = leftBars; i < n - rightBars; i++) {
    const c = candles[i];

    // Swing High: highest high in window
    let isHigh = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].h >= c.h) { isHigh = false; break; }
    }
    if (isHigh) {
      swings.push({ idx: i, price: c.h, type: 'high', ts: c.t || 0 });
    }

    // Swing Low: lowest low in window
    let isLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].l <= c.l) { isLow = false; break; }
    }
    if (isLow) {
      swings.push({ idx: i, price: c.l, type: 'low', ts: c.t || 0 });
    }
  }

  return swings;
}

// ── Break of Structure (BOS) & Change of Character (CHoCH) ───────────────────

/**
 * Detects BOS and CHoCH events from a list of swing points.
 *
 * BOS   = price breaks the most recent swing high (in uptrend) or low (in downtrend)
 *         in the SAME direction as the prevailing structure — continuation.
 * CHoCH = price breaks the most recent swing high in a downtrend, or low in an uptrend
 *         — potential trend reversal signal.
 *
 * @param {Candle[]}      candles
 * @param {SwingPoint[]}  swings
 * @returns {StructureEvent[]}
 */
export function detectStructureBreaks(candles, swings) {
  const events = [];
  if (swings.length < 2) return events;

  // Sort swings by index
  const sorted = [...swings].sort((a, b) => a.idx - b.idx);

  // Build sequence of HH/LH/HL/LL to determine prevailing structure
  const highs = sorted.filter(s => s.type === 'high');
  const lows  = sorted.filter(s => s.type === 'low');

  if (highs.length < 2 || lows.length < 2) return events;

  // Check each new high/low for BOS/CHoCH
  for (let i = 1; i < highs.length; i++) {
    const prev = highs[i - 1];
    const curr = highs[i];
    // BOS bull: new high > previous high
    if (curr.price > prev.price) {
      events.push({ type: 'BOS', dir: 'bull', price: prev.price, idx: curr.idx, ts: curr.ts });
    }
  }

  for (let i = 1; i < lows.length; i++) {
    const prev = lows[i - 1];
    const curr = lows[i];
    // BOS bear: new low < previous low
    if (curr.price < prev.price) {
      events.push({ type: 'BOS', dir: 'bear', price: prev.price, idx: curr.idx, ts: curr.ts });
    }
  }

  // CHoCH: break of last low in uptrend, or last high in downtrend
  // Simple approach: look at last 2 highs and 2 lows
  if (highs.length >= 2 && lows.length >= 2) {
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow  = lows[lows.length - 1];
    const prevLow  = lows[lows.length - 2];

    // Uptrend (HH + HL): if last candle close breaks below last HL = CHoCH bear
    const isUptrend = lastHigh.price > prevHigh.price && lastLow.price > prevLow.price;
    const isDowntrend = lastHigh.price < prevHigh.price && lastLow.price < prevLow.price;

    if (isUptrend && candles.length > 0) {
      const lastClose = candles[candles.length - 1].c;
      if (lastClose < lastLow.price) {
        events.push({ type: 'CHoCH', dir: 'bear', price: lastLow.price, idx: candles.length - 1, ts: candles[candles.length - 1].t || 0 });
      }
    }
    if (isDowntrend && candles.length > 0) {
      const lastClose = candles[candles.length - 1].c;
      if (lastClose > lastHigh.price) {
        events.push({ type: 'CHoCH', dir: 'bull', price: lastHigh.price, idx: candles.length - 1, ts: candles[candles.length - 1].t || 0 });
      }
    }
  }

  // Deduplicate by price+type
  const seen = new Set();
  return events.filter(e => {
    const key = `${e.type}-${e.dir}-${e.price.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Liquidity Sweeps ──────────────────────────────────────────────────────────

/**
 * Detects potential liquidity sweeps: price wicks through a recent swing high/low
 * but closes back inside, suggesting stop hunts.
 */
export function detectLiquiditySweeps(candles, swings, tolerance = 0.002) {
  const sweeps = [];
  const recent = candles.slice(-20);

  swings.forEach(swing => {
    recent.forEach((c, i) => {
      if (c.t && swing.ts && c.t <= swing.ts) return; // only look forward
      if (swing.type === 'high') {
        // Wick above swing high but close below = liquidity sweep of highs
        if (c.h > swing.price * (1 + tolerance) && c.c < swing.price) {
          sweeps.push({ swingType: 'high', swingPrice: swing.price, wickHigh: c.h, closePrice: c.c, idx: candles.length - recent.length + i });
        }
      } else {
        // Wick below swing low but close above = liquidity sweep of lows
        if (c.l < swing.price * (1 - tolerance) && c.c > swing.price) {
          sweeps.push({ swingType: 'low', swingPrice: swing.price, wickLow: c.l, closePrice: c.c, idx: candles.length - recent.length + i });
        }
      }
    });
  });

  return sweeps;
}

// ── Equal Highs / Lows ────────────────────────────────────────────────────────

/**
 * Finds equal highs or equal lows (price within tolerance % of each other).
 * These represent clustered stop areas / liquidity pools.
 */
export function detectEqualLevels(swings, tolerance = 0.003) {
  const equals = [];
  const highs = swings.filter(s => s.type === 'high');
  const lows  = swings.filter(s => s.type === 'low');

  const findEquals = (points) => {
    for (let i = 0; i < points.length - 1; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const diff = Math.abs(points[i].price - points[j].price) / points[i].price;
        if (diff < tolerance) {
          equals.push({ type: points[i].type, price: (points[i].price + points[j].price) / 2, count: 2 });
        }
      }
    }
  };

  findEquals(highs);
  findEquals(lows);
  return equals;
}

// ── Previous Day / Session High-Low ──────────────────────────────────────────

/**
 * Returns previous day high/low and current day high/low from candle data.
 */
export function getSessionLevels(candles) {
  if (!candles || candles.length === 0) return null;

  const now = new Date();
  const todayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()+1}-${now.getUTCDate()}`;

  let todayCandles = [], prevCandles = [];
  let prevKey = null;

  candles.forEach(c => {
    if (!c.t) return;
    const d = new Date(c.t);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
    if (key === todayKey) {
      todayCandles.push(c);
    } else {
      if (!prevKey) prevKey = key;
      if (key === prevKey) prevCandles.push(c);
    }
  });

  const todayHigh = todayCandles.length ? Math.max(...todayCandles.map(c => c.h)) : null;
  const todayLow  = todayCandles.length ? Math.min(...todayCandles.map(c => c.l)) : null;
  const prevHigh  = prevCandles.length  ? Math.max(...prevCandles.map(c => c.h))  : null;
  const prevLow   = prevCandles.length  ? Math.min(...prevCandles.map(c => c.l))  : null;

  return { todayHigh, todayLow, prevHigh, prevLow, prevKey };
}

// ── Support / Resistance from Swing Clusters ──────────────────────────────────

/**
 * Groups nearby swing points into S/R zones.
 * Returns zones sorted by price.
 */
export function buildSRZones(swings, tolerance = 0.005) {
  const zones = [];

  swings.forEach(s => {
    const existing = zones.find(z => Math.abs(z.price - s.price) / z.price < tolerance);
    if (existing) {
      existing.touches++;
      existing.price = (existing.price * (existing.touches - 1) + s.price) / existing.touches;
      existing.lastTs = Math.max(existing.lastTs, s.ts);
    } else {
      zones.push({ price: s.price, type: s.type, touches: 1, lastTs: s.ts });
    }
  });

  return zones.sort((a, b) => a.price - b.price);
}
