/**
 * utils/helpers.js
 * Pure utility functions — no DOM, no state.
 */

// ── Price Formatting ──────────────────────────────────────────────────────────

/** Formats a price to appropriate decimal places */
export const fmt = p => {
  if (!p && p !== 0) return '—';
  if (p > 10000) return p.toFixed(1);
  if (p > 1000)  return p.toFixed(2);
  if (p > 10)    return p.toFixed(3);
  if (p >= 0.01) return p.toFixed(4);
  if (p === 0)   return '0';
  // Micro/nano prices (PEPE, SHIB, BONK, etc.): show 2 significant figures
  const mag = Math.floor(Math.log10(Math.abs(p)));
  const decimals = Math.max(4, -mag + 2);
  return p.toFixed(Math.min(decimals, 12));
};

/** Precision for toFixed based on price magnitude */
export const pricePrecision = v => {
  if (v >= 1000) return 2;
  if (v >= 10)   return 3;
  if (v >= 0.01) return 4;
  if (v === 0)   return 4;
  const mag = Math.floor(Math.log10(Math.abs(v)));
  return Math.min(-mag + 2, 12);
};

/** Format large numbers with K/M/B suffix */
export const fmtK = n => {
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toFixed(0);
};

/** Human-readable symbol display */
export const fmtSym = s => {
  const m = {
    BTCUSDT:'BTC/USDT', TONUSDT:'TON/USDT', ETHUSDT:'ETH/USDT',
    SOLUSDT:'SOL/USDT', XRPUSDT:'XRP/USDT', BNBUSDT:'BNB/USDT'
  };
  return m[s] || s.replace('USDT', '/USDT');
};

// ── Timeframe Maps ────────────────────────────────────────────────────────────

/** Milliseconds per timeframe */
export const TF_MS = {
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h':  3_600_000,
  '4h':  14_400_000,
  '1d':  86_400_000,
};

/** Bybit REST interval → Bybit format */
export const BY_TF = { '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1d':'D' };

/** Bybit WebSocket interval */
export const BY_TF_WS = { '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1d':'D' };

/** OKX REST interval */
export const OKX_TF_REST = { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc' };

/** OKX WebSocket interval */
export const OKX_TF_WS   = { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc' };

/** Canonical sort order for timeframes */
export const TF_ORDER = ['1m','5m','15m','30m','1h','4h','1d'];

// ── Number Helpers ────────────────────────────────────────────────────────────

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const pct = (a, b) => b !== 0 ? ((a - b) / Math.abs(b)) * 100 : 0;

// ── Colour Helpers ────────────────────────────────────────────────────────────

/** Returns CSS colour var string based on direction */
export const dirColor = dir => dir === 'long' ? 'var(--green)' : 'var(--red)';

/** Returns the signal badge CSS colour */
export const signalColor = signal => {
  if (signal === 'bull') return '#00e5a0';
  if (signal === 'bear') return '#ff3d5a';
  return '#ffb82e';
};

// ── Time Helpers ──────────────────────────────────────────────────────────────

export const relativeTime = tsMs => {
  const ago = Math.round((Date.now() - tsMs) / 60_000);
  if (ago < 1)  return 'just now';
  if (ago < 60) return `${ago}m ago`;
  return `${Math.round(ago / 60)}h ago`;
};

// ── Fetch with Timeout ────────────────────────────────────────────────────────

export async function tryFetch(url, timeoutMs = 7_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}
