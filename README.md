# TradingTerminal v2.0

A professional futures trading assistant — refactored from a single `index.html` monolith into a clean, modular ES module project.

---

## Quick Start

```bash
npm install
npm run dev       # localhost:3000
npm run build     # production bundle → dist/
```

**No-build fallback:** Serve the project root with any static file server that supports ES modules:
```bash
npx serve .
# or
python3 -m http.server 3000
```

---

## Project Structure

```
trading-terminal/
├── index.html                  # Entry point — HTML shell only
├── main.js                     # App orchestrator — wires all modules
├── vite.config.js
├── package.json
├── tsconfig.json
│
├── types/
│   └── index.ts                # All TypeScript types (Candle, Signal, JournalTrade…)
│
├── state/
│   ├── store.js                # Centralized mutable app state
│   └── persistence.js          # localStorage save/load helpers
│
├── utils/
│   └── helpers.js              # Pure utility functions (fmt, fmtK, TF_MS…)
│
├── indicators/
│   ├── engine.js               # EMA, RSI, ATR, MACD, VWAP, CVD, Fib, VP
│   ├── regime.js               # Market regime detection (ADX, ER, slope)
│   └── structure.js            # Swing H/L, BOS, CHoCH, S/R zones
│
├── engine/
│   ├── signals.js              # Entry quality scoring, suggestion, partial TPs, ATR sizing
│   └── risk.js                 # Futures math, liquidation, position sizing, fee modeling
│
├── services/
│   ├── exchange.js             # WebSocket manager, REST fetch, Bybit/Binance/OKX adapters
│   └── screener.js             # Multi-symbol screener, MTF confluence, sector rotation
│
├── workers/
│   └── indicator.worker.js     # Off-main-thread: EMA/RSI/VP/ADX/regime calculations
│
├── charts/
│   └── draw.js                 # Canvas rendering: price, RSI, volume, CVD
│
├── components/
│   └── journal.js              # Trade journal: log, tag, stats, behavioral detection
│
└── styles/
    ├── tokens.css              # Design tokens: colors, spacing, radius, typography
    ├── components.css          # Cards, buttons, inputs, badges, journal UI
    └── layout.css              # Topbar, 3-column grid, chart card, screener table
```

---

## Architecture

### Data Flow

```
Exchange WebSocket
      │
      ▼
KlineWebSocket (services/exchange.js)
      │  onCandle(candle, confirmed)
      ▼
addCandleToState()  ← main.js
  - EMA streaming update
  - Wilder RSI streaming update
  - VWAP + Welford bands streaming update
  - CVD streaming update
  - Crossover detection
      │
      ▼
computeAndRender()  ← main.js
  - detectRegime()         ← indicators/regime.js
  - detectSwingPoints()    ← indicators/structure.js
  - detectStructureBreaks()
  - computeSuggestion()    ← engine/signals.js
  - scoreEntryQuality()
  - computePartialTPs()
  - calcAtrPositionSize()
  - calcFuturesMetrics()   ← engine/risk.js
      │
      ▼
drawAll()  ← charts/draw.js
  - drawPrice() (canvas)
  - drawRSI()   (canvas)
  - drawVolume()
  - drawCVD()
```

### Worker Architecture
Heavy computations (volume profile, ADX/regime from full history) run in `indicator.worker.js` off the main thread. The worker receives the full candle array and returns:
- `e9s, e20s, e50s, rsi[]` — full history arrays
- `vp` — volume profile
- `regime` — full ADX-based classification

The main thread uses streaming (incremental) versions for real-time tick updates, and the worker result is merged on completion.

---

## TODO Status

### ✅ Implemented in v2.0 (this refactor)

**Phase 1 — Architecture Foundation**
- [x] Split monolithic `index.html` into 12 modules
- [x] `/components`, `/charts`, `/engine`, `/indicators`, `/workers`, `/services`, `/state`, `/utils`, `/styles`, `/types`
- [x] Vite build setup, TypeScript types, ESLint config

