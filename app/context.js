/**
 * app/context.js
 * Shared runtime context — class instances, DOM-bound objects, and
 * cross-cutting helpers that don't belong in serialisable state.
 *
 * Rule: everything here is set ONCE during init() and then read-only.
 * Mutable trading data (candles, prices, indicators) belongs in state/store.js.
 */

import * as dom from '../ui/dom.js';

// ── Runtime object registry ───────────────────────────────────────────────────

export const ctx = {
  /** @type {import('../charts/lwc.js').LWCChart | null} */
  lwcChart: null,

  /** @type {Worker | null} */
  worker: null,

  /**
   * Last backtest result received via the bt:result custom event.
   * Consumed by render-pipeline → ui-updaters to show inline BT context.
   * @type {{ metrics: object, sym: string, tf: string } | null}
   */
  lastBTResult: null,

  /** @type {AudioContext | null} Lazy-initialised on first beep. */
  audioCtx: null,
};

// ── Toast ─────────────────────────────────────────────────────────────────────

/**
 * Display a toast notification.
 * Identical to the original main.js showToast — centralised here so every
 * module can import it without going through main.js.
 */
export function showToast(msg, cls = '') {
  const t = dom.el['toast'];
  if (!t) return;
  t.textContent = msg;
  t.className   = 'toast show ' + cls;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Connection status ──────────────────────────────────────────────────────────

export function setConnStatus(type, msg) {
  const el = dom.el['conn-status'];
  if (!el) return;
  el.textContent = msg;
  el.className   = 'conn-status ' + type;
}

// ── String utilities ──────────────────────────────────────────────────────────

const SYM_RE = /^[A-Z0-9]{1,20}$/;

/**
 * Sanitise and normalise a raw user-typed symbol string.
 * Returns a valid XXXUSDT string or null.
 */
export function sanitizeSym(raw) {
  const cleaned = String(raw).trim().toUpperCase()
    .replace(/\//g, '')
    .replace(/-USDT-SWAP$/, '')
    .replace(/-USDT$/, '');
  const base = cleaned.endsWith('USDT') ? cleaned : cleaned + 'USDT';
  if (!SYM_RE.test(base)) return null;
  return base;
}

/**
 * Escape a string for safe HTML interpolation.
 * Centralised here — previously duplicated across main.js, journal.js, etc.
 */
export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── Audio ──────────────────────────────────────────────────────────────────────

function _getAudioCtx() {
  if (!ctx.audioCtx || ctx.audioCtx.state === 'closed') {
    ctx.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return ctx.audioCtx;
}

export function playBeep(freq) {
  try {
    const audioCtx = _getAudioCtx();
    const osc      = audioCtx.createOscillator();
    const gain     = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) { /* Autoplay policy — silently ignore */ }
}

export function playCrossSound(type) {
  playBeep(type === 'bull' ? 660 : 440);
}