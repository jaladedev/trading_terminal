/**
 * engine/renderer.js
 * Render scheduler — separates heavy full recompute from lightweight
 * live-tick paints, batches all DOM writes into single RAF cycles,
 * and prevents duplicate renders during rapid WebSocket bursts.
 */

// ── Priority levels ───────────────────────────────────────────────────────────
export const RenderPriority = {
  LIVE:    0,   // live tick — chart update + price display only, no recompute
  PARTIAL: 1,   // confirmed candle — recompute indicators, skip heavy structure
  FULL:    2,   // symbol/TF switch — full recompute including regime + structure
};

// ── Scheduler state ───────────────────────────────────────────────────────────
let _pendingPriority = -1;
let _rafId           = null;
let _lastFullRender  = 0;
let _renderFn        = null;   // set once via init()
let _liveFn          = null;
let _partialFn       = null;

// Minimum ms between FULL renders (regime + structure are expensive)
const FULL_THROTTLE_MS = 2_000;

/**
 * Register the three render functions from main.js.
 * Call once during init().
 */
export function initRenderer({ onFull, onPartial, onLive }) {
  _renderFn  = onFull;
  _partialFn = onPartial;
  _liveFn    = onLive;
}

/**
 * Schedule a render at the given priority.
 * Higher priority wins within a single RAF frame.
 * Multiple calls before the frame fires are collapsed into one.
 */
export function scheduleRender(priority = RenderPriority.FULL) {
  if (priority > _pendingPriority) {
    _pendingPriority = priority;
  }

  if (_rafId !== null) return;   // already queued — the higher priority is recorded above

  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    const p = _pendingPriority;
    _pendingPriority = -1;
    _flush(p);
  });
}

/**
 * Immediately cancel any pending scheduled render.
 * Use when tearing down (symbol switch already triggers its own FULL).
 */
export function cancelPendingRender() {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _pendingPriority = -1;
}

// ── Internal flush ────────────────────────────────────────────────────────────

function _flush(priority) {
  if (priority === RenderPriority.LIVE) {
    _liveFn?.();
    return;
  }

  if (priority === RenderPriority.PARTIAL) {
    _partialFn?.();
    return;
  }

  // FULL — throttle heavy recompute
  const now = Date.now();
  if (now - _lastFullRender < FULL_THROTTLE_MS) {
    // Downgrade to partial so the chart still refreshes
    _partialFn?.();
    return;
  }

  _lastFullRender = now;
  _renderFn?.();
}