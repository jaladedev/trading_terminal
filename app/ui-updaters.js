/**
 * app/ui-updaters.js
 * Pure DOM write layer — every function takes computed data and writes it
 * to DOM elements. No computation, no render scheduling, no chart calls.
 *
 * Rule: if you need to derive a value, do it in render-pipeline.js first,
 * then pass the result here.
 */

import { state }                  from '../state/store.js';
import * as dom                   from '../ui/dom.js';
import { fmt, fmtK }              from '../utils/helpers.js';
import { setTip }                 from '../ui/tooltip.js';
import { ctx }                    from './context.js';
import { getLatestAvwap }         from './candle-state.js';

// ── Price display ──────────────────────────────────────────────────────────────

export function updatePriceDisplay() {
  const priceEl  = dom.el['live-price'];
  const changeEl = dom.el['live-change'];
  if (!priceEl) return;

  const formatted = fmt(state.livePrice);
  const prev      = state.prevLivePrice;

  if (priceEl.textContent !== formatted) {
    priceEl.textContent = formatted;
    if (prev) dom.flashPrice(priceEl, state.livePrice >= prev ? 'up' : 'down');
  }
  state.prevLivePrice = state.livePrice;

  if (changeEl && state.openPrice > 0) {
    const chg = (state.livePrice - state.openPrice) / state.openPrice * 100;
    const txt = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    if (changeEl.textContent !== txt) {
      changeEl.textContent = txt;
      changeEl.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
    }
  }
}

// ── Regime card ────────────────────────────────────────────────────────────────

export function updateRegimeUI(regime) {
  const el = dom.el['regime-display'];
  if (!el || !regime) return;

  const tipKey = `regime.${regime.type}.${regime.dir ?? ''}`.replace(/\.$/, '');
  setTip(el, tipKey);

  const typeMap = {
    trending: regime.dir === 'bull' ? 'regime-trending-bull' : 'regime-trending-bear',
    ranging:  'regime-ranging',
    choppy:   'regime-choppy',
  };
  const cls = 'regime-badge ' + (typeMap[regime.type] || '');
  if (el.className   !== cls)          el.className   = cls;
  if (el.textContent !== regime.label) el.textContent = regime.label;

  dom.setText(dom.el['regime-advice'], regime.advice || '');
  dom.setText(dom.el['regime-adx'],    regime.adx?.toFixed(1) ?? '—');
  dom.setText(dom.el['regime-er'],     regime.er?.toFixed(2)  ?? '—');
  setTip(dom.el['regime-adx'], 'regime.adx');
  setTip(dom.el['regime-er'],  'regime.er');
}

// ── Structure card ─────────────────────────────────────────────────────────────

