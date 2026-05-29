/**
 * charts/draw.js
 * Canvas rendering engine. All draw functions are pure:
 * they receive data as arguments and render to a canvas context.
 * No state reads directly — the coordinator (main.js) passes data in.
 */

import { fmt } from '../utils/helpers.js';

const DPR = window.devicePixelRatio || 1;
const GC  = 'rgba(255,255,255,0.04)';   // grid color
const TC  = 'rgba(255,255,255,0.22)';   // tick label color
const MONO = '9px JetBrains Mono, monospace';

// ── Canvas Setup ──────────────────────────────────────────────────────────────

export function setupCanvas(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const w = el.parentElement.clientWidth - 20 || 600;
  const h = parseInt(el.style.height) || el.offsetHeight || 200;
  el.width  = w * DPR;
  el.height = h * DPR;
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  const ctx = el.getContext('2d');
  ctx.scale(DPR, DPR);
  return { ctx, w, h };
}

// ── Price Chart ───────────────────────────────────────────────────────────────

export function drawPrice({
  canvasId, candles, currentCandle,
  e9s, e20s, e50s, vwapVals, vwapBandVals, avwapVals, anchorIdx,
  liveVwap, liveBands, showVwapBands,
  crossovers, hoverIdx,
  suggestion, fibLevels, overlayFib, swingPoints, structureEvents,
  sessionLevels, workerVP, overlayVP,
}) {
  const setup = setupCanvas(canvasId);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const all = [...candles, currentCandle].filter(Boolean);
  const vis = all.slice(-70);
  const n   = vis.length;
  if (n < 2) return;

  const pMin = Math.min(...vis.map(c => c.l));
  const pMax = Math.max(...vis.map(c => c.h));
  const pad  = (pMax - pMin) * 0.06 || pMax * 0.001;
  const plo  = pMin - pad, phi = pMax + pad;
  const pR   = phi - plo || 1;
  const padR = 66, padL = 2, padT = 10, padB = 6;
  const cW   = w - padR - padL, cH = h - padT - padB;
  const cw   = cW / n;

  const tx = i => padL + i * cw + cw / 2;
  const ty = p => padT + cH - (p - plo) / pR * cH;

  ctx.clearRect(0, 0, w, h);

  // ── Grid ─────────────────────────────────────────────────────────────────
  for (let i = 0; i <= 4; i++) {
    const y = padT + cH * i / 4;
    ctx.strokeStyle = GC; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke();
    ctx.fillStyle = TC; ctx.font = MONO; ctx.textAlign = 'left';
    ctx.fillText(fmt(phi - pR * i / 4), padL + cW + 4, y + 3.5);
  }

  // ── Hover crosshair ───────────────────────────────────────────────────────
  if (hoverIdx >= 0 && hoverIdx < n) {
    const hx = tx(hoverIdx);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + cH); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Previous day / session levels ─────────────────────────────────────────
  if (sessionLevels) {
    const lvls = [
      { price: sessionLevels.prevHigh, label: 'PDH', color: 'rgba(255,184,46,0.5)' },
      { price: sessionLevels.prevLow,  label: 'PDL', color: 'rgba(255,61,90,0.5)'  },
    ];
    lvls.forEach(lv => {
      if (!lv.price) return;
      const ly = ty(lv.price);
      if (ly < padT || ly > padT + cH) return;
      ctx.strokeStyle = lv.color; ctx.lineWidth = 0.7; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + cW * 0.9, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lv.color; ctx.font = MONO; ctx.textAlign = 'right';
      ctx.fillText(lv.label, padL + cW * 0.9 - 2, ly - 2);
    });
  }

  // ── Swing points ──────────────────────────────────────────────────────────
  if (swingPoints?.length) {
    const offset = Math.max(0, all.length - vis.length);
    swingPoints.forEach(sp => {
      const vi = sp.idx - offset;
      if (vi < 0 || vi >= n) return;
      const x = tx(vi), y = ty(sp.price);
      ctx.fillStyle = sp.type === 'high' ? 'rgba(255,61,90,0.7)' : 'rgba(0,229,160,0.7)';
      ctx.beginPath();
      ctx.arc(x, y + (sp.type === 'high' ? -5 : 5), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ── Structure events (BOS / CHoCH) ────────────────────────────────────────
  if (structureEvents?.length) {
    const offset = Math.max(0, all.length - vis.length);
    structureEvents.slice(-6).forEach(ev => {
      const vi = ev.idx - offset;
      if (vi < 0 || vi >= n) return;
      const x = tx(vi), y = ty(ev.price);
      const col  = ev.dir === 'bull' ? '#00e5a0' : '#ff3d5a';
      const label = ev.type + (ev.dir === 'bull' ? '↑' : '↓');
      ctx.strokeStyle = col; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 3, y - 3);
    });
  }

  // ── Fib levels ────────────────────────────────────────────────────────────
  if (overlayFib && fibLevels) {
    ctx.save(); ctx.setLineDash([2, 4]);
    ctx.font = '8px JetBrains Mono, monospace';
    fibLevels.forEach(f => {
      const y = ty(f.price);
      if (y < padT || y > padT + cH) return;
      ctx.strokeStyle = f.col || 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW * 0.85, y); ctx.stroke();
      ctx.fillStyle = f.col || TC; ctx.textAlign = 'left';
      ctx.fillText(f.label + ' ' + fmt(f.price), padL + cW * 0.86, y - 1);
    });
    ctx.setLineDash([]); ctx.restore();
  }

  // ── Volume Profile ────────────────────────────────────────────────────────
  if (overlayVP) drawVolumeProfile(ctx, vis, ty, padL, cW, padT, cH, workerVP);

  // ── VWAP Bands ────────────────────────────────────────────────────────────
  if (showVwapBands) drawVWAPBands(ctx, vis, vwapBandVals, liveBands, ty, tx, padL, cW, n);

  // ── VWAP Line ─────────────────────────────────────────────────────────────
  drawLine(ctx, vwapVals.slice(-n), n, tx, ty, 'rgba(240,224,64,0.8)', 1.5);

  // ── Anchored VWAP ─────────────────────────────────────────────────────────
  if (anchorIdx !== null && avwapVals?.length >= 2) {
    drawAnchoredVWAP(ctx, all, vis, avwapVals, anchorIdx, tx, ty, padL);
  }

  // ── EMA Lines ────────────────────────────────────────────────────────────
  const off = Math.max(0, candles.length - 69);
  [
    [e9s.slice(off).slice(-70),  '#ff6b35', 1.5],
    [e20s.slice(off).slice(-70), '#4da6ff', 1.5],
    [e50s.slice(off).slice(-70), '#a78bff', 1.5],
  ].forEach(([vals, col, lw]) => drawLine(ctx, vals, n, tx, ty, col, lw));

  // ── Suggestion Levels ─────────────────────────────────────────────────────
  if (suggestion?.entry && suggestion?.stop) {
    const levs = [
      { price: suggestion.entry,  color: 'rgba(77,166,255,0.7)',  label: 'ENT ' + fmt(suggestion.entry) },
      { price: suggestion.stop,   color: 'rgba(255,61,90,0.6)',   label: 'SL '  + fmt(suggestion.stop) },
      { price: suggestion.target, color: 'rgba(0,229,160,0.6)',   label: 'TP '  + fmt(suggestion.target) },
    ];
    ctx.setLineDash([4, 4]);
    levs.forEach(lv => {
      if (!lv.price) return;
      const ly = ty(lv.price);
      ctx.strokeStyle = lv.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(padL + cW, ly); ctx.stroke();
      ctx.fillStyle = lv.color; ctx.font = MONO; ctx.textAlign = 'left';
      ctx.fillText(lv.label, padL + cW + 4, ly + 3.5);
    });
    ctx.setLineDash([]);
  }

  // ── Candles ───────────────────────────────────────────────────────────────
  vis.forEach((c, i) => {
    const x   = tx(i);
    const bw  = Math.max(2, cw * 0.62);
    const isL = i === n - 1;
    const col = isL ? '#888' : (c.c >= c.o ? '#00e5a0' : '#ff3d5a');
    ctx.strokeStyle = col; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, ty(c.h)); ctx.lineTo(x, ty(c.l)); ctx.stroke();
    const bT = ty(Math.max(c.o, c.c)), bB = ty(Math.min(c.o, c.c));
    ctx.fillStyle = isL ? 'rgba(140,140,140,0.5)' : col;
    ctx.fillRect(x - bw / 2, bT, bw, Math.max(1, bB - bT));
  });

  // ── Crossover markers ─────────────────────────────────────────────────────
  const startOff = Math.max(0, all.length - n);
  crossovers.forEach(cr => {
    const vi = cr.idx - startOff;
    if (vi < 0 || vi >= n) return;
    const x = tx(vi), y = ty(vis[vi]?.c || cr.price);
    ctx.fillStyle = cr.type === 'bull' ? '#00e5a0' : '#ff3d5a';
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(cr.type === 'bull' ? '▲' : '▼', x, y + (cr.type === 'bull' ? 12 : -4));
  });
}

// ── RSI Chart ─────────────────────────────────────────────────────────────────

export function drawRSI({ canvasId, candles, currentCandle, rsiVals, hoverIdx }) {
  const setup = setupCanvas(canvasId);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const all = [...candles, currentCandle].filter(Boolean);
  const vis = all.slice(-70);
  const n   = vis.length;
  if (n < 2) return;

  const padR = 66, padL = 2, padT = 4, padB = 4;
  const cW   = w - padR - padL, cH = h - padT - padB;
  const cw   = cW / n;
  const tx   = i => padL + i * cw + cw / 2;
  const ty   = v => padT + cH - ((v - 0) / 100) * cH;

  ctx.clearRect(0, 0, w, h);

  // Background fill for zones
  ctx.fillStyle = 'rgba(255,61,90,0.05)';
  ctx.fillRect(padL, padT, cW, ty(70) - padT);
  ctx.fillStyle = 'rgba(0,229,160,0.05)';
  ctx.fillRect(padL, ty(30), cW, padT + cH - ty(30));

  // Grid lines at 70, 50, 30
  [70, 50, 30].forEach(v => {
    const y = ty(v);
    ctx.strokeStyle = v === 50 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke();
    ctx.fillStyle = TC; ctx.font = MONO; ctx.textAlign = 'left';
    ctx.fillText(v, padL + cW + 4, y + 3.5);
  });

  // RSI line
  const off = Math.max(0, rsiVals.length - n);
  const slice = rsiVals.slice(off);
  ctx.strokeStyle = '#a78bff'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath(); let started = false;
  slice.forEach((v, i) => {
    if (v === null) { started = false; return; }
    const xi = tx(i), yi = ty(v);
    if (!started) { ctx.moveTo(xi, yi); started = true; } else ctx.lineTo(xi, yi);
  });
  ctx.stroke();

  // Hover dot
  if (hoverIdx >= 0 && hoverIdx < n) {
    const v = slice[hoverIdx];
    if (v !== null && v !== undefined) {
      const x = tx(hoverIdx), y = ty(v);
      ctx.fillStyle = '#a78bff';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = TC; ctx.font = MONO; ctx.textAlign = 'center';
      ctx.fillText(Math.round(v), x, y - 6);
    }
  }
}

// ── Volume Chart ──────────────────────────────────────────────────────────────

export function drawVolume({ canvasId, candles, currentCandle }) {
  const setup = setupCanvas(canvasId);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const all = [...candles, currentCandle].filter(Boolean);
  const vis = all.slice(-70);
  const n   = vis.length;
  if (n < 2) return;

  const maxV  = Math.max(...vis.map(c => c.v)) || 1;
  const padL  = 2, padR = 66, padT = 2, padB = 2;
  const cW    = w - padR - padL, cH = h - padT - padB;
  const cw    = cW / n;

  ctx.clearRect(0, 0, w, h);

  vis.forEach((c, i) => {
    const x   = padL + i * cw;
    const bw  = Math.max(1, cw * 0.7);
    const bh  = (c.v / maxV) * cH;
    const col = c.c >= c.o ? 'rgba(0,229,160,0.5)' : 'rgba(255,61,90,0.5)';
    ctx.fillStyle = col;
    ctx.fillRect(x + (cw - bw) / 2, padT + cH - bh, bw, bh);
  });

  // Volume label
  ctx.fillStyle = TC; ctx.font = MONO; ctx.textAlign = 'left';
  ctx.fillText('VOL', padL + cW + 4, padT + 8);
}

// ── CVD Chart ─────────────────────────────────────────────────────────────────

export function drawCVD({ canvasId, candles, currentCandle, cvdVals, cvdEmaVals, showCvdEma }) {
  const setup = setupCanvas(canvasId);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const all = [...candles, currentCandle].filter(Boolean);
  const n   = Math.min(all.length, 70);
  if (n < 2) return;

  const slice    = cvdVals.slice(-n);
  const emaSlice = cvdEmaVals.slice(-n);
  const allVals  = [...slice, ...emaSlice].filter(v => v !== null);
  if (!allVals.length) return;

  const vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  const vR   = vMax - vMin || 1;
  const padL = 2, padR = 66, padT = 4, padB = 4;
  const cW   = w - padR - padL, cH = h - padT - padB;
  const cw   = cW / n;
  const tx   = i => padL + i * cw + cw / 2;
  const ty   = v => padT + cH - ((v - vMin) / vR) * cH;

  ctx.clearRect(0, 0, w, h);

  // Zero line
  const zero = ty(0);
  if (zero >= padT && zero <= padT + cH) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(padL, zero); ctx.lineTo(padL + cW, zero); ctx.stroke();
  }

  // CVD histogram bars
  slice.forEach((v, i) => {
    if (v === null) return;
    const x  = padL + i * cw;
    const bw = Math.max(1, cw * 0.65);
    const yZ = ty(0), yV = ty(v);
    ctx.fillStyle = v >= 0 ? 'rgba(0,229,160,0.55)' : 'rgba(255,61,90,0.55)';
    ctx.fillRect(x + (cw - bw) / 2, Math.min(yZ, yV), bw, Math.abs(yV - yZ) || 1);
  });

  // EMA line
  if (showCvdEma) {
    ctx.strokeStyle = '#ffb82e'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
    ctx.beginPath(); let started = false;
    emaSlice.forEach((v, i) => {
      if (v === null) { started = false; return; }
      const xi = tx(i), yi = ty(v);
      if (!started) { ctx.moveTo(xi, yi); started = true; } else ctx.lineTo(xi, yi);
    });
    ctx.stroke();
  }

  ctx.fillStyle = TC; ctx.font = MONO; ctx.textAlign = 'left';
  ctx.fillText('CVD', padL + cW + 4, padT + 8);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function drawLine(ctx, vals, n, tx, ty, color, lineWidth) {
  if (!vals || vals.length < 2) return;
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round';
  ctx.beginPath(); let started = false;
  const offset = n - vals.length;
  vals.forEach((v, i) => {
    if (v === null || v === undefined) { started = false; return; }
    const xi = tx(i + offset), yi = ty(v);
    if (!started) { ctx.moveTo(xi, yi); started = true; } else ctx.lineTo(xi, yi);
  });
  ctx.stroke();
}

function drawVWAPBands(ctx, vis, vwapBandVals, liveBands, ty, tx, padL, cW, n) {
  const bandSlice = [...vwapBandVals.slice(-n)];
  if (liveBands) bandSlice.push(liveBands);
  if (bandSlice.length < 2) return;

  const off = n - bandSlice.length;
  ctx.beginPath();
  bandSlice.forEach((b, i) => { if (i===0) ctx.moveTo(tx(i+off),ty(b.v2u)); else ctx.lineTo(tx(i+off),ty(b.v2u)); });
  for (let i = bandSlice.length-1; i>=0; i--) ctx.lineTo(tx(i+off),ty(bandSlice[i].v2l));
  ctx.closePath(); ctx.fillStyle='rgba(240,224,64,0.04)'; ctx.fill();

  ctx.beginPath();
  bandSlice.forEach((b, i) => { if (i===0) ctx.moveTo(tx(i+off),ty(b.v1u)); else ctx.lineTo(tx(i+off),ty(b.v1u)); });
  for (let i = bandSlice.length-1; i>=0; i--) ctx.lineTo(tx(i+off),ty(bandSlice[i].v1l));
  ctx.closePath(); ctx.fillStyle='rgba(240,224,64,0.08)'; ctx.fill();

  [[b=>b.v1u,'rgba(240,224,64,0.4)',[3,3]],[b=>b.v1l,'rgba(240,224,64,0.4)',[3,3]],[b=>b.v2u,'rgba(240,224,64,0.2)',[2,4]],[b=>b.v2l,'rgba(240,224,64,0.2)',[2,4]]].forEach(([fn,col,dash]) => {
    ctx.strokeStyle=col; ctx.lineWidth=0.7; ctx.setLineDash(dash); ctx.lineJoin='round';
    ctx.beginPath(); let s=false;
    bandSlice.forEach((b,i) => { const v=fn(b); if(v===null){s=false;return;} const xi=tx(i+off),yi=ty(v); if(!s){ctx.moveTo(xi,yi);s=true;}else ctx.lineTo(xi,yi); });
    ctx.stroke(); ctx.setLineDash([]);
  });
}

function drawAnchoredVWAP(ctx, all, vis, avwapVals, anchorIdx, tx, ty, padL) {
  const startOffset = all.length - vis.length;
  ctx.save(); ctx.strokeStyle='rgba(167,139,255,0.85)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
  ctx.beginPath(); let started = false;
  vis.forEach((c, i) => {
    const ri = (startOffset + i) - anchorIdx;
    if (ri < 0 || ri >= avwapVals.length) return;
    const xi = tx(i), yi = ty(avwapVals[ri]);
    if (!started) { ctx.moveTo(xi, yi); started = true; } else ctx.lineTo(xi, yi);
  });
  if (started) ctx.stroke();
  ctx.setLineDash([]);
  const anchorVi = anchorIdx - startOffset;
  if (anchorVi >= 0 && anchorVi < vis.length) {
    ctx.fillStyle = 'rgba(167,139,255,0.9)';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText('⚓', tx(anchorVi) - 5, ty(avwapVals[0]) - 6);
  }
  ctx.restore();
}

function drawVolumeProfile(ctx, vis, ty, padL, cW, padT, cH, workerVP) {
  const bins   = workerVP?.bins ?? 24;
  const pMin   = workerVP?.pMin ?? Math.min(...vis.map(c => c.l));
  const pMax   = workerVP?.pMax ?? Math.max(...vis.map(c => c.h));
  const step   = workerVP?.step ?? ((pMax - pMin) / bins || 0.001);
  const profile= workerVP?.profile ?? (() => {
    const p = Array(bins).fill(0);
    vis.forEach(c => { const b = Math.min(bins-1, Math.floor((c.c-pMin)/step)); p[b]+=c.v; });
    return p;
  })();
  const maxVol = Math.max(...profile) || 1;
  const pocBin = profile.indexOf(maxVol);

  // Value area
  const totalVol = profile.reduce((a,b)=>a+b,0)||1;
  const sorted   = profile.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
  let acc=0; const vaBins=new Set();
  for (const {v,i} of sorted) { acc+=v; vaBins.add(i); if(acc>=totalVol*0.7) break; }

  const barMaxW = 40;
  const barX    = padL + cW - barMaxW;
  ctx.save(); ctx.globalAlpha = 0.55;
  profile.forEach((vol, i) => {
    const price = pMin + step * (i + 0.5);
    const y     = ty(price);
    const barH  = Math.max(1, step / (pMax - pMin) * cH * 0.85);
    const barW  = (vol / maxVol) * barMaxW;
    ctx.fillStyle = i === pocBin ? 'rgba(255,184,46,0.85)' : vaBins.has(i) ? 'rgba(77,166,255,0.55)' : 'rgba(77,166,255,0.22)';
    ctx.fillRect(barX + barMaxW - barW, y - barH / 2, barW, barH);
  });
  ctx.globalAlpha = 1;

  // POC line
  const pocY = ty(pMin + step * (pocBin + 0.5));
  ctx.strokeStyle='rgba(255,184,46,0.8)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(padL, pocY); ctx.lineTo(padL+cW*0.82, pocY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
