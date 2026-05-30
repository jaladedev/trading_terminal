/**
 * ui/dom.js
 * Centralized DOM reference cache.
 *
 * All getElementById / querySelector calls live here.
 * Call dom.init() once after DOMContentLoaded.
 * Everything else reads from the pre-resolved object — zero querySelector
 * in hot paths.
 *
 * Layout:
 *   dom.init()          — resolve and cache all refs
 *   dom.el              — flat map of id → element (nullable)
 *   dom.batch(fn)       — queue writes, flush in one rAF (prevents reflow churn)
 *   dom.setText(el, v)  — null-safe textContent set
 *   dom.setStyle(el, p, v) — null-safe style property set
 */

// ── Element cache ─────────────────────────────────────────────────────────────

export const el = {};

// All IDs that exist in index.html at boot time.
// Dynamically-injected cards (backtester) are resolved lazily via dom.lazy().
const STATIC_IDS = [
  // Topbar
  'conn-status', 'live-price', 'live-change', 'toast',

  // Symbol / TF / Exchange pill groups
  'sym-group', 'tf-group', 'exch-group',

  // Regime card
  'regime-display', 'regime-advice', 'regime-adx', 'regime-er',

  // Structure card
  'structure-events',

  // Indicator / EMA legend
  'leg-e9', 'leg-e20', 'leg-e50', 'leg-vwap', 'leg-vwap2', 'leg-cvd',
  'avwap-val',

  // Volume profile labels
  'vp-poc-val', 'vp-vah-val', 'vp-val-val',

  // Delta ticker
  'delta-buy', 'delta-sell', 'delta-net', 'delta-ratio-bar',

  // Chart / LWC
  'lwc-container',

  // Trade setup / suggestion
  'sug-dir', 'sug-entry', 'sug-stop', 'sug-target', 'sug-reason',
  'entry-quality-label', 'entry-quality-score', 'entry-quality-factors',
  'tp1-price', 'tp1-pct', 'tp2-price', 'tp2-pct', 'tp3-price', 'tp3-pct',
  'atr-trail-val',
  'atr-size-tokens', 'atr-size-value', 'atr-size-risk', 'atr-stop-dist',

  // Entry zones
  'zone-agg', 'zone-bal', 'zone-con',

  // Futures calculator inputs
  'inp-capital', 'inp-margin', 'inp-entry', 'inp-stop', 'inp-rr',
  'lev-slider', 'lev-manual', 'lev-display',

  // Futures calculator outputs
  'fv-pos-size', 'fv-liq-price', 'fv-liq-dist',
  'fv-profit', 'fv-loss', 'fv-roi-win', 'fv-roi-loss', 'fv-be-price',
  'fee-open', 'fee-close', 'fee-tot',
  'liq-bar', 'risk-warn',

  // Session P&L
  'pnl-net', 'pnl-wins', 'pnl-losses', 'pnl-wr', 'pnl-tbody',

  // Alerts
  'alrt-price', 'alrt-dir-btn', 'alert-list',

  // Watchlist
  'wl-list', 'wl-inp',

  // Screener
  'scr-run-btn', 'scr-auto-btn', 'scr-tbody',
  'scr-progress', 'scr-progress-bar', 'scr-progress-lbl',

  // Replay
  'replay-load-btn', 'replay-play-btn', 'replay-progress-lbl', 'replay-speed',

  // Journal
  'jrn-form', 'jrn-sym', 'jrn-dir', 'jrn-tf',
  'jrn-entry', 'jrn-stop', 'jrn-target', 'jrn-exit',
  'jrn-notes', 'jrn-setup', 'jrn-emotion',
  'jrn-regime', 'jrn-score',
  'jrn-list', 'jrn-stats',

  // Backtester placeholder (outer shell only — inner elements lazy)
  'bt-placeholder',
];