export function updateStructureUI(swings, events) {
  const el = dom.el['structure-events'];
  if (!el) return;

  const recent = (events || []).slice(-5).reverse();
  const html   = recent.length
    ? recent.map(ev => {
        const tipKey = `struct.${ev.type.toLowerCase()}.${ev.dir}`;
        const cls    = `struct-${ev.type.toLowerCase()}-${ev.dir}`;
        return `<span class="signal-badge ${cls}" data-tip="${tipKey}" style="font-size:8px;padding:1px 7px">${ev.type} ${ev.dir === 'bull' ? '↑' : '↓'}</span>`;
      }).join('')
    : '<span style="color:var(--text3);font-size:9px;font-family:var(--mono)">No recent structure breaks</span>';

  if (el.innerHTML !== html) el.innerHTML = html;

  // Liquidity sweeps
  const sweepEl = dom.lazy('liquidity-sweeps');
  if (sweepEl) {
    const sweeps = (state.liquiditySweeps || []).slice(0, 4);
    if (sweeps.length) {
      sweepEl.style.display = '';
      sweepEl.innerHTML = sweeps.map(s => {
        const tipKey = s.swingType === 'low' ? 'sweep.low' : 'sweep.high';
        const col    = s.swingType === 'low' ? 'var(--green)' : 'var(--red)';
        const arrow  = s.swingType === 'low' ? '↓' : '↑';
        const fire   = s.sweepPct >= 0.5 ? ' 🔥' : '';
        const age    = s.recencyBars != null ? ` ${s.recencyBars}b` : '';
        return `<span class="signal-badge" data-tip="${tipKey}" style="font-size:8px;padding:1px 7px;color:${col};border-color:${col}40">
          ${arrow}Sweep${fire}${age}
        </span>`;
      }).join('');
    } else {
      sweepEl.innerHTML = '<span style="color:var(--text3);font-size:9px;font-family:var(--mono)">None detected</span>';
    }
  }

  // Equal levels
  const eqEl = dom.lazy('equal-levels');
  if (eqEl) {
    const equals = (state.equalLevels || []).filter(l => l.count >= 2).slice(0, 4);
    if (equals.length) {
      eqEl.style.display = '';
      eqEl.innerHTML = equals.map(l => {
        const tipKey = l.type === 'high' ? 'equal.highs' : 'equal.lows';
        const col    = l.type === 'high' ? 'rgba(255,61,90,0.9)' : 'rgba(0,229,160,0.9)';
        return `<span data-tip="${tipKey}" style="font-family:var(--mono);font-size:8px;color:${col};
          background:var(--bg3);border-radius:4px;padding:2px 6px;margin:1px">
          ${l.label} <span style="color:var(--text3)">${fmt(l.price)}</span>
        </span>`;
      }).join('');
    } else {
      eqEl.innerHTML = '<span style="color:var(--text3);font-size:9px;font-family:var(--mono)">None detected</span>';
    }
  }
}

// ── Session widget ─────────────────────────────────────────────────────────────

export function updateSessionUI(sessionCtx) {
  const el = dom.lazy('session-context');
  if (!el || !sessionCtx) return;

  dom.setText(el, sessionCtx.sessionLabel);
  dom.setStyle(el, 'color', sessionCtx.sessionColor);

  const labelLower = (sessionCtx.sessionLabel || '').toLowerCase();
  const tipKey = labelLower.includes('london') && labelLower.includes('ny') ? 'session.overlap'
               : labelLower.includes('london')                              ? 'session.london'
               : labelLower.includes('new york') || labelLower.includes('ny') ? 'session.ny'
               : labelLower.includes('asia')                                ? 'session.asia'
               : 'session.dead';
  setTip(el, tipKey);

  const alertEl = dom.lazy('session-open-alert');
  if (alertEl) {
    if (sessionCtx.openAlert && sessionCtx.openAlert.minsAway <= 30) {
      alertEl.style.display = '';
      alertEl.textContent   = `⏰ ${sessionCtx.openAlert.session} open in ${sessionCtx.openAlert.minsAway}m`;
      alertEl.style.color   = sessionCtx.openAlert.color;
    } else {
      alertEl.style.display = 'none';
    }
  }
}

// ── Squeeze indicator ──────────────────────────────────────────────────────────

export function updateSqueezeUI(sq) {
  const el = dom.lazy('squeeze-indicator');
  if (!el) return;
  if (sq?.inSqueeze) {
    el.style.display = '';
    dom.setText(el, sq.label);
    dom.setStyle(el, 'color',
      sq.breakoutDir === 'bull' ? 'var(--green)' :
      sq.breakoutDir === 'bear' ? 'var(--red)'   : 'var(--amber)'
    );
    setTip(el,
      sq.breakoutDir === 'bull' ? 'squeeze.bull' :
      sq.breakoutDir === 'bear' ? 'squeeze.bear' : 'squeeze.active'
    );
  } else {
    el.style.display = 'none';
  }
}

// ── Trade setup / suggestion card ──────────────────────────────────────────────

