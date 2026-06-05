/**
 * app/replay.js
 * Historical replay engine: load, play/pause, step, reset.
 *
 * Depends on candle-state and render-pipeline at runtime — imported lazily
 * to avoid circular dependency issues (both of those import from context.js
 * which this file also uses).
 */

import { state, resetCandleState }   from '../state/store.js';
import * as dom                       from '../ui/dom.js';
import { fmtSym }                     from '../utils/helpers.js';
import { showToast, setConnStatus }   from './context.js';
import { fetchKlinesFallback }         from '../services/exchange.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const REPLAY_MIN_INTERVAL  = 50;   // ms floor (matches original)
const REPLAY_BASE_INTERVAL = 400;  // ms at speed=1; divided by speed value

// ── Module-scope state ────────────────────────────────────────────────────────

let _replayTimer = null;

// ── Helpers (imported lazily to break potential circular deps) ─────────────────

async function _getAddCandleToState() {
  const m = await import('./candle-state.js');
  return m.addCandleToState;
}

async function _getComputeAndRender() {
  const m = await import('./render-pipeline.js');
  return m.computeAndRender;
}

async function _getDispatchToWorker() {
  const m = await import('./symbol-nav.js');
  return m.dispatchToWorker;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function replayLoad() {
  const btn = dom.el['replay-load-btn'];
  if (btn) { btn.textContent = '⏳ Loading…'; btn.disabled = true; }

  const res = await fetchKlinesFallback(state.sym, state.tf);
  if (!res?.candles?.length) {
    showToast('Failed to load replay data');
    if (btn) { btn.textContent = '⬇ Load'; btn.disabled = false; }
    return;
  }

  state.replayData   = res.candles;
  state.replayIdx    = 0;
  state.replayActive = false;

  clearTimeout(_replayTimer);
  _replayTimer = null;

  // Close live streams — import symbol-nav lazily
  import('./symbol-nav.js').then(({ closeStreams }) => closeStreams());

  // Reset candle state without re-fetching
  resetCandleState();

  // Ensure AVWAP state is clean
  const { ensureAvwapState } = await import('./candle-state.js');
  ensureAvwapState();

  setConnStatus('warn', `Replay · ${res.candles.length} candles · ${fmtSym(state.sym)}`);

  const playBtn = dom.el['replay-play-btn'];
  if (playBtn) { playBtn.disabled = false; playBtn.textContent = '▶ Play'; }
  dom.setText(dom.el['replay-progress-lbl'], `0 / ${res.candles.length}`);
  if (btn) { btn.textContent = '✓ Loaded'; btn.disabled = false; }

  showToast(`Replay ready: ${res.candles.length} candles`);

  // Draw empty state
  const { drawAll } = await import('./chart-manager.js');
  drawAll();
}

export function replayToggle() {
  if (!state.replayData.length) { showToast('Load history first'); return; }
  clearTimeout(_replayTimer);
  _replayTimer = null;

  state.replayActive = !state.replayActive;

  const btn = dom.el['replay-play-btn'];
  if (btn) {
    btn.textContent = state.replayActive ? '⏸ Pause' : '▶ Play';
    btn.classList.toggle('active', state.replayActive);
  }

  if (state.replayActive) _replayTick();
}

export async function replayStep() {
  if (state.replayIdx >= state.replayData.length) return;
  const c = state.replayData[state.replayIdx++];

  const addCandleToState = await _getAddCandleToState();
  addCandleToState(c);
  state.livePrice = c.c;

  // Update price display
  const { updatePriceDisplay } = await import('./ui-updaters.js');
  updatePriceDisplay();

  const computeAndRender = await _getComputeAndRender();
  computeAndRender();

  dom.setText(dom.el['replay-progress-lbl'], `${state.replayIdx} / ${state.replayData.length}`);

  if (state.replayIdx % 10 === 0) {
    const dispatchToWorker = await _getDispatchToWorker();
    dispatchToWorker([...state.candles]);
  }
}

export async function replayReset() {
  state.replayActive = false;
  clearTimeout(_replayTimer);
  _replayTimer = null;
  state.replayIdx = 0;

  resetCandleState();

  const { ensureAvwapState } = await import('./candle-state.js');
  ensureAvwapState();

  const btn = dom.el['replay-play-btn'];
  if (btn) { btn.textContent = '▶ Play'; btn.classList.remove('active'); }
  dom.setText(dom.el['replay-progress-lbl'], `0 / ${state.replayData.length}`);

  const { drawAll } = await import('./chart-manager.js');
  drawAll();
  showToast('Replay reset');
}

// ── Private tick loop ──────────────────────────────────────────────────────────

async function _replayTick() {
  if (!state.replayActive || state.replayIdx >= state.replayData.length) {
    state.replayActive = false;
    const btn = dom.el['replay-play-btn'];
    if (btn) { btn.textContent = '▶ Done'; btn.classList.remove('active'); }
    return;
  }

  await replayStep();

  const speed = +(dom.el['replay-speed']?.value) || 2;
  clearTimeout(_replayTimer);
  _replayTimer = setTimeout(
    _replayTick,
    Math.max(REPLAY_MIN_INTERVAL, REPLAY_BASE_INTERVAL / speed)
  );
}