// IDs injected after boot (backtester card, search component, etc.)
const LAZY_IDS = [
  'bt-run-btn', 'bt-strategy', 'bt-sym', 'bt-tf',
  'bt-capital', 'bt-risk', 'bt-rr', 'bt-atr', 'bt-lev',
  'bt-trail', 'bt-partials', 'bt-walkfwd',
  'bt-results', 'bt-metrics-grid', 'bt-trade-tbody',
  'bt-equity-canvas', 'bt-dd-canvas',
  'bt-wf-section', 'bt-wf-table',
  'bt-progress-wrap', 'bt-progress-bar', 'bt-progress-lbl',
  'bt-strat-desc',
  'gs-input', 'scr-text-filter',
];

let _initialised = false;

/**
 * Resolve all static IDs once at boot.
 * Must be called after DOMContentLoaded (from main.js init()).
 */
export function init() {
  for (const id of STATIC_IDS) {
    el[id] = document.getElementById(id);
  }
  _initialised = true;
}

/**
 * Resolve lazy IDs (injected after init, e.g. backtester card).
 * Safe to call multiple times — skips already-resolved refs.
 */
export function resolveLazy() {
  for (const id of LAZY_IDS) {
    if (!el[id]) el[id] = document.getElementById(id);
  }
}

/**
 * Resolve a single ID on demand and cache it.
 * Use when a one-off element doesn't justify a slot in the arrays above.
 */
export function lazy(id) {
  if (!el[id]) el[id] = document.getElementById(id);
  return el[id];
}

// ── Null-safe write helpers ───────────────────────────────────────────────────

/** Set textContent safely. Skips the write if value hasn't changed. */
export function setText(element, value) {
  if (!element) return;
  const s = value == null ? '—' : String(value);
  if (element.textContent !== s) element.textContent = s;
}

/** Set a style property safely. */
export function setStyle(element, property, value) {
  if (!element) return;
  if (element.style[property] !== value) element.style[property] = value;
}

/** Toggle a CSS class safely. */
export function toggleClass(element, cls, force) {
  if (!element) return;
  element.classList.toggle(cls, force);
}

/** Set display safely. */
export function show(element, visible = true) {
  if (!element) return;
  const v = visible ? '' : 'none';
  if (element.style.display !== v) element.style.display = v;
}

// ── Batched write scheduler ───────────────────────────────────────────────────

let _batchQueue = null;
let _batchRaf   = null;

/**
 * Schedule a grouped DOM write. The callback runs in the next rAF frame.
 * Multiple batch() calls before the frame fires are all executed together.
 */
export function batch(fn) {
  if (!_batchQueue) _batchQueue = [];
  _batchQueue.push(fn);
  if (_batchRaf === null) {
    _batchRaf = requestAnimationFrame(_flushBatch);
  }
}

function _flushBatch() {
  _batchRaf = null;
  const queue = _batchQueue;
  _batchQueue = null;
  for (const fn of queue) {
    try { fn(); } catch(e) { console.error('[dom.batch]', e); }
  }
}

/**
 * Flush pending batch writes synchronously (use when you need immediate DOM
 * state, e.g. before reading back a layout value).
 */
export function flushBatch() {
  if (!_batchQueue) return;
  if (_batchRaf !== null) { cancelAnimationFrame(_batchRaf); _batchRaf = null; }
  _flushBatch();
}

// ── CSS animation restart without reflow ──────────────────────────────────────

const _flashTimers = new Map();

/**
 * Flash a price element green or red without triggering a layout reflow.
 * Uses a CSS animation restart via animationName swap instead of offsetWidth.
 */
export function flashPrice(element, direction) {
  if (!element) return;

  // Cancel any pending reset
  const prev = _flashTimers.get(element);
  if (prev) clearTimeout(prev);

  // Remove both classes, swap animationName to force restart (no reflow)
  element.classList.remove('flash-green', 'flash-red');
  element.style.animationName = 'none';

  // Micro-task lets the style mutation settle without forcing layout
  Promise.resolve().then(() => {
    element.style.animationName = '';
    element.classList.add(direction === 'up' ? 'flash-green' : 'flash-red');
  });

  // Clean up after animation completes (~300ms)
  const timer = setTimeout(() => {
    element.classList.remove('flash-green', 'flash-red');
    _flashTimers.delete(element);
  }, 350);
  _flashTimers.set(element, timer);
}