export function updateSuggestionUI(sug, quality, tps, trailStop, atrSize, btResult) {
  if (!sug) return;

  const scoreKey = quality?.score >= 75 ? 'quality.prime'
                 : quality?.score >= 50 ? 'quality.good'
                 : quality?.score >= 25 ? 'quality.weak'
                 :                        'quality.skip';
  setTip(dom.el['entry-quality-label'], scoreKey);

  dom.setText(dom.el['sug-entry'],  fmt(sug.entry));
  dom.setText(dom.el['sug-stop'],   fmt(sug.stop));
  dom.setText(dom.el['sug-target'], fmt(sug.target));
  dom.setText(dom.el['sug-reason'], sug.reason || '');

  const dirTxt   = sug.dir === 'long' ? '▲ LONG' : '▼ SHORT';
  const dirColor = sug.dir === 'long' ? 'var(--green)' : 'var(--red)';
  dom.setText(dom.el['sug-dir'], dirTxt);
  dom.setStyle(dom.el['sug-dir'], 'color', dirColor);

  if (quality) {
    dom.setText(dom.el['entry-quality-score'], quality.score);
    dom.setText(dom.el['entry-quality-label'], quality.label);
    const labelColor = quality.score >= 75 ? 'var(--green)' : quality.score >= 50 ? 'var(--amber)' : 'var(--red)';
    dom.setStyle(dom.el['entry-quality-label'], 'color', labelColor);
    dom.setText(dom.el['entry-quality-factors'], quality.factors.slice(0, 3).join(' · '));
  }

  if (tps) {
    for (const tp of tps) {
      dom.setText(dom.el[`tp${tp.n}-price`], fmt(tp.tp));
      dom.setText(dom.el[`tp${tp.n}-pct`],   '+' + tp.pct.toFixed(2) + '%');
    }
  }

  dom.setText(dom.el['atr-trail-val'], trailStop ? fmt(trailStop) : '—');

  // Squeeze state badge (in-card)
  const sqEl = dom.lazy('squeeze-state');
  if (sqEl) {
    const sq = state.squeezeState;
    if (sq?.inSqueeze) {
      sqEl.style.display = '';
      sqEl.textContent   = sq.label;
      sqEl.style.color   = sq.breakoutDir === 'bull' ? 'var(--green)'
                         : sq.breakoutDir === 'bear' ? 'var(--red)'
                         : 'var(--amber)';
    } else {
      sqEl.style.display = 'none';
    }
  }

  // Displacement candles info
  const dispEl = dom.lazy('displacement-info');
  if (dispEl) {
    const recent = (state.displacements || []).filter(d => {
      const barsAgo = (state.candles.length - 1) - d.idx;
      return barsAgo <= 5;
    }).slice(0, 2);

    if (recent.length) {
      dispEl.style.display = '';
      dispEl.innerHTML = recent.map(d => {
        const tipKey = `displacement.${d.strength || 'moderate'}`;
        return `<span data-tip="${tipKey}" style="color:${d.dir === 'bull' ? 'var(--green)' : 'var(--red)'};
          font-family:var(--mono);font-size:9px;background:var(--bg3);
          border-radius:4px;padding:1px 6px;margin-right:4px">
          ${d.label}
        </span>`;
      }).join('');
    } else {
      dispEl.style.display = 'none';
    }
  }

  if (atrSize) {
    dom.setText(dom.el['atr-size-tokens'], atrSize.tokens.toFixed(4));
    dom.setText(dom.el['atr-size-value'],  '$' + atrSize.positionValue.toFixed(2));
    dom.setText(dom.el['atr-size-risk'],   '$' + atrSize.riskUSD.toFixed(2));
    dom.setText(dom.el['atr-stop-dist'],   atrSize.stopDistPct.toFixed(2) + '%');
    setTip(dom.el['atr-trail-val'],   'atr.trail');
    setTip(dom.el['atr-size-tokens'], 'atr.size');
  }

  // Backtest context panel
  const btEl = dom.el['bt-context'];
  if (btEl) {
    const m       = btResult?.metrics;
    const matches = m && btResult?.sym === state.sym && btResult?.tf === state.tf;
    btEl.style.display = matches ? 'grid' : 'none';
    if (matches) {
      dom.setText(dom.el['bt-ctx-wr'],     m.winRate + '%');
      dom.setText(dom.el['bt-ctx-exp'],    (m.expectancy >= 0 ? '+' : '') + '$' + m.expectancy.toFixed(2));
      dom.setText(dom.el['bt-ctx-pf'],     m.profitFactor != null ? m.profitFactor.toFixed(2) : '—');
      dom.setText(dom.el['bt-ctx-dd'],     m.maxDrawdownPct.toFixed(1) + '%');
      dom.setText(dom.el['bt-ctx-trades'], m.total);

      const wrEl = dom.el['bt-ctx-wr'];
      if (wrEl) wrEl.style.color = m.winRate >= 55 ? 'var(--green)' : m.winRate >= 45 ? 'var(--amber)' : 'var(--red)';
      const expEl = dom.el['bt-ctx-exp'];
      if (expEl) expEl.style.color = m.expectancy >= 0 ? 'var(--green)' : 'var(--red)';
      const ddEl = dom.el['bt-ctx-dd'];
      if (ddEl) ddEl.style.color = m.maxDrawdownPct < 10 ? 'var(--green)' : m.maxDrawdownPct < 20 ? 'var(--amber)' : 'var(--red)';
    }
  }
}

