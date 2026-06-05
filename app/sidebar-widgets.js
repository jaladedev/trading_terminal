/**
 * app/sidebar-widgets.js
 * Three small sidebar features: price alerts, watchlist, and session P&L.
 *
 * None of these trigger a render cycle or touch the chart — they only
 * read/write their own DOM sections and update state.alerts / state.watchlist
 * / state.pnlTrades.
 */

import { state }                         from '../state/store.js';
import { saveWatchlist }                  from '../state/persistence.js';
import * as dom                           from '../ui/dom.js';
import { fmt, fmtSym }                    from '../utils/helpers.js';
import { showToast, sanitizeSym, escHtml } from './context.js';

// ── Alerts ────────────────────────────────────────────────────────────────────

export function addAlert() {
  const price = +(dom.el['alrt-price']?.value);
  if (!price) return;
  state.alerts.push({
    id: Date.now(),
    sym: state.sym,
    price,
    dir: state.alertDir,
    triggered: false,
  });
  if (dom.el['alrt-price']) dom.el['alrt-price'].value = '';
  renderAlerts();
  if (Notification?.permission === 'default') Notification.requestPermission();
}

export function deleteAlert(id) {
  state.alerts = state.alerts.filter(a => a.id !== id);
  renderAlerts();
}

export function toggleAlertDir() {
  state.alertDir = state.alertDir === 'above' ? 'below' : 'above';
  const btn = dom.el['alrt-dir-btn'];
  if (btn) btn.textContent = state.alertDir === 'above' ? 'Above ▲' : 'Below ▼';
}

/**
 * Check all pending alerts against the latest price.
 * Called on every live tick from symbol-nav.js.
 */
export function checkAlerts(price) {
  let fired = false;
  state.alerts.forEach(a => {
    if (a.triggered || a.sym !== state.sym) return;
    const hit = (a.dir === 'above' && price >= a.price) ||
                (a.dir === 'below' && price <= a.price);
    if (!hit) return;
    a.triggered = true;
    fired       = true;
    const msg   = `🔔 ${a.sym}: ${a.dir === 'above' ? 'Crossed above' : 'Dropped below'} ${fmt(a.price)}`;
    showToast(msg);
    import('./context.js').then(({ playBeep }) => playBeep(880));
    if (Notification?.permission === 'granted') {
      new Notification('TradeAssist', { body: msg });
    }
  });
  if (fired) renderAlerts();
}

