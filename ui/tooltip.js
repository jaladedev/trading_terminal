/**
 * ui/tooltip.js
 * Rich hover tooltips for every indicator, badge, and metric.
 */

// ── Content dictionary ────────────────────────────────────────────────────────

export const TIPS = {

  // ── Market Regime ───────────────────────────────────────────────────────────
  'regime.trending.bull': {
    title: '📈 Trending Bull',
    body:  'EMAs are stacked 9 > 20 > 50. Price is in a confirmed uptrend with momentum behind it.',
    action:'Buy pullbacks to EMA9 or EMA20. Avoid countertrend shorts unless structure clearly breaks.',
  },
  'regime.trending.bear': {
    title: '📉 Trending Bear',
    body:  'EMAs are stacked 9 < 20 < 50. Price is in a confirmed downtrend.',
    action:'Sell rallies to EMA9 or EMA20. Avoid longs until price reclaims EMA50.',
  },
  'regime.ranging': {
    title: '↔ Ranging',
    body:  'Price is oscillating between EMAs with no dominant direction. ADX is typically 15–25.',
    action:'Fade moves at range extremes. Target 1:1 to 1:1.5 R:R — do not run trend targets.',
  },
  'regime.choppy': {
    title: '🌀 Choppy',
    body:  'EMAs are tangled together. High noise, low edge. Most breakouts fail in this environment.',
    action:'Stay out or cut size to 25–50%. Wait for EMAs to separate and ADX to exceed 20.',
  },

  // ── Regime sub-metrics ──────────────────────────────────────────────────────
  'regime.adx': {
    title: 'ADX — Average Directional Index',
    body:  'Measures trend strength, not direction. >25 = strong trend. 15–25 = developing. <15 = weak/sideways.',
    action:'Only use trend-following entries when ADX > 20. Below 15, prefer range strategies or stand aside.',
  },
  'regime.er': {
    title: 'Efficiency Ratio',
    body:  'How efficiently price is moving: 1.0 = perfectly directional, 0.0 = pure noise. High ER in a choppy regime is a green flag.',
    action:'Trade trend strategies when ER > 0.6. Below 0.3, breakouts are likely to fail — avoid them.',
  },

  // ── Session ─────────────────────────────────────────────────────────────────
  'session.asia': {
    title: '🌏 Asia Session',
    body:  '00:00–08:00 UTC. Lower volatility, tighter ranges. Often sets the daily high or low that gets swept during London.',
    action:'Mark Asia highs and lows. Expect London to sweep at least one of them at the 08:00 open.',
  },
  'session.london': {
    title: '🇬🇧 London Session',
    body:  '08:00–16:00 UTC. High liquidity, strong momentum. Frequently reverses or extends the Asia range.',
    action:'Best window for trend entries. Watch for a sharp sweep of Asia highs/lows in the first 30 minutes.',
  },
  'session.ny': {
    title: '🇺🇸 New York Session',
    body:  '13:00–21:00 UTC. Highest overall volume. NY open (13:00) often produces the best setups of the day.',
    action:'Focus entries around 13:00–16:00. The London/NY overlap is the highest-probability window.',
  },
  'session.overlap': {
    title: '⚡ London / NY Overlap',
    body:  '13:00–16:00 UTC. Peak volume window. Major directional moves and reversals frequently originate here.',
    action:'Prime entry window. A setup scoring > 65 during overlap carries additional edge — treat it as a bonus.',
  },
  'session.dead': {
    title: '🌙 Low-Volume Window',
    body:  'Outside major sessions. Spreads are wider, moves are less reliable, and liquidity is thin.',
    action:'Reduce size or avoid. Setups that trigger here have lower follow-through probability.',
  },

  // ── Squeeze ─────────────────────────────────────────────────────────────────
  'squeeze.active': {
    title: '🗜 Volatility Squeeze',
    body:  'Bollinger Bands are inside Keltner Channels. Volatility is compressed — a large move is building but direction is unknown.',
    action:'Do not enter yet. Wait for the breakout candle to form and confirm direction. Never fade a squeeze breakout.',
  },
  'squeeze.bull': {
    title: '🚀 Squeeze Breakout — Bull',
    body:  'The squeeze has fired upward. Momentum histogram confirms bullish breakout from the compression zone.',
    action:'Enter long on the breakout candle or the first pullback. Target 1.5–2× the prior compression range.',
  },
  'squeeze.bear': {
    title: '💥 Squeeze Breakout — Bear',
    body:  'The squeeze has fired downward. Momentum histogram confirms bearish breakout from the compression zone.',
    action:'Enter short on the breakout candle or the first pullback. Target 1.5–2× the prior compression range.',
  },

  // ── Displacement candles ─────────────────────────────────────────────────────
  'displacement.moderate': {
    title: '⚡ Displacement Candle (1.5–2×)',
    body:  'This candle is 1.5–2× the average range. Signals above-average participation, likely institutional.',
    action:'Wait for the first pullback to the candle\'s midpoint or open. Enter in the displacement direction.',
  },
  'displacement.strong': {
    title: '🔥 Strong Displacement (2–3×)',
    body:  'Candle is 2–3× average range. Strong institutional order flow. Nearby supply/demand zones are likely to hold.',
    action:'High-probability reversal from the origin of the displacement. Enter on retest with a tight stop.',
  },
  'displacement.extreme': {
    title: '💥 Extreme Displacement (3×+)',
    body:  'Candle is 3×+ average range. Rare and significant. Often marks a major turning point or news event.',
    action:'Very high-probability continuation after the first pullback. You can size up within your risk rules.',
  },

  // ── Liquidity sweeps ─────────────────────────────────────────────────────────
  'sweep.low': {
    title: '↓ Liquidity Sweep — Lows',
    body:  'Price briefly broke below a swing low (triggering stop losses), then recovered. Smart money grabbed sell-side liquidity.',
    action:'Look for long entries above the swept low. The sweep creates a clean reference low and shifts short-term bias bullish.',
  },
  'sweep.high': {
    title: '↑ Liquidity Sweep — Highs',
    body:  'Price briefly exceeded a swing high (triggering stops), then reversed. Buy-side liquidity has been taken.',
    action:'Look for short entries below the swept high. The sweep creates a clean reference high and shifts short-term bias bearish.',
  },

  // ── Equal levels ─────────────────────────────────────────────────────────────
  'equal.highs': {
    title: '= Equal Highs',
    body:  'Two or more swing highs at the same price level. A pool of buy-side liquidity (stop losses from shorts) sits just above them.',
    action:'Expect price to sweep these highs. Use the sweep as a short trigger, or a confirmed breakout above as a long trigger.',
  },
  'equal.lows': {
    title: '= Equal Lows',
    body:  'Two or more swing lows at the same price. A pool of sell-side liquidity (stop losses from longs) sits just below them.',
    action:'Expect price to sweep these lows. Use the sweep as a long trigger, or a confirmed breakdown below as a short trigger.',
  },

  // ── Structure events ──────────────────────────────────────────────────────────
  'struct.bos.bull': {
    title: '📐 Break of Structure — Bullish',
    body:  'Price has broken and closed above the previous swing high. The uptrend sequence is confirmed.',
    action:'Buy pullbacks to the breakout level — it typically becomes new support. Hold until the next swing high.',
  },
  'struct.bos.bear': {
    title: '📐 Break of Structure — Bearish',
    body:  'Price has broken and closed below the previous swing low. The downtrend sequence is confirmed.',
    action:'Sell rallies to the breakdown level — it typically becomes new resistance.',
  },
  'struct.mss.bull': {
    title: '🔄 Market Structure Shift — Bullish',
    body:  'After a series of lower highs and lows, price has broken above a recent swing high. A potential trend reversal is beginning.',
    action:'Watch for a pullback entry. One MSS alone is not confirmation — wait for a second BOS or volume confirmation.',
  },
  'struct.mss.bear': {
    title: '🔄 Market Structure Shift — Bearish',
    body:  'After a series of higher highs and lows, price has broken below a recent swing low. A potential trend reversal is forming.',
    action:'Watch for a rally to short. Confirm with bearish momentum, an EMA cross, or a second structural break.',
  },

  // ── Entry quality ─────────────────────────────────────────────────────────────
  'quality.prime': {
    title: '⭐ Prime Setup (75–100)',
    body:  'Multiple confluence factors agree: trend, momentum, VWAP position, structure, and timing are all aligned.',
    action:'Full position size within your risk rules. These setups are rare — act decisively.',
  },
  'quality.good': {
    title: '✅ Good Setup (50–74)',
    body:  'Most conditions align but one or two factors are absent or borderline.',
    action:'Proceed with 75% of your normal size. Tighten the stop slightly and monitor closely.',
  },
  'quality.weak': {
    title: '⚠ Weak Setup (25–49)',
    body:  'Several conflicting signals. The edge is marginal. These setups break even at best over time.',
    action:'Skip or wait for an improvement. If you must enter, use 50% size with a tight stop.',
  },
  'quality.skip': {
    title: '🚫 Skip (<25)',
    body:  'Conditions are unfavourable. Too many factors oppose the trade. This is gambling, not trading.',
    action:'Do not enter. Close the chart and wait for a proper setup.',
  },

  // ── HTF conflict ──────────────────────────────────────────────────────────────
  'htf.conflict': {
    title: '⚠ Higher TF Conflict',
    body:  'The signal on your current timeframe disagrees with the trend or momentum on a higher timeframe (e.g. your 5m signal is bullish but 1h or 4h is bearish).',
    action:'Reduce size by at least 50%. Wait for the higher TF to align before entering at full size. Run the screener to confirm.',
  },
  'htf.clean': {
    title: '✅ No HTF Conflict',
    body:  'Your entry timeframe signal is supported by the higher timeframe trend. No opposing force detected.',
    action:'No adjustment needed. Proceed with normal sizing.',
  },

  // ── Volume ────────────────────────────────────────────────────────────────────
  'vol.spike.aligned': {
    title: '🔥 Volume Spike — Aligned',
    body:  'Volume is 2×+ the 20-bar average AND supports your signal direction. Strong institutional participation in your favour.',
    action:'High-conviction entry. Volume confirms the move. You can size at the upper end of your normal range.',
  },
  'vol.spike.opposed': {
    title: '🔥⚠ Volume Spike — Opposed',
    body:  'Volume is spiking against your signal direction. Institutional flow may be reversing the move you want to take.',
    action:'Do not enter against this volume spike. Skip the setup or wait for it to resolve.',
  },
  'vol.hot': {
    title: '⚡ Elevated Volume',
    body:  'Volume is 1.5–2× average. Meaningful participation but not extreme. Supporting evidence for the signal.',
    action:'Good confirmation. Use as one factor among several — not sufficient alone.',
  },
  'vol.normal': {
    title: 'Normal Volume',
    body:  'Volume is within the typical range for this asset and timeframe.',
    action:'Neutral. No adjustment needed, but prefer setups with elevated or aligned volume.',
  },

  // ── MTF score ─────────────────────────────────────────────────────────────────
  'mtf.full': {
    title: '✅ Full MTF Confluence',
    body:  'Every selected timeframe agrees on signal direction. The rarest and highest-conviction alignment possible.',
    action:'Maximum size within your risk rules. These setups are the cleanest available.',
  },
  'mtf.most': {
    title: '◑ Most TFs Aligned',
    body:  'The majority of timeframes agree, but one or two show mixed or opposing signals.',
    action:'Standard size. Monitor the conflicting timeframe as an early exit signal.',
  },
  'mtf.mixed': {
    title: '⚠ Mixed MTF Signals',
    body:  'Timeframes are roughly split. No clear directional bias across the board.',
    action:'Reduce size to 50–60%. Only enter if the entry TF signal is very clean.',
  },
  'mtf.conflict': {
    title: '❌ MTF Conflict',
    body:  'Higher timeframes directly oppose the signal on your entry timeframe. High risk of a false breakout or reversal.',
    action:'Skip or reduce to minimal size. Wait for the higher TF to resolve before re-evaluating.',
  },

  // ── Fib levels ────────────────────────────────────────────────────────────────
  'fib.618': {
    title: '🔑 61.8% Fibonacci (Golden Ratio)',
    body:  'The most respected Fibonacci level. The deepest meaningful retracement before continuation. Often coincides with VWAP or EMA50.',
    action:'High-probability reversal zone. Enter with a stop just beyond 78.6%. Best entries are here in trending markets.',
  },
  'fib.50': {
    title: '50% Fibonacci',
    body:  'The midpoint of a swing. Not a true Fibonacci ratio but widely used by retail and institutional traders alike.',
    action:'Decent entry zone when combined with an EMA or VWAP level. Enter on confirmation, not blindly.',
  },
  'fib.382': {
    title: '38.2% Fibonacci',
    body:  'A shallow retracement typical of strong trends. Price only pulls back this far when momentum is very strong.',
    action:'Enter here in strong trends. If price breaks through, expect a deeper retracement to 50% or 61.8%.',
  },
  'fib.236': {
    title: '23.6% Fibonacci',
    body:  'Very shallow retracement. Only holds in extremely strong momentum moves.',
    action:'Aggressive entry in very strong trends only. High risk if momentum stalls.',
  },

  // ── VWAP / AVWAP ─────────────────────────────────────────────────────────────
  'vwap': {
    title: 'VWAP — Volume-Weighted Average Price',
    body:  'The average price paid today, weighted by volume. Price above = bullish bias. Price below = bearish bias. Resets each session.',
    action:'Buy pullbacks to VWAP in an uptrend. Sell rallies to VWAP in a downtrend. Cross of VWAP is a directional signal.',
  },
  'avwap': {
    title: 'AVWAP — Anchored VWAP',
    body:  'VWAP anchored to a specific candle (e.g. session open, swing high/low). Acts as a dynamic support/resistance.',
    action:'Use as a key level for entries and exits. Price trading above AVWAP = bullish. Below = bearish.',
  },

  // ── Order flow / CVD ──────────────────────────────────────────────────────────
  'cvd': {
    title: 'CVD — Cumulative Volume Delta',
    body:  'Running total of (buy volume − sell volume). Rising = more aggressive buying. Falling = more aggressive selling.',
    action:'Trade in the direction of CVD trend. Divergence between CVD and price often precedes a reversal.',
  },
  'delta.buy': {
    title: 'Buy Volume',
    body:  'Total aggressive buy volume (market orders hitting the ask) in the current session.',
    action:'Rising buy volume supports long setups. Compare against sell volume to assess dominance.',
  },
  'delta.sell': {
    title: 'Sell Volume',
    body:  'Total aggressive sell volume (market orders hitting the bid) in the current session.',
    action:'Rising sell volume supports short setups. Compare against buy volume to assess dominance.',
  },
  'delta.net': {
    title: 'Net Delta',
    body:  'Buy volume minus sell volume. Positive = buyers in control. Negative = sellers in control.',
    action:'Confirm your directional bias with net delta. A strong signal with opposing delta is lower probability.',
  },

  // ── Volume profile ────────────────────────────────────────────────────────────
  'vp.poc': {
    title: 'POC — Point of Control',
    body:  'The price level with the highest traded volume in the session. Price gravitates toward POC in low-momentum environments.',
    action:'In ranging markets, expect price to revert to POC. In trending markets, POC acts as trailing support/resistance.',
  },
  'vp.vah': {
    title: 'VAH — Value Area High',
    body:  'Upper boundary of the value area (70% of session volume traded between VAL and VAH).',
    action:'Longs above VAH are in "premium" territory. Shorts initiated above VAH target a return to the value area.',
  },
  'vp.val': {
    title: 'VAL — Value Area Low',
    body:  'Lower boundary of the value area (70% of session volume traded between VAL and VAH).',
    action:'Shorts below VAL are in "discount" territory. Longs initiated below VAL target a return to the value area.',
  },

  // ── Indicators legend ─────────────────────────────────────────────────────────
  'ema.9': {
    title: 'EMA 9 — Fast EMA',
    body:  'The fastest-reacting moving average. Price trading above it is a short-term bullish sign. Used for pullback entries.',
    action:'In an uptrend, buy touches of EMA9. In a downtrend, sell bounces to EMA9. Cross below EMA20 = early warning.',
  },
  'ema.20': {
    title: 'EMA 20 — Mid EMA',
    body:  'The core trend EMA. In a healthy uptrend, price stays above EMA20. Loss of EMA20 signals trend weakness.',
    action:'Buy EMA20 touches in strong uptrends. Breakdown below EMA20 = reduce or exit longs.',
  },
  'ema.50': {
    title: 'EMA 50 — Slow EMA',
    body:  'The macro trend filter. Above EMA50 = bullish macro bias. Below = bearish macro bias. Major reversals often test EMA50.',
    action:'Only take longs when price is above EMA50. Only take shorts when price is below EMA50.',
  },

  // ── ATR-based metrics ─────────────────────────────────────────────────────────
  'atr.trail': {
    title: 'ATR Trailing Stop (2×)',
    body:  'Dynamic stop level set 2× ATR from current price in your trade direction. Moves with price to lock in profits.',
    action:'After hitting TP1, move stop to this level. Gives the trade room to breathe while protecting gains.',
  },
  'atr.size': {
    title: 'ATR Position Size (1% risk)',
    body:  'Recommended position size to risk exactly 1% of your account, with the stop placed 2× ATR away.',
    action:'Use this as a baseline. Scale down if HTF conflict exists or quality score is below 50.',
  },

  // ── Entry zones ───────────────────────────────────────────────────────────────
  'zone.aggressive': {
    title: '⚡ Aggressive Entry',
    body:  'Enter immediately at market price near EMA9. Captures maximum move but carries the widest stop.',
    action:'Use only when momentum is very strong and you accept a larger stop. Best for squeeze breakouts.',
  },
  'zone.balanced': {
    title: '⚖ Balanced Entry',
    body:  'Wait for a pullback to the EMA9/20 midpoint. Better risk:reward than aggressive while still capturing most of the move.',
    action:'The best all-round entry. Set a limit order and let price come to you.',
  },
  'zone.conservative': {
    title: '🛡 Conservative Entry',
    body:  'Wait for a full pullback to EMA20 and a confirmation candle. Tightest stop, best R:R, but lowest fill probability.',
    action:'Use in choppy or ranging markets. Patience required — the setup may not pull back this far.',
  },
  
  // ── Screener columns ──────────────────────────────────────────────────────────
  'scr.score': {
    title: 'Setup Score (0–100)',
    body:  'Composite quality score. 75+ = prime, 50–74 = good, 25–49 = weak, <25 = skip. Combines trend, momentum, volume, structure, and timing.',
    action:'Filter to score > 60 for the cleanest setups. Sort by score descending to find the best opportunities.',
  },
  'scr.stack': {
    title: 'EMA Stack',
    body:  '"9>20>50" = full bullish alignment. "9<20<50" = full bearish alignment. "MIX" = tangled EMAs, no clear trend.',
    action:'Only trade in the direction of the stack. Avoid "MIX" setups entirely.',
  },
  'scr.age': {
    title: 'Trend Age (candles since cross)',
    body:  'Number of candles since the last EMA9/20 crossover. Fresh crosses (≤5) have the most remaining potential.',
    action:'Prefer age ≤ 8 candles. Above 40, the move is mature and a reversal or consolidation is more likely.',
  },
  'scr.dist': {
    title: 'Distance from EMA20',
    body:  'How far price is from EMA20 as a percentage. Extended = >5%. Near = ≤1%.',
    action:'Near EMA20 is the best entry area. Very extended (>5%) — wait for a pullback rather than chasing.',
  },
  'scr.hlpos': {
    title: 'H/L Position',
    body:  'Where price sits within its 24h high–low range. "Low" = near bottom, "High" = near top.',
    action:'✓ = price is on the correct side for your signal (buying near lows, selling near highs). ⚠ = extended, avoid chasing.',
  },
};

