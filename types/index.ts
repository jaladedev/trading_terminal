// ─── Candle ───────────────────────────────────────────────────────────────────
export interface Candle {
  t: number;       // open timestamp (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  _realDelta?: number | null;  // real order-flow delta from trade stream
  _fakeVol?: boolean;          // CoinGecko fallback – no real volume
}

// ─── Indicator State ──────────────────────────────────────────────────────────
export interface EMAState {
  e9:  number | null;
  e20: number | null;
  e50: number | null;
}

export interface RSIState {
  avgGain: number | null;
  avgLoss: number | null;
  gains:   number[];
  losses:  number[];
}

export interface VWAPState {
  cumPV:      number;
  cumV:       number;
  m2:         number;
  sessionKey: string;
}

export interface CVDState {
  running:    number;
  emaRun:     number | null;
  sessionKey: string;
  resetMode:  'continuous' | 'daily';
}

export interface VWAPBands {
  v1u: number; v1l: number;
  v2u: number; v2l: number;
}

export interface VolumeProfile {
  poc:     number;
  vah:     number;
  val:     number;
  profile: number[];
  pMin:    number;
  pMax:    number;
  step:    number;
  bins:    number;
}

// ─── Signal / Suggestion ──────────────────────────────────────────────────────
export type Direction = 'long' | 'short';
export type Signal    = 'bull' | 'bear' | 'tang' | 'none';

export interface Suggestion {
  entry:  number;
  stop:   number;
  target: number;
  dir:    Direction;
}

export interface EntryQuality {
  score:   number;   // 0–100
  label:   string;
  cls:     string;
  factors: string[];
}

export interface MarketRegime {
  type:    'trending' | 'ranging' | 'choppy';
  dir:     'bull' | 'bear' | 'neutral';
  label:   string;
  adx:     number;
  atr:     number;
  atrPct:  number;
}

// ─── Market Structure ─────────────────────────────────────────────────────────
export interface SwingPoint {
  idx:   number;
  price: number;
  type:  'high' | 'low';
  ts:    number;
}

export interface StructureEvent {
  type:   'BOS' | 'CHoCH';
  dir:    'bull' | 'bear';
  price:  number;
  idx:    number;
  ts:     number;
}

// ─── ATR-based Position Sizing ────────────────────────────────────────────────
export interface PositionSize {
  riskUSD:        number;
  stopDistPct:    number;
  stopDistAbs:    number;
  tokens:         number;
  positionValue:  number;
  atrMultiple:    number;
}

// ─── Crossover ────────────────────────────────────────────────────────────────
export interface Crossover {
  type:  'bull' | 'bear';
  price: number;
  idx:   number;
  time:  number;
}

// ─── Fibonacci ────────────────────────────────────────────────────────────────
export interface FibLevel {
  r:     number;
  price: number;
  label: string;
}

export interface FibProximity extends FibLevel {
  distPct:  number;
  dir?:     'support' | 'resistance';
  dirLabel?: string;
  tier?:    'gold' | 'key' | 'minor';
  strength?: number;
}

// ─── Entry Zones ─────────────────────────────────────────────────────────────
export interface EntryZones {
  aggressive:   number;
  balanced:     number;
  conservative: number;
  dir:          Direction;
  stop:         number;
}

// ─── Trade Journal ────────────────────────────────────────────────────────────
export type Emotion   = 'confident' | 'fomo' | 'fearful' | 'revenge' | 'bored' | 'neutral';
export type SetupType = 'ema_pullback' | 'breakout' | 'reversal' | 'mean_revert' | 'momentum' | 'other';
export type MistakeType = 'early_entry' | 'late_entry' | 'wide_stop' | 'no_stop' | 'oversize' | 'revenge' | 'fomo' | 'none';

export interface JournalTrade {
  id:        number;
  timestamp: number;
  sym:       string;
  dir:       Direction;
  tf:        string;
  entry:     number;
  stop:      number;
  target:    number;
  exit?:     number;
  result?:   'win' | 'loss' | 'be';
  pnl?:      number;
  rr?:       number;
  setup:     SetupType;
  emotion:   Emotion;
  mistakes:  MistakeType[];
  notes:     string;
  screenshot?: string;  // base64 chart snapshot
  regime?:   string;
  score?:    number;
}

// ─── Screener ─────────────────────────────────────────────────────────────────
export interface ScreenerResult {
  sym:          string;
  price:        number;
  chgPct:       number;
  signal:       Signal;
  signalClass:  string;
  signalLabel:  string;
  rsi:          number | null;
  score:        number;
  bullStack:    boolean;
  bearStack:    boolean;
  stackLabel:   string;
  trendAge:     number;
  volRatio:     number | null;
  volSpike:     boolean;
  volHot:       boolean;
  e20dist:      number | null;
  hlPos:        number | null;
  nearHigh:     boolean;
  nearLow:      boolean;
  recentCross:  boolean;
  fibProximity: FibProximity | null;
  mtfDir:       string;
  mtfScore:     number;
  mtfFull:      boolean;
  mtfMost:      boolean;
  mtfBreakdown: { tf: string; signal: Signal }[];
  bullCount:    number;
  bearCount:    number;
  availTFs:     number;
  totalTFs:     number;
  fetchedAt:    number;
  source:       string;
  tfData:       Record<string, any>;
}

// ─── MTF ──────────────────────────────────────────────────────────────────────
export interface MTFData {
  tf:     string;
  signal: Signal;
  rsi:    number | null;
  e9:     number | null;
  e20:    number | null;
  e50:    number | null;
}

// ─── Price Alert ──────────────────────────────────────────────────────────────
export interface PriceAlert {
  id:        number;
  sym:       string;
  price:     number;
  dir:       'above' | 'below';
  triggered: boolean;
}

// ─── P&L Trade ────────────────────────────────────────────────────────────────
export interface PnLTrade {
  n:      number;
  time:   string;
  sym:    string;
  dir:    string;
  result: 'win' | 'loss';
  pnl:    number;
}

// ─── Exchange ─────────────────────────────────────────────────────────────────
export type ExchangeName = 'bybit' | 'binance' | 'okx';

export interface ExchangeAdapter {
  name:          string;
  wsUrl:         string;
  tradeWsUrl:    string;
  wsSub:         (sym: string, tf: string) => object;
  tradeSub:      (sym: string) => object;
  wsPing:        () => object | string;
  wsKlineConfirm:(msg: any) => boolean;
  wsKlineToCandle(k: any): Candle;
  wsTradeToTick: (t: any) => { price: number; qty: number; side: 'buy' | 'sell'; ts: number };
  klineUrl:      (sym: string, tf: string) => string;
  parseKlines:   (data: any) => Candle[];
}

// ─── Timeframe ────────────────────────────────────────────────────────────────
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

// ─── App Settings ─────────────────────────────────────────────────────────────
export interface AppSettings {
  sym:      string;
  tf:       Timeframe;
  exchange: ExchangeName;
  leverage: number;
  capital:  number;
  margin:   number;
  rrRatio:  number;
  isDark:   boolean;
}

// ─── Worker Messages ──────────────────────────────────────────────────────────
export interface WorkerInput {
  type:    'calc_all';
  candles: Candle[];
  params:  { vpBins: number };
}

export interface WorkerOutput {
  type:  'result';
  e9s:   number[];
  e20s:  number[];
  e50s:  number[];
  rsi:   (number | null)[];
  vp:    VolumeProfile | null;
}