export function renderAlerts() {
  const el = dom.el['alert-list'];
  if (!el) return;
  if (!state.alerts.length) {
    el.innerHTML = '<div class="alert-empty">No alerts set</div>';
    return;
  }
  el.innerHTML = state.alerts.map(a => `
    <div class="alert-item${a.triggered ? ' triggered' : ''}">
      <div class="alert-item-info">
        <span class="alert-sym">${escHtml(fmtSym(a.sym))}</span>
        <span class="alert-cond">${a.dir === 'above' ? 'Above' : 'Below'}</span>
        <span class="alert-price-val">${fmt(a.price)}</span>
        ${a.triggered ? '<span class="alert-status">✓ TRIGGERED</span>' : ''}
      </div>
      <button class="alert-del" onclick="TT.deleteAlert(${a.id})">×</button>
    </div>`).join('');
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export function wlAdd() {
  const raw = dom.el['wl-inp']?.value || '';
  const sym = sanitizeSym(raw);
  if (!sym) { showToast('Invalid symbol — use letters and numbers only'); return; }
  if (!state.watchlist.includes(sym)) {
    state.watchlist.push(sym);
    saveWatchlist(state.watchlist);
    renderWatchlist();
  }
  if (dom.el['wl-inp']) dom.el['wl-inp'].value = '';
}

export function wlRemove(s) {
  state.watchlist = state.watchlist.filter(x => x !== s);
  saveWatchlist(state.watchlist);
  renderWatchlist();
}

export function renderWatchlist() {
  const el = dom.el['wl-list'];
  if (!el) return;
  if (!state.watchlist.length) {
    el.innerHTML = '<span class="wl-empty">No coins added</span>';
    return;
  }
  el.innerHTML = state.watchlist.map(s => `
    <div class="wl-chip" onclick="TT.loadCoinFromScreener('${escHtml(s)}')">
      <span>${escHtml(fmtSym(s))}</span>
      <button class="wl-chip-del" onclick="event.stopPropagation();TT.wlRemove('${escHtml(s)}')">×</button>
    </div>`).join('');
}

// ── Session P&L ───────────────────────────────────────────────────────────────

export function logTrade(result) {
  state.tradeCount++;
  const profitEl = dom.el['fv-profit'];
  const lossEl   = dom.el['fv-loss'];
  const profit   = result === 'win'
    ? +(profitEl?.textContent?.replace(/[$,]/g, '')) || 0
    : -(+(lossEl?.textContent?.replace(/[$,]/g, '')) || 0);

  state.pnlTrades.push({
    n:      state.tradeCount,
    time:   new Date().toLocaleTimeString(),
    sym:    state.sym,
    dir:    state.currentDir === 'long' ? '▲ L' : '▼ S',
    result,
    pnl:    profit,
  });
  renderPnL();
  showToast(
    result === 'win'
      ? `✓ Win: +$${Math.abs(profit).toFixed(2)}`
      : `✗ Loss: -$${Math.abs(profit).toFixed(2)}`
  );
}

export function clearPnL() {
  state.pnlTrades = [];
  state.tradeCount = 0;
  renderPnL();
}

export function renderPnL() {
  const wins   = state.pnlTrades.filter(t => t.result === 'win').length;
  const losses = state.pnlTrades.filter(t => t.result === 'loss').length;
  const net    = state.pnlTrades.reduce((a, t) => a + t.pnl, 0);
  const wr     = state.pnlTrades.length
    ? Math.round(wins / state.pnlTrades.length * 100)
    : 0;

  const netTxt = (net >= 0 ? '+' : '') + '$' + net.toFixed(2);
  dom.setText(dom.el['pnl-net'],    netTxt);
  dom.setText(dom.el['pnl-wins'],   wins);
  dom.setText(dom.el['pnl-losses'], losses);
  dom.setText(dom.el['pnl-wr'],     state.pnlTrades.length ? wr + '%' : '—');
  dom.setStyle(dom.el['pnl-net'], 'color', net >= 0 ? 'var(--green)' : 'var(--red)');

  const tbody = dom.el['pnl-tbody'];
  if (!tbody) return;
  if (!state.pnlTrades.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:12px;font-family:var(--mono);font-size:10px">No trades logged</td></tr>';
    return;
  }
  tbody.innerHTML = [...state.pnlTrades].reverse().map(t => `<tr>
    <td style="color:var(--text3)">${t.n}</td>
    <td style="color:var(--text3)">${t.time}</td>
    <td style="font-weight:700">${escHtml(t.sym.replace('USDT', ''))}</td>
    <td>${t.dir}</td>
    <td class="${t.result === 'win' ? 'pnl-win' : 'pnl-loss'}">${t.result === 'win' ? 'WIN' : 'LOSS'}</td>
    <td class="${t.pnl >= 0 ? 'pnl-win' : 'pnl-loss'}">${(t.pnl >= 0 ? '+' : '') + '$' + Math.abs(t.pnl).toFixed(2)}</td>
  </tr>`).join('');
}

export function exportPnL() {
  if (!state.pnlTrades.length) { showToast('No trades to export'); return; }
  const rows = ['#,Time,Symbol,Direction,Result,P&L'];
  state.pnlTrades.forEach(t =>
    rows.push(`${t.n},${t.time},${t.sym},${t.dir},${t.result},${t.pnl.toFixed(2)}`)
  );
  const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
  const a   = Object.assign(document.createElement('a'), {
    href:     url,
    download: 'session_pnl_' + new Date().toISOString().slice(0, 10) + '.csv',
  });
  a.click();
  URL.revokeObjectURL(url);
}