// ── Tooltip engine ────────────────────────────────────────────────────────────

let _el        = null;
let _showTimer = null;
const SHOW_DELAY_MS = 280;

function _getOrCreate() {
  if (_el) return _el;
  _el = document.createElement('div');
  _el.id = 'tt-tooltip';
  _el.setAttribute('role', 'tooltip');
  _el.setAttribute('aria-live', 'polite');
  _el.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'width:264px',
    'background:var(--bg2,#1a1f2e)',
    'border:1px solid var(--border2,rgba(255,255,255,0.12))',
    'border-radius:8px',
    'padding:10px 13px 11px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    'pointer-events:none',
    'opacity:0',
    'transform:translateY(6px)',
    'transition:opacity 0.14s ease,transform 0.14s ease',
    'line-height:1.55',
    'display:none',
  ].join(';');
  document.body.appendChild(_el);
  return _el;
}

function _position(anchor) {
  const tt    = _el;
  const rect  = anchor.getBoundingClientRect();
  const gap   = 9;
  const pad   = 8;
  const ttW   = 264;
  const ttH   = tt.offsetHeight || 100;

  // Prefer above; flip below if not enough room
  let top  = rect.top - ttH - gap;
  let left = rect.left + rect.width / 2 - ttW / 2;

  if (top < pad) top = rect.bottom + gap;

  left = Math.max(pad, Math.min(left, window.innerWidth - ttW - pad));
  top  = Math.max(pad, Math.min(top,  window.innerHeight - ttH - pad));

  tt.style.left = left + 'px';
  tt.style.top  = top  + 'px';
}