// ── Futures calculator output ──────────────────────────────────────────────────

export function updateFuturesUI(metrics, leverage, entry) {
  if (!metrics) return;

  dom.setText(dom.el['fv-pos-size'],  '$' + metrics.posSize.toFixed(2));
  dom.setText(dom.el['fv-liq-price'], fmt(metrics.liqPrice));
  dom.setText(dom.el['fv-liq-dist'],  metrics.liqDistPct.toFixed(1) + '%');
  dom.setText(dom.el['fv-profit'],    '$' + metrics.profitNet.toFixed(2));
  dom.setText(dom.el['fv-loss'],      '$' + Math.abs(metrics.lossNet).toFixed(2));
  dom.setText(dom.el['fv-roi-win'],   metrics.roiWin.toFixed(2) + '%');
  dom.setText(dom.el['fv-roi-loss'],  metrics.roiLoss.toFixed(2) + '%');
  dom.setText(dom.el['fv-be-price'],  fmt(metrics.bePrice));
  dom.setText(dom.el['fee-open'],     '$' + metrics.feeOpen.toFixed(3));
  dom.setText(dom.el['fee-close'],    '$' + metrics.feeClose.toFixed(3));
  dom.setText(dom.el['fee-tot'],      '$' + metrics.feeTot.toFixed(3));

  const liqBar = dom.el['liq-bar'];
  if (liqBar) {
    const pct = metrics.liqGaugePct + '%';
    const bg  = metrics.liqDistPct < 10 ? 'var(--red)'
              : metrics.liqDistPct < 20 ? 'var(--amber)'
              : 'var(--green)';
    dom.setStyle(liqBar, 'width',      pct);
    dom.setStyle(liqBar, 'background', bg);
  }

  const warn = dom.el['risk-warn'];
  if (warn) {
    const isHigh = metrics.riskPct > 3;
    const isMed  = metrics.riskPct > 2 && !isHigh;
    dom.show(warn, isHigh || isMed);
    if (isHigh || isMed) {
      warn.className   = 'risk-warn ' + (isHigh ? 'high' : 'med');
      warn.textContent = `⚠ Risk is ${metrics.riskPct.toFixed(1)}% of capital — ${isHigh ? 'consider reducing leverage or size' : 'acceptable but elevated'}.`;
    }
  }
}

// ── Indicator legend (left column) ────────────────────────────────────────────