**Phase 2 — Core Trading Engine**
- [x] Normalized candle store with incremental updates
- [x] EMA, RSI (Wilder), ATR, VWAP (Welford), CVD, Volume Profile, Fib modules
- [x] Worker-thread calculations
- [x] Memoized indicator arrays (state holds parallel arrays)

**Phase 3 — Market Structure Logic**
- [x] Market regime detection (ADX + Efficiency Ratio)
- [x] Trend persistence scoring (`calcTrendAge`)
- [x] Momentum acceleration
- [x] Swing highs/lows detection
- [x] BOS (Break of Structure)
- [x] CHoCH (Change of Character)
- [x] Liquidity sweeps detection
- [x] Equal highs/lows detection
- [x] Previous day high/low, session high/low
- [x] S/R zones from swing cluster

**Phase 4 — Signal Engine**
- [x] EMA pullback entries, momentum breakout, reversal, mean reversion
- [x] Multi-factor confluence scoring (EMA stack, RSI, VWAP, CVD, Fib, regime)
- [x] Confidence score 0–100 with factor labels
- [x] Aggressive / balanced / conservative entry zones
- [x] Partial TPs: TP1 (1:1), TP2 (1:2), TP3 (1:3)

**Phase 5 — Futures & Risk Engine**
- [x] ATR-based position sizing
- [x] ATR trailing stop
- [x] Bybit/Binance/OKX liquidation models
- [x] Isolated margin support
- [x] Fee modeling: maker / taker / total
- [x] Break-even price
- [x] Dynamic leverage suggestion
- [x] Risk % warning system
- [x] Daily goal calculator

**Phase 6 — Screener Engine**
- [x] Multi-symbol fetching with rate limiting
- [x] MTF confluence, volume spike detection, trend age
- [x] Composite score 0–100
- [x] Sector rotation detection

**Phase 10 — Journaling & Analytics**
- [x] Trade journal with entry/exit/setup/emotion/mistakes/notes
- [x] Performance stats: win rate, profit factor, expectancy, avg RR
- [x] Behavioral detection: revenge trades, FOMO, oversize, no-stop
- [x] Setup performance breakdown
- [x] CSV export

### 🔲 Next Priority

- [ ] Migrate to React (Phase 1)
- [ ] Backtesting engine (Phase 9)
- [ ] Telegram / Discord alerts (Phase 8)
- [ ] Lightweight Charts migration (Phase 7)
- [ ] Drawing tools: trendlines, fib tool, horizontal rays (Phase 7)
- [ ] Trade screenshot capture (Phase 10)
- [ ] Backend + cloud sync (Phase 13)
- [ ] MAE/MFE tracking (Phase 10)
- [ ] Funding rate integration (Phase 2)
- [ ] Monte Carlo simulation (Phase 18)

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `L` | Set direction: Long |
| `S` | Set direction: Short |
| `R` | Run screener |
| `F` | Toggle Fibonacci overlay |
| `V` | Toggle Volume Profile |
| `T` | Toggle dark/light theme |
| `A` | Anchor VWAP to session open |
| `X` | Clear anchored VWAP |
| `[` | Decrease R:R ratio by 0.5 |
| `]` | Increase R:R ratio by 0.5 |

---

## Exchanges

| Exchange | REST | WebSocket Klines | Trade Stream |
|----------|------|-----------------|--------------|
| Bybit    | ✅   | ✅               | ✅            |
| Binance  | ✅   | ✅               | ✅            |
| OKX      | ✅   | ✅               | ✅            |

---

## Design System

All tokens live in `styles/tokens.css`. Key vars:

```css
--green:    #00e5a0   /* Bullish / profit */
--red:      #ff3d5a   /* Bearish / loss */
--amber:    #ffb82e   /* Warnings / leverage */
--blue:     #4da6ff   /* Entry levels */
--purple:   #a78bff   /* EMA50 / AVWAP */
--orange:   #ff6b35   /* EMA9 */

--bg .. --bg5          /* Background layers */
--text .. --text3      /* Text hierarchy */
--mono                 /* JetBrains Mono */
```