function _render(key, overrides = {}) {
  const base   = TIPS[key] || {};
  const title  = overrides.title  || base.title  || '';
  const body   = overrides.body   || base.body   || '';
  const action = overrides.action || base.action || '';

  if (!title && !body && !action) return false;

  _el.innerHTML = [
    title  ? `<div style="font-size:11px;font-weight:700;color:var(--text,#e2e8f0);margin-bottom:5px;font-family:var(--mono,'JetBrains Mono',monospace)">${title}</div>` : '',
    body   ? `<div style="font-size:10.5px;color:var(--text2,rgba(226,232,240,0.65));font-family:system-ui,sans-serif;line-height:1.55">${body}</div>` : '',
    action ? `<div style="margin-top:7px;padding-top:6px;border-top:1px solid var(--border,rgba(255,255,255,0.08));font-size:10px;color:var(--green,#00e5a0);font-family:system-ui,sans-serif;line-height:1.5"><span style="opacity:0.55">→ </span>${action}</div>` : '',
  ].join('');

  return true;
}

function _show(anchor) {
  const key      = anchor.dataset.tip;
  const overrides = {
    title:  anchor.dataset.tipTitle,
    body:   anchor.dataset.tipBody,
    action: anchor.dataset.tipAction,
  };

  const tt = _getOrCreate();
  tt.style.display = 'block';
  tt.style.opacity = '0';

  if (!_render(key, overrides)) {
    tt.style.display = 'none';
    return;
  }

  // Force layout so offsetHeight is correct before positioning
  // eslint-disable-next-line no-unused-expressions
  tt.offsetHeight;
  _position(anchor);

  requestAnimationFrame(() => {
    tt.style.opacity   = '1';
    tt.style.transform = 'translateY(0)';
  });
}