export function updateLegendLabels(vwap, cvd) {
  dom.setText(dom.el['leg-e9'],  state.e9  ? fmt(state.e9)  : '—');
  dom.setText(dom.el['leg-e20'], state.e20 ? fmt(state.e20) : '—');
  dom.setText(dom.el['leg-e50'], state.e50 ? fmt(state.e50) : '—');
  setTip(dom.el['leg-e9'],    'ema.9');
  setTip(dom.el['leg-e20'],   'ema.20');
  setTip(dom.el['leg-e50'],   'ema.50');
  setTip(dom.el['leg-vwap'],  'vwap');
  setTip(dom.el['leg-vwap2'], 'vwap');
  setTip(dom.el['leg-cvd'],   'cvd');

  const vwapStr = vwap ? fmt(vwap) : '—';
  dom.setText(dom.el['leg-vwap'],  vwapStr);
  dom.setText(dom.el['leg-vwap2'], vwapStr);

  if (cvd !== undefined && cvd !== null) {
    dom.setText(dom.el['leg-cvd'], (cvd >= 0 ? '+' : '') + fmtK(cvd));
  }
}

// ── AVWAP label ────────────────────────────────────────────────────────────────

export function writeAvwapLabel() {
  const el    = dom.el['avwap-val'];
  if (!el) return;
  const avwap = getLatestAvwap();
  if (avwap != null) {
    dom.setText(el, fmt(avwap));
    dom.setStyle(el, 'color', (state.livePrice && state.livePrice >= avwap) ? 'var(--green)' : 'var(--red)');
  } else {
    dom.setText(el, '—');
    dom.setStyle(el, 'color', '');
  }
}

// ── Order flow delta ticker ────────────────────────────────────────────────────

export function updateDeltaTicker() {
  const net = state.tradeBuyVol - state.tradeSellVol;
  const tot = state.tradeBuyVol + state.tradeSellVol || 1;
  const pct = Math.round(state.tradeBuyVol / tot * 100);

  dom.setText(dom.el['delta-buy'],  fmtK(state.tradeBuyVol));
  dom.setText(dom.el['delta-sell'], fmtK(state.tradeSellVol));
  setTip(dom.el['delta-buy'],  'delta.buy');
  setTip(dom.el['delta-sell'], 'delta.sell');
  setTip(dom.el['delta-net'],  'delta.net');

  const netEl = dom.el['delta-net'];
  if (netEl) {
    dom.setText(netEl, (net >= 0 ? '+' : '') + fmtK(net));
    dom.setStyle(netEl, 'color', net >= 0 ? 'var(--green)' : 'var(--red)');
  }

  const bar = dom.el['delta-ratio-bar'];
  if (bar) {
    dom.setStyle(bar, 'width',      pct + '%');
    dom.setStyle(bar, 'background', net >= 0 ? 'var(--green)' : 'var(--red)');
  }
}

// ── Volume profile labels ──────────────────────────────────────────────────────

export function updateVPLabels(vp) {
  dom.setText(dom.el['vp-poc-val'], fmt(vp.poc));
  dom.setText(dom.el['vp-vah-val'], fmt(vp.vah));
  dom.setText(dom.el['vp-val-val'], fmt(vp.val));
  setTip(dom.el['vp-poc-val'], 'vp.poc');
  setTip(dom.el['vp-vah-val'], 'vp.vah');
  setTip(dom.el['vp-val-val'], 'vp.val');
}

// ── Entry zones card ───────────────────────────────────────────────────────────

export function updateEntryZonesUI(zones) {
  if (!zones) return;
  dom.setText(dom.el['zone-agg'], fmt(zones.aggressive));
  dom.setText(dom.el['zone-bal'], fmt(zones.balanced));
  dom.setText(dom.el['zone-con'], fmt(zones.conservative));
  setTip(dom.el['zone-agg'], 'zone.aggressive');
  setTip(dom.el['zone-bal'], 'zone.balanced');
  setTip(dom.el['zone-con'], 'zone.conservative');
}
