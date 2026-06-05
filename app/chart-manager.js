/**
 * app/chart-manager.js
 * Owns the LWCChart instance and the two draw entry points.
 *
 * Rule: only this module calls ctx.lwcChart methods. Everything else
 * that needs to trigger a chart update goes through drawAll() or drawLive().
 */

import { state }                         from '../state/store.js';
import { ctx }                           from './context.js';
import { LWCChart }                      from '../charts/lwc.js';
import {
  getLatestVwap,
  getLatestCvd,
  computeLiveAvwap,
  computeLiveVwapBands,
} from './candle-state.js';
import { computeLiveBands }              from '../indicators/engine.js';

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Create and store the LWCChart instance.
 * Called once from main.js init().
 */
export function initChart(containerId, theme) {
  ctx.lwcChart = new LWCChart(containerId, { theme });
}

// ── Full redraw ────────────────────────────────────────────────────────────────

/**
 * Pushes the full candle + indicator dataset to LWC.
 * Called by render-pipeline after a complete compute cycle.
 */
export function drawAll() {
  if (!ctx.lwcChart) return;

  ctx.lwcChart.setData(state.candles, {
    e9s:        state.e9s,
    e20s:       state.e20s,
    e50s:       state.e50s,
    vwapVals:   state.vwapVals,
    avwapVals:  state.avwapVals,
    rsiVals:    state.rsiVals,
    cvdVals:    state.cvdVals,
    cvdEmaVals: state.cvdEmaVals,
  });

  if (state.suggestion?.entry) {
    ctx.lwcChart.setSuggestion(state.suggestion);
  }
  if (state.sessionLevels) {
    ctx.lwcChart.setSessionLevels(state.sessionLevels);
  }

  ctx.lwcChart.setStructureEvents(state.candles, state.structureEvents || []);
}

// ── Live tick update ───────────────────────────────────────────────────────────

/**
 * Sends a single live (unconfirmed) candle update to LWC.
 * Called by render-pipeline on every trade tick — must be fast.
 */
export function drawLive() {
  if (!ctx.lwcChart || !state.currentCandle) return;

  const c = { ...state.currentCandle };

  c._liveVwap  = getLatestVwap();
  c._liveBands = computeLiveVwapBands();
  c._liveRsi   = state.rsiVals[state.rsiVals.length - 1];
  c._liveCvd   = getLatestCvd();

  if (state.anchorIdx !== null && state.avwapCumV > 0) {
    c._liveAvwap = computeLiveAvwap();
  }

  ctx.lwcChart.updateLiveCandle(c);
}

// ── Theme ──────────────────────────────────────────────────────────────────────

export function applyChartTheme(theme) {
  ctx.lwcChart?.setTheme(theme);
}

// ── Resize ─────────────────────────────────────────────────────────────────────

export function resizeChart() {
  ctx.lwcChart?._resize();
}