function _hide() {
  if (!_el) return;
  _el.style.opacity   = '0';
  _el.style.transform = 'translateY(6px)';
  // Hide from DOM after transition so it doesn't block clicks
  setTimeout(() => { if (_el) _el.style.display = 'none'; }, 160);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once from init() to wire up event delegation.
 * All elements with [data-tip] are handled automatically.
 */
export function initTooltips() {
  document.addEventListener('mouseenter', e => {
    const target = e.target instanceof Element ? e.target : e.target?.parentElement;
    const anchor = target?.closest('[data-tip]');
    if (!anchor) return;
    clearTimeout(_showTimer);
    _showTimer = setTimeout(() => _show(anchor), SHOW_DELAY_MS);
  }, true);

  document.addEventListener('mouseleave', e => {
    const target = e.target instanceof Element ? e.target : e.target?.parentElement;
    const anchor = target?.closest('[data-tip]');
    if (!anchor) return;
    clearTimeout(_showTimer);
    _hide();
  }, true);

  // Also hide on scroll/resize to avoid stale positions
  window.addEventListener('scroll', _hide, { passive: true });
  window.addEventListener('resize', _hide, { passive: true });
}

/**
 * Set or update the tooltip key (and optional overrides) on a DOM element.
 * Call this from updateRegimeUI(), updateSuggestionUI(), etc. whenever
 * the element's content changes.
 *
 * @param {HTMLElement|null} el
 * @param {string} key          — key into TIPS dictionary
 * @param {object} [overrides]  — { title, body, action } to override specific fields
 */
export function setTip(el, key, overrides = {}) {
  if (!el) return;
  el.dataset.tip = key;
  if (overrides.title  != null) el.dataset.tipTitle  = overrides.title;
  else                           delete el.dataset.tipTitle;
  if (overrides.body   != null) el.dataset.tipBody   = overrides.body;
  else                           delete el.dataset.tipBody;
  if (overrides.action != null) el.dataset.tipAction = overrides.action;
  else                           delete el.dataset.tipAction;
}