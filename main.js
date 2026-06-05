/**
 * main.js — Application bootstrap
 */

// ── State & persistence ────────────────────────────────────────────────────────
import { state }                                   from './state/store.js';
import {
  loadSettings,
  loadWatchlist,
  loadCollapsed,
}                                                  from './state/persistence.js';

// ── UI infrastructure ──────────────────────────────────────────────────────────
import * as dom                                    from './ui/dom.js';
import { initTooltips }                            from './ui/tooltip.js';

// ── Render scheduler ───────────────────────────────────────────────────────────
import { initRenderer, RenderPriority }            from './engine/renderer.js';

// ── App modules ────────────────────────────────────────────────────────────────
import { showToast }                               from './app/context.js';
import { initChart }                               from './app/chart-manager.js';
import { computeAndRender, computePartial, renderLive } from './app/render-pipeline.js';
import {
  initSym,
  switchSym,
  switchTF,
  switchExchange,
  loadCoinFromScreener,
  setDirection,
  setRRRatio,
  toggleOverlay,
  toggleTheme,
  toggleCard,
  handleKeyDown,
  anchorToSessionOpen,
  clearAnchor,
  onLeverageInput,
  initIndicatorWorker,
  dispatchToWorker,
}                                                  from './app/symbol-nav.js';
import {
  initScreener,
  runScreener,
  renderScreenerTable,
  scrSetFilter,
  scrSort,
  setScrTF,
  scrSetListMode,
  scrAddCustomCoin,
  scrResetCoins,
  scrFetchTopCoins,
  toggleScrAuto,
  clearScreenerFilter,
}                                                  from './app/screener-panel.js';
import {
  initMTF,
  runMTFScan,
  mtfAddCoin,
  mtfClearCoins,
  mtfLoadFromScreener,
  mtfLoadWatchlist,
  mtfScanCurrent,
  toggleMTFTf,
  mtfSetFilter,
}                                                  from './app/mtf-panel.js';
import {
  replayLoad,
  replayToggle,
  replayStep,
  replayReset,
}                                                  from './app/replay.js';
import {
  addAlert,
  deleteAlert,
  toggleAlertDir,
  renderAlerts,
  wlAdd,
  wlRemove,
  renderWatchlist,
  logTrade,
  clearPnL,
  renderPnL,
  exportPnL,
}                                                  from './app/sidebar-widgets.js';

// ── Components ─────────────────────────────────────────────────────────────────
import {
  initJournal,
  openJournalEntry,
  saveJournalEntry,
  renderJournalList,
  renderJournalStats,
  exportJournal,
  deleteJournalTrade,
  editJournalTrade,
}                                                  from './components/journal.js';
import {
  backtesterHTML,
  btRun,
  btCompare,
  btExport,
  initBacktester,
}                                                  from './components/backtester.js';
import {
  initSearch,
  initScreenerFilter,
}                                                  from './components/search.js';
import { fmt, fmtSym, fmtK }                       from './utils/helpers.js';
import { ctx }                                     from './app/context.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────────

function init() {
  // DOM cache + tooltips
  dom.init();
  initTooltips();

  // Restore settings
  const saved     = loadSettings();
  state.sym       = saved?.sym      || 'BTCUSDT';
  state.tf        = saved?.tf       || '5m';
  state.exchange  = saved?.exchange || 'bybit';
  state.watchlist = loadWatchlist();

  //  Restore leverage UI
  const initLev = +(dom.el['lev-slider']?.value ?? 10);
  state.leverage = initLev;
  if (dom.el['lev-manual'])  dom.el['lev-manual'].value        = initLev;
  if (dom.el['lev-display']) dom.el['lev-display'].textContent = initLev + '×';
  if (dom.el['lev-slider'])  dom.el['lev-slider'].style.setProperty('--lev-pct', ((initLev - 1) / 99 * 100) + '%');

  // Restore collapsed card state
  const collapsed = loadCollapsed();
  Object.entries(collapsed).forEach(([id, isCollapsed]) => {
    const el = document.getElementById(id);
    if (el && isCollapsed) el.classList.add('collapsed');
  });

  // Initialise subsystems
  initJournal();
  initIndicatorWorker();
  initChart('lwc-container', state.isDark ? 'dark' : 'light');

  // Wire render scheduler
  initRenderer({
    onFull:    computeAndRender,
    onPartial: computePartial,
    onLive:    renderLive,
  });

  // Inject backtester HTML
  const btSlot = dom.el['bt-placeholder'];
  if (btSlot) btSlot.outerHTML = backtesterHTML();

  // Lazy-resolve dynamic elements (backtester, search, etc.)
  dom.resolveLazy();

  // 9. Initialise panels
  initBacktester();
  initSearch();
  initScreener();
  initMTF();
  requestAnimationFrame(() => initScreenerFilter());

  document.addEventListener('bt:result', e => {
    ctx.lastBTResult = e.detail;
    import('./engine/renderer.js').then(({ scheduleRender, RenderPriority }) =>
      scheduleRender(RenderPriority.PARTIAL)
    );
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  // Resize
  window.addEventListener('resize', () => {
    import('./app/chart-manager.js').then(({ resizeChart }) => resizeChart());
  });

  // Render sidebar widgets (alerts, watchlist, P&L)
  renderWatchlist();
  renderAlerts();
  renderPnL();

  // Start the app
  initSym(state.sym, state.tf);
}

// ── window.TT namespace ────────────────────────────────────────────────────────

window.TT = {
  // State (read-only from HTML)
  state,
  fmt, fmtSym, fmtK,

  // Navigation
  switchSym, switchTF, switchExchange,
  loadCoinFromScreener,
  toggleCard,

  // Controls
  setDirection, setRRRatio,
  toggleOverlay, toggleTheme,
  anchorToSessionOpen, clearAnchor,
  computeAndRender,

  // Leverage (called from inline script in index.html)
  _onLeverageInput: onLeverageInput,

  // Alerts
  addAlert, deleteAlert, toggleAlertDir,

  // Watchlist
  wlAdd, wlRemove,

  // Session P&L
  logTrade, clearPnL, exportPnL,

  // Screener
  runScreener, renderScreenerTable, clearScreenerFilter,
  scrSetFilter, scrSort, setScrTF,
  scrSetListMode, scrAddCustomCoin, scrResetCoins, scrFetchTopCoins,
  toggleScrAuto,

  // MTF
  runMTFScan, mtfAddCoin, mtfClearCoins,
  mtfLoadFromScreener, mtfLoadWatchlist, mtfScanCurrent,
  toggleMTFTf, mtfSetFilter,

  // Replay
  replayLoad, replayToggle, replayStep, replayReset,

  // Journal
  openJournalEntry, saveJournalEntry, renderJournalList,
  deleteJournalTrade, editJournalTrade, exportJournal,

  // Backtester
  btRun, btCompare, btExport,
};

// Also expose showToast globally — used by inline scripts in index.html
window.showToast = showToast;

// ── Entry point ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}