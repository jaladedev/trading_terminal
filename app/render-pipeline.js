/**
 * app/render-pipeline.js
 * The three render entry points registered with engine/renderer.js.
 *
 * This module is the orchestrator — it coordinates signal computation
 * and hands results to ui-updaters and chart-manager. It owns no state
 * and writes no DOM directly.
 */

import { state }                                from '../state/store.js';
import * as dom                                 from '../ui/dom.js';
import { ctx }                                  from './context.js';
import { calcATR }                              from '../indicators/engine.js';
import { detectRegime }                         from '../indicators/regime.js';
import {
  detectSwingPoints,
  detectStructureBreaks,
  detectLiquiditySweeps,
  detectEqualLevels,
  detectDisplacementCandles,
  getSessionContext,
  getSessionLevels,
}                                               from '../indicators/structure.js';
import {
  computeSuggestion,
  scoreEntryQuality,
  computeEntryZones,
  computePartialTPs,
  calcAtrPositionSize,
  detectSqueezeBreakout,
}                                               from '../engine/signals.js';
import {
  calcFuturesMetrics,
  calcATRTrailStop,
}                                               from '../engine/risk.js';
import {
  getLatestVwap,
  getLatestCvd,
  getLatestAvwap,
  offsetIndexed,
}                                               from './candle-state.js';
import {
  updatePriceDisplay,
  updateRegimeUI,
  updateStructureUI,
  updateSessionUI,
  updateSqueezeUI,
  updateSuggestionUI,
  updateFuturesUI,
  updateLegendLabels,
  updateEntryZonesUI,
  updateVPLabels,
  writeAvwapLabel,
}                                               from './ui-updaters.js';
import { drawAll, drawLive }                    from './chart-manager.js';

// ── Full render — triggered on symbol/TF switch or confirmed candle ────────────

export function computeAndRender() {
  const all    = [...state.candles, state.currentCandle].filter(Boolean);
  const atr    = calcATR(all, 14);
  const atrPct = state.livePrice > 0 ? (atr / state.livePrice) * 100 : 0;

  // Regime (expensive — only in full render)
  state.regime = detectRegime(all, state.e20s, state.livePrice);

  // Structure (windowed to last 60 bars for performance)
  if (all.length >= 10) {
    const structureWindow = all.slice(-60);
    const structureOffset = all.length - structureWindow.length;
    const localSwings     = detectSwingPoints(structureWindow, 3, 3);

    state.swingPoints     = offsetIndexed(localSwings, structureOffset);
    state.structureEvents = offsetIndexed(detectStructureBreaks(structureWindow, localSwings), structureOffset);
    state.liquiditySweeps = offsetIndexed(detectLiquiditySweeps(structureWindow, localSwings), structureOffset);
    state.equalLevels     = detectEqualLevels(state.swingPoints);
    state.displacements   = detectDisplacementCandles(all, { lookback: 20 });
    state.squeezeState    = detectSqueezeBreakout(all);
  }

  state.sessionCtx    = getSessionContext(all);
  state.sessionLevels = getSessionLevels(all);

  dom.batch(() => {
    _computeSignalsAndUI(all, atr, atrPct);
    updateRegimeUI(state.regime);
    updateStructureUI(state.swingPoints, state.structureEvents);
    updateSessionUI(state.sessionCtx);
    updateSqueezeUI(state.squeezeState);
  });

  drawAll();
}

// ── Partial render — confirmed candle, skip heavy structure ───────────────────

export function computePartial() {
  const all    = [...state.candles, state.currentCandle].filter(Boolean);
  const atr    = calcATR(all, 14);
  const atrPct = state.livePrice > 0 ? (atr / state.livePrice) * 100 : 0;
  dom.batch(() => _computeSignalsAndUI(all, atr, atrPct));
  drawAll();
}

// ── Live render — price tick only, no recompute ────────────────────────────────

export function renderLive() {
  updatePriceDisplay();
  drawLive();
}

// ── Signal + UI computation (shared by full and partial) ──────────────────────

function _computeSignalsAndUI(all, atr, atrPct) {
  const latestRSI   = state.rsiVals[state.rsiVals.length - 1];
  const latestVwap  = getLatestVwap();
  const latestAvwap = getLatestAvwap();

  const capital  = +(dom.el['inp-capital']?.value) || 100;
  const margin   = +(dom.el['inp-margin']?.value)  || 20;
  const entryRaw = dom.el['inp-entry']?.value;
  const stopRaw  = dom.el['inp-stop']?.value;
  const leverage = state.leverage || 10;

  // Suggestion
  const sug = computeSuggestion({
    e9: state.e9, e20: state.e20, e50: state.e50,
    livePrice: state.livePrice,
    rsi: latestRSI,
    rrRatio: state.rrRatio,
    tf: state.tf,
    candles: all,
    vwap: latestVwap,
    avwap: latestAvwap,
    regime: state.regime,
  });
  if (sug) state.suggestion = sug;

  // Entry quality score
  const cvdLast = getLatestCvd();
  const quality = scoreEntryQuality({
    dir:             state.currentDir,
    rsi:             latestRSI,
    e9:              state.e9,
    e20:             state.e20,
    e50:             state.e50,
    price:           state.livePrice,
    vwap:            latestVwap,
    avwap:           latestAvwap,
    cvd:             cvdLast,
    crossovers:      state.crossovers,
    tf:              state.tf,
    candles:         all,
    regime:          state.regime,
    atrPct,
    displacements:   state.displacements   || [],
    liquiditySweeps: state.liquiditySweeps || [],
    sessionCtx:      state.sessionCtx      || null,
    higherTFConflict: state.currentSymHTFConflict || false,
  });

  // Entry zones
  const zones = computeEntryZones({
    e9: state.e9, e20: state.e20,
    livePrice: state.livePrice,
    suggestion: sug,
    atr,
  });
  if (zones) state.entryZones = zones;

  // Partials / trailing / ATR size
  const tps       = computePartialTPs({ entry: sug?.entry, stop: sug?.stop, dir: sug?.dir });
  const trailStop = calcATRTrailStop(state.livePrice, atr, state.currentDir, 2);
  const atrSize   = atr
    ? calcAtrPositionSize({ capital, riskPct: 1, entry: state.livePrice, atr, atrMultiple: 2 })
    : null;

  // Futures metrics
  const entry = (entryRaw !== '' && +entryRaw) ? +entryRaw : (sug?.entry || state.livePrice);
  const stop  = (stopRaw  !== '' && +stopRaw)  ? +stopRaw  : (sug?.stop  || 0);

  const futMetrics = calcFuturesMetrics({
    capital, margin, leverage, entry, stop,
    dir:     state.currentDir,
    rrRatio: state.rrRatio,
    feeType: state.feeType,
  });

  // Pass computed results to DOM writers
  updateSuggestionUI(sug, quality, tps, trailStop, atrSize, ctx.lastBTResult);
  updateFuturesUI(futMetrics, leverage, entry);
  updateEntryZonesUI(zones);
  updateLegendLabels(latestVwap, cvdLast);
  writeAvwapLabel();
}