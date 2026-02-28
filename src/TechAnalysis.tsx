import React, { useState } from 'react';
import { Search, AlertCircle, TrendingUp, TrendingDown, Activity } from 'lucide-react';

// ── API Keys ──────────────────────────────────────────────────────────────────
const FINNHUB_KEY = 'ctj1dchr01qgfbsvp4mgctj1dchr01qgfbsvp4n0';
const POLYGON_KEY = 'M8zhNduoGphylrTzDQwdpDqz1E35B7Qx';
const TWELVE_KEY  = '97eed83076bf4f208812f013f332bad3';
const AV_KEY      = 'RUIU5L10WQRWQLW1';
const TAAPI_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbHVlIjoiNjlhMjNiZGZlZTAzMzMxMWE0OGYzYzNmIiwiaWF0IjoxNzcyMjM5ODM5LCJleHAiOjMzMjc2NzAzODM5fQ.W_Y15aP16FJ1G4Ocsk7xEm69dLgplV887Wc-YEghbx8';

// ── localStorage quota guard ───────────────────────────────────────────────────
function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      Object.keys(localStorage)
        .filter(k => k.startsWith('finnhub_') || k.startsWith('valuwise_') || k.startsWith('tech_'))
        .forEach(k => localStorage.removeItem(k));
      try { localStorage.setItem(key, value); } catch { /* skip */ }
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candle {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

interface IndicatorResult {
  close: number;
  yearChange: number | null;
  high52w: number;
  low52w: number;
  pos52w: number;
  // Oscillators
  rsi: number | null;
  stochK: number | null;
  stochD: number | null;
  williamsR: number | null;
  cci: number | null;
  // Trend
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  pctVsSMA20: number | null;
  pctVsSMA50: number | null;
  pctVsSMA200: number | null;
  // Volatility
  bbPctB: number | null;
  bbWidth: number | null;
  atr: number | null;
  atrPct: number | null;
  // Momentum / Context
  roc10: number | null;
  roc20: number | null;
  volRatio: number | null;
}

interface TaapiSnap {
  rsi: number | null; macd: number | null; macdSignal: number | null;
  bbUpper: number | null; bbMid: number | null; bbLower: number | null;
  ema20: number | null; ema50: number | null;
}

interface SignalDetail { name: string; value: string; bull: boolean | null; }
interface Signal { score: number; label: 'Bullish' | 'Neutral' | 'Bearish'; details: SignalDetail[]; }

interface IndicatorCard {
  name: string;
  value: string;
  label: string;
  bull: boolean | null;
  desc: string;
}

// ── Indicator Math ────────────────────────────────────────────────────────────
function computeEMA(values: number[], period: number): (number | null)[] {
  if (values.length < period) return values.map(() => null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(period - 1).fill(null);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < values.length; i++) { ema = values[i] * k + ema * (1 - k); result.push(ema); }
  return result;
}

function computeSMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function computeBB(values: number[], period = 20, mult = 2) {
  const mid = computeSMA(values, period);
  const upper: (number | null)[] = [], lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = mid[i]!;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(mean + mult * std);
    lower.push(mean - mult * std);
  }
  return { upper, mid, lower };
}

function computeRSI(values: number[], period = 14): (number | null)[] {
  if (values.length < period + 1) return values.map(() => null);
  const changes = values.slice(1).map((v, i) => v - values[i]);
  const result: (number | null)[] = new Array(period).fill(null);
  let avgGain = changes.slice(0, period).reduce((a, b) => a + Math.max(0, b), 0) / period;
  let avgLoss = changes.slice(0, period).reduce((a, b) => a + Math.max(0, -b), 0) / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(0, changes[i])) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -changes[i])) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function computeMACD(values: number[], fast = 12, slow = 26, sig = 9) {
  const ema12 = computeEMA(values, fast), ema26 = computeEMA(values, slow);
  const macdLine: (number | null)[] = ema12.map((v, i) => v !== null && ema26[i] !== null ? v - ema26[i]! : null);
  const macdVals = macdLine.filter(v => v !== null) as number[];
  const sigEMA = computeEMA(macdVals, sig);
  const sigFull: (number | null)[] = new Array(macdLine.length).fill(null);
  let si = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) { sigFull[i] = si < sigEMA.length ? sigEMA[si] : null; si++; }
  }
  const histFull = macdLine.map((v, i) => v !== null && sigFull[i] !== null ? v - sigFull[i]! : null);
  return { macdLine, sigFull, histFull };
}

function computeATR(candles: Candle[], period = 14): (number | null)[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  const result: (number | null)[] = new Array(period - 1).fill(null);
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  for (let i = period; i < tr.length; i++) { atr = (atr * (period - 1) + tr[i]) / period; result.push(atr); }
  return result;
}

function computeStochastic(candles: Candle[], period = 14, smooth = 3) {
  const rawK: (number | null)[] = candles.map((c, i) => {
    if (i < period - 1) return null;
    const sl = candles.slice(i - period + 1, i + 1);
    const lo = Math.min(...sl.map(s => s.low)), hi = Math.max(...sl.map(s => s.high));
    return hi === lo ? 50 : ((c.close - lo) / (hi - lo)) * 100;
  });
  const kVals = rawK.filter(v => v !== null) as number[];
  const dSmooth = computeSMA(kVals, smooth);
  const d: (number | null)[] = new Array(rawK.length).fill(null);
  let di = 0;
  for (let i = 0; i < rawK.length; i++) { if (rawK[i] !== null) { d[i] = di < dSmooth.length ? dSmooth[di] : null; di++; } }
  return { k: rawK, d };
}

function computeWilliamsR(candles: Candle[], period = 14): (number | null)[] {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const sl = candles.slice(i - period + 1, i + 1);
    const lo = Math.min(...sl.map(s => s.low)), hi = Math.max(...sl.map(s => s.high));
    return hi === lo ? -50 : ((hi - c.close) / (hi - lo)) * -100;
  });
}

function computeCCI(candles: Candle[], period = 20): (number | null)[] {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const sl = candles.slice(i - period + 1, i + 1);
    const tp = sl.map(s => (s.high + s.low + s.close) / 3);
    const mean = tp.reduce((a, b) => a + b, 0) / period;
    const dev = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    return dev === 0 ? 0 : ((c.high + c.low + c.close) / 3 - mean) / (0.015 * dev);
  });
}

function computeAllIndicators(candles: Candle[]): IndicatorResult {
  const closes = candles.map(c => c.close);
  const n = closes.length;
  const last = candles[n - 1];

  const sma20Arr = computeSMA(closes, 20);
  const sma50Arr = computeSMA(closes, 50);
  const sma200Arr = computeSMA(closes, 200);
  const bb = computeBB(closes, 20, 2);
  const rsiArr = computeRSI(closes, 14);
  const { macdLine, sigFull, histFull } = computeMACD(closes);
  const atrArr = computeATR(candles, 14);
  const { k: stochK, d: stochD } = computeStochastic(candles, 14, 3);
  const wrArr = computeWilliamsR(candles, 14);
  const cciArr = computeCCI(candles, 20);

  const sma20 = sma20Arr[n - 1], sma50 = sma50Arr[n - 1], sma200 = sma200Arr[n - 1];
  const bbU = bb.upper[n - 1], bbL = bb.lower[n - 1], bbM = bb.mid[n - 1];
  const bbPctB = bbU != null && bbL != null && bbU !== bbL ? (last.close - bbL) / (bbU - bbL) : null;
  const bbWidth = bbU != null && bbL != null && bbM != null && bbM !== 0 ? (bbU - bbL) / bbM : null;
  const atr = atrArr[n - 1];
  const volumes = candles.map(c => c.volume);
  const vol20 = computeSMA(volumes, 20)[n - 1];
  const high52w = Math.max(...candles.map(c => c.high));
  const low52w  = Math.min(...candles.map(c => c.low));

  return {
    close: last.close,
    yearChange: n > 1 ? ((last.close - closes[0]) / closes[0]) * 100 : null,
    high52w, low52w,
    pos52w: high52w !== low52w ? ((last.close - low52w) / (high52w - low52w)) * 100 : 50,
    rsi: rsiArr[n - 1],
    stochK: stochK[n - 1], stochD: stochD[n - 1],
    williamsR: wrArr[n - 1],
    cci: cciArr[n - 1],
    macd: macdLine[n - 1], macdSignal: sigFull[n - 1], macdHist: histFull[n - 1],
    sma20, sma50, sma200,
    pctVsSMA20:  sma20  ? ((last.close - sma20)  / sma20)  * 100 : null,
    pctVsSMA50:  sma50  ? ((last.close - sma50)  / sma50)  * 100 : null,
    pctVsSMA200: sma200 ? ((last.close - sma200) / sma200) * 100 : null,
    bbPctB, bbWidth,
    atr, atrPct: atr && last.close ? (atr / last.close) * 100 : null,
    roc10: n > 10 ? ((closes[n - 1] - closes[n - 11]) / closes[n - 11]) * 100 : null,
    roc20: n > 20 ? ((closes[n - 1] - closes[n - 21]) / closes[n - 21]) * 100 : null,
    volRatio: vol20 && vol20 > 0 ? last.volume / vol20 : null,
  };
}

// ── OHLCV Normalizers ─────────────────────────────────────────────────────────
function normalizeFinnhub(data: any): Candle[] {
  if (!data || data.s !== 'ok' || !data.t) return [];
  return data.t.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i], volume: data.v[i],
  }));
}

function normalizePolygon(data: any): Candle[] {
  if (!data?.results?.length) return [];
  return data.results.map((r: any) => ({
    date: new Date(r.t).toISOString().slice(0, 10),
    open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v,
  }));
}

function normalizeTwelveData(data: any): Candle[] {
  if (!data?.values?.length) return [];
  return [...data.values].reverse().map((r: any) => ({
    date: r.datetime,
    open: parseFloat(r.open), high: parseFloat(r.high),
    low: parseFloat(r.low), close: parseFloat(r.close), volume: parseInt(r.volume, 10),
  }));
}

function normalizeAlphaVantage(data: any): Candle[] {
  const ts = data?.['Time Series (Daily)'];
  if (!ts) return [];
  return Object.entries(ts).map(([date, v]: [string, any]) => ({
    date,
    open: parseFloat(v['1. open']), high: parseFloat(v['2. high']),
    low: parseFloat(v['3. low']), close: parseFloat(v['4. close']),
    volume: parseInt(v['5. volume'], 10),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// ── OHLCV Fetcher ─────────────────────────────────────────────────────────────
async function fetchOHLCV(symbol: string): Promise<Candle[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const oneYearAgo = nowSec - 365 * 24 * 3600;
  const toDate   = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(oneYearAgo * 1000).toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${oneYearAgo}&to=${nowSec}&token=${FINNHUB_KEY}`
    );
    if (res.ok) { const c = normalizeFinnhub(await res.json()); if (c.length > 20) return c; }
  } catch { /* try next */ }

  try {
    const res = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=365&apiKey=${POLYGON_KEY}`
    );
    if (res.ok) { const c = normalizePolygon(await res.json()); if (c.length > 20) return c; }
  } catch { /* try next */ }

  try {
    const res = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=252&apikey=${TWELVE_KEY}`
    );
    if (res.ok) { const c = normalizeTwelveData(await res.json()); if (c.length > 20) return c; }
  } catch { /* try next */ }

  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${AV_KEY}`
    );
    if (res.ok) { const c = normalizeAlphaVantage(await res.json()); if (c.length > 20) return c; }
  } catch { /* try next */ }

  throw new Error('No price data found. The ticker may be invalid or all data sources are temporarily unavailable.');
}

// ── TAAPI Snapshot ────────────────────────────────────────────────────────────
async function fetchTAAPI(symbol: string): Promise<TaapiSnap | null> {
  try {
    const res = await fetch('https://api.taapi.io/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: TAAPI_KEY,
        construct: {
          exchange: 'stocks', symbol, interval: '1d',
          indicators: [
            { indicator: 'rsi' }, { indicator: 'macd' }, { indicator: 'bbands' },
            { indicator: 'ema', optInTimePeriod: 20 }, { indicator: 'ema', optInTimePeriod: 50 },
          ],
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.data)) return null;
    const snap: TaapiSnap = { rsi: null, macd: null, macdSignal: null, bbUpper: null, bbMid: null, bbLower: null, ema20: null, ema50: null };
    for (const item of json.data) {
      const r = item.result ?? {}, id: string = item.id ?? '';
      if (id.startsWith('rsi'))    snap.rsi = r.value ?? null;
      else if (id.startsWith('macd'))   { snap.macd = r.valueMACD ?? null; snap.macdSignal = r.valueMACDSignal ?? null; }
      else if (id.startsWith('bbands')) { snap.bbUpper = r.valueUpperBand ?? null; snap.bbMid = r.valueMiddleBand ?? null; snap.bbLower = r.valueLowerBand ?? null; }
      else if (id.startsWith('ema'))    { if (snap.ema20 === null) snap.ema20 = r.value ?? null; else snap.ema50 = r.value ?? null; }
    }
    return snap;
  } catch { return null; }
}

// ── Signal ────────────────────────────────────────────────────────────────────
function computeSignal(ind: IndicatorResult, snap: TaapiSnap | null): Signal {
  const rsi = snap?.rsi ?? ind.rsi;
  const macd = snap?.macd ?? ind.macd;
  const macdSig = snap?.macdSignal ?? ind.macdSignal;
  const bullArr: boolean[] = [], details: SignalDetail[] = [];

  if (rsi !== null) {
    const b = (rsi >= 50 && rsi < 70) || rsi < 30;
    bullArr.push(b);
    details.push({ name: 'RSI', value: `${rsi.toFixed(1)} (${rsi >= 70 ? 'Overbought' : rsi <= 30 ? 'Oversold' : rsi >= 50 ? 'Bullish' : 'Bearish'})`, bull: b });
  }
  if (macd !== null && macdSig !== null) {
    const b = macd > macdSig; bullArr.push(b);
    details.push({ name: 'MACD', value: b ? 'Bullish crossover' : 'Bearish crossover', bull: b });
  }
  if (ind.stochK !== null) {
    const b = ind.stochK > 50; bullArr.push(b);
    details.push({ name: 'Stoch %K', value: `${ind.stochK.toFixed(1)}`, bull: b });
  }
  if (ind.cci !== null) {
    const b = ind.cci > 0; bullArr.push(b);
    details.push({ name: 'CCI', value: ind.cci.toFixed(1), bull: b });
  }
  if (ind.pctVsSMA50 !== null) {
    const b = ind.pctVsSMA50 > 0; bullArr.push(b);
    details.push({ name: 'SMA 50', value: `${b ? '+' : ''}${ind.pctVsSMA50.toFixed(1)}%`, bull: b });
  }
  if (ind.pctVsSMA200 !== null) {
    const b = ind.pctVsSMA200 > 0; bullArr.push(b);
    details.push({ name: 'SMA 200', value: `${b ? '+' : ''}${ind.pctVsSMA200.toFixed(1)}%`, bull: b });
  }

  const score = bullArr.length > 0 ? Math.round((bullArr.filter(Boolean).length / bullArr.length) * 100) : 50;
  const label: 'Bullish' | 'Neutral' | 'Bearish' = score >= 65 ? 'Bullish' : score <= 35 ? 'Bearish' : 'Neutral';
  return { score, label, details };
}

// ── Indicator Card Builder ─────────────────────────────────────────────────────
function buildIndicatorCards(ind: IndicatorResult, snap: TaapiSnap | null): { section: string; cards: IndicatorCard[] }[] {
  const rsi = snap?.rsi ?? ind.rsi;
  const macd = snap?.macd ?? ind.macd;
  const macdSig = snap?.macdSignal ?? ind.macdSignal;
  const fmt2 = (v: number) => v.toFixed(2);
  const pctSign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const oscillators: IndicatorCard[] = [];

  // RSI
  if (rsi !== null) {
    let label: string, bull: boolean | null, desc: string;
    if (rsi >= 70)      { label = 'Overbought'; bull = false; desc = `At ${rsi.toFixed(1)}, buyers are overextended. The move may be running out of steam — watch for a pullback or consolidation near this zone.`; }
    else if (rsi >= 60) { label = 'Bullish';    bull = true;  desc = `At ${rsi.toFixed(1)}, momentum is strong and bullish. The uptrend is healthy with room to continue before becoming overbought.`; }
    else if (rsi >= 50) { label = 'Mild Bullish'; bull = true; desc = `At ${rsi.toFixed(1)}, momentum leans slightly bullish. Price is above the mid-line — a positive bias, but not a strong signal on its own.`; }
    else if (rsi >= 40) { label = 'Mild Bearish'; bull = false; desc = `At ${rsi.toFixed(1)}, momentum is slightly negative. Sellers have a mild edge. Watch whether it holds above 40 or breaks lower.`; }
    else if (rsi > 30)  { label = 'Bearish';    bull = false; desc = `At ${rsi.toFixed(1)}, selling pressure is building. Approaching oversold territory — a drop below 30 would signal an extreme reading.`; }
    else                { label = 'Oversold';   bull = true;  desc = `At ${rsi.toFixed(1)}, the stock is oversold. Sellers may be exhausted and a bounce is plausible, but wait for price to turn before acting.`; }
    oscillators.push({ name: 'RSI (14)', value: rsi.toFixed(1), label, bull, desc });
  }

  // Stochastic %K
  if (ind.stochK !== null) {
    let label: string, bull: boolean | null, desc: string;
    const k = ind.stochK, d = ind.stochD;
    const cross = d !== null ? (k > d ? ' %K above %D — mild bullish signal.' : ' %K below %D — mild bearish signal.') : '';
    if (k >= 80)      { label = 'Overbought'; bull = false; desc = `At ${k.toFixed(1)}, the stochastic is overbought. Price is near the top of its recent range.${cross} A pullback is possible.`; }
    else if (k >= 50) { label = 'Bullish';    bull = true;  desc = `At ${k.toFixed(1)}, price is in the upper half of its 14-day range — a bullish tilt.${cross}`; }
    else if (k > 20)  { label = 'Bearish';    bull = false; desc = `At ${k.toFixed(1)}, price is in the lower half of its 14-day range — a bearish lean.${cross}`; }
    else              { label = 'Oversold';   bull = true;  desc = `At ${k.toFixed(1)}, the stochastic is oversold. Price is near the bottom of its recent range.${cross} A reversal setup may be forming.`; }
    oscillators.push({ name: 'Stochastic %K (14,3)', value: `${k.toFixed(1)} / ${d?.toFixed(1) ?? '–'}`, label, bull, desc });
  }

  // Williams %R
  if (ind.williamsR !== null) {
    const wr = ind.williamsR;
    let label: string, bull: boolean | null, desc: string;
    if (wr >= -20)      { label = 'Overbought'; bull = false; desc = `At ${wr.toFixed(1)}, price is near the top of its 14-day high-low range. Similar to Stochastic — readings near 0 suggest overbought conditions.`; }
    else if (wr >= -50) { label = 'Neutral/Bear'; bull = false; desc = `At ${wr.toFixed(1)}, price is in the upper-middle of its recent range. No extreme signal, but sellers have a slight edge.`; }
    else if (wr > -80)  { label = 'Neutral/Bull'; bull = true; desc = `At ${wr.toFixed(1)}, price is in the lower-middle of its recent range. No extreme signal, but buyers have a slight edge.`; }
    else                { label = 'Oversold';    bull = true; desc = `At ${wr.toFixed(1)}, price is near the bottom of its 14-day range. Readings below -80 indicate oversold conditions — watch for a bounce.`; }
    oscillators.push({ name: 'Williams %R (14)', value: wr.toFixed(1), label, bull, desc });
  }

  // CCI
  if (ind.cci !== null) {
    const c = ind.cci;
    let label: string, bull: boolean | null, desc: string;
    if (c > 200)       { label = 'Extremely Overbought'; bull = false; desc = `At ${c.toFixed(0)}, price is far above its recent average. Extreme readings like this often precede mean reversion.`; }
    else if (c > 100)  { label = 'Overbought'; bull = false; desc = `At ${c.toFixed(0)}, price is well above its typical level. The CCI signals overbought conditions — trend may be extended.`; }
    else if (c >= 0)   { label = 'Mild Bullish'; bull = true; desc = `At ${c.toFixed(0)}, price is slightly above its 20-day average. Mild bullish pressure with no extreme reading.`; }
    else if (c > -100) { label = 'Mild Bearish'; bull = false; desc = `At ${c.toFixed(0)}, price is slightly below its 20-day average. Mild bearish pressure with no extreme reading.`; }
    else if (c > -200) { label = 'Oversold'; bull = true; desc = `At ${c.toFixed(0)}, price is well below its typical level. Oversold by CCI — look for stabilization before treating as a buy signal.`; }
    else               { label = 'Extremely Oversold'; bull = true; desc = `At ${c.toFixed(0)}, price has moved extremely far below its average. Extreme oversold — high probability of mean reversion.`; }
    oscillators.push({ name: 'CCI (20)', value: c.toFixed(0), label, bull, desc });
  }

  const trend: IndicatorCard[] = [];

  // MACD
  if (macd !== null && macdSig !== null) {
    const bull = macd > macdSig;
    const hist = ind.macdHist ?? (macd - macdSig);
    const histStr = `Histogram: ${hist >= 0 ? '+' : ''}${hist.toFixed(3)}`;
    const desc = bull
      ? `MACD line (${fmt2(macd)}) is above the signal line (${fmt2(macdSig)}). This is a bullish crossover — upward momentum is currently favored. ${histStr}.`
      : `MACD line (${fmt2(macd)}) is below the signal line (${fmt2(macdSig)}). This is a bearish crossover — downward momentum is currently favored. ${histStr}.`;
    trend.push({ name: 'MACD (12, 26, 9)', value: `${fmt2(macd)} / ${fmt2(macdSig)}`, label: bull ? 'Bullish Cross' : 'Bearish Cross', bull, desc });
  }

  // vs SMA 20
  if (ind.pctVsSMA20 !== null && ind.sma20 !== null) {
    const v = ind.pctVsSMA20, bull = v > 0;
    const desc = bull
      ? `Price is ${v.toFixed(1)}% above the 20-day moving average ($${ind.sma20.toFixed(2)}). Short-term momentum is bullish. Price tends to revert to the SMA 20 over time.`
      : `Price is ${Math.abs(v).toFixed(1)}% below the 20-day moving average ($${ind.sma20.toFixed(2)}). Short-term momentum is bearish — selling pressure is dominant in the near term.`;
    trend.push({ name: 'Price vs SMA 20', value: pctSign(v), label: bull ? 'Above' : 'Below', bull, desc });
  }

  // vs SMA 50
  if (ind.pctVsSMA50 !== null && ind.sma50 !== null) {
    const v = ind.pctVsSMA50, bull = v > 0;
    const desc = bull
      ? `Price is ${v.toFixed(1)}% above the 50-day moving average ($${ind.sma50.toFixed(2)}). The medium-term trend is up. The SMA 50 often acts as a support level in an uptrend.`
      : `Price is ${Math.abs(v).toFixed(1)}% below the 50-day moving average ($${ind.sma50.toFixed(2)}). The medium-term trend is down. The SMA 50 may now act as overhead resistance.`;
    trend.push({ name: 'Price vs SMA 50', value: pctSign(v), label: bull ? 'Above' : 'Below', bull, desc });
  }

  // vs SMA 200
  if (ind.pctVsSMA200 !== null && ind.sma200 !== null) {
    const v = ind.pctVsSMA200, bull = v > 0;
    const desc = bull
      ? `Price is ${v.toFixed(1)}% above the 200-day moving average ($${ind.sma200.toFixed(2)}). This is the key long-term trend line — being above it is the hallmark of a bull market.`
      : `Price is ${Math.abs(v).toFixed(1)}% below the 200-day moving average ($${ind.sma200.toFixed(2)}). Long-term trend is bearish — many institutional investors use the 200 SMA as a dividing line.`;
    trend.push({ name: 'Price vs SMA 200', value: pctSign(v), label: bull ? 'Above' : 'Below', bull, desc });
  }

  const volatility: IndicatorCard[] = [];

  // BB %B
  if (ind.bbPctB !== null) {
    const b = ind.bbPctB;
    let label: string, bull: boolean | null, desc: string;
    if (b > 1)         { label = 'Above Upper Band'; bull = false; desc = `At ${(b * 100).toFixed(0)}%, price has broken above the upper Bollinger Band. This signals an overbought, extended move — mean reversion back toward the middle band is common.`; }
    else if (b > 0.8)  { label = 'Near Upper Band'; bull = null; desc = `At ${(b * 100).toFixed(0)}%, price is in the upper 20% of the band. Strong momentum, but approaching resistance near the upper band at $${ind.bbWidth !== null ? '–' : '–'}.`; }
    else if (b > 0.5)  { label = 'Upper Half';      bull = true; desc = `At ${(b * 100).toFixed(0)}%, price is in the upper half of the Bollinger Bands. Mild bullish positioning with room before the upper band is reached.`; }
    else if (b > 0.2)  { label = 'Lower Half';      bull = false; desc = `At ${(b * 100).toFixed(0)}%, price is in the lower half of the band. Mild bearish bias — sellers are keeping price suppressed.`; }
    else if (b >= 0)   { label = 'Near Lower Band'; bull = null; desc = `At ${(b * 100).toFixed(0)}%, price is near the lower Bollinger Band. Potential oversold support zone — watch for a bounce back toward the middle band.`; }
    else               { label = 'Below Lower Band'; bull = true; desc = `At ${(b * 100).toFixed(0)}%, price has broken below the lower Bollinger Band. Technically oversold — high probability of at least a short-term rebound.`; }
    volatility.push({ name: 'Bollinger %B (20,2)', value: `${(b * 100).toFixed(1)}%`, label, bull, desc });
  }

  // BB Width
  if (ind.bbWidth !== null) {
    const w = ind.bbWidth * 100;
    let label: string, bull: boolean | null, desc: string;
    if (w < 3)  { label = 'Squeeze'; bull = null; desc = `Band width is very tight at ${w.toFixed(1)}%. A Bollinger Squeeze often precedes a sharp breakout — the direction is unknown, but a big move could be imminent.`; }
    else if (w < 6) { label = 'Narrow'; bull = null; desc = `Band width is ${w.toFixed(1)}% — relatively tight. Low volatility environment. Watch for an expansion in width signaling the start of a trend.`; }
    else if (w < 12) { label = 'Normal'; bull = null; desc = `Band width of ${w.toFixed(1)}% is within normal range. Volatility is average — price is moving without extreme expansion or compression.`; }
    else { label = 'Wide / High Vol'; bull = null; desc = `Band width is wide at ${w.toFixed(1)}%. High volatility — price is making larger moves than usual. Wide bands often occur during strong trends or after news events.`; }
    volatility.push({ name: 'BB Width (20,2)', value: `${w.toFixed(1)}%`, label, bull, desc });
  }

  // ATR
  if (ind.atr !== null && ind.atrPct !== null) {
    const desc = `ATR measures the average daily price range. At $${ind.atr.toFixed(2)} (${ind.atrPct.toFixed(1)}% of price), expect the stock to move roughly ±$${(ind.atr / 2).toFixed(2)} from any given open on a typical day. Higher ATR = wider stop-loss needed.`;
    volatility.push({ name: 'ATR (14)', value: `$${ind.atr.toFixed(2)}`, label: `${ind.atrPct.toFixed(1)}% of price`, bull: null, desc });
  }

  const context: IndicatorCard[] = [];

  // ROC 10d
  if (ind.roc10 !== null) {
    const v = ind.roc10, bull = v > 0;
    const desc = bull
      ? `Price is up ${v.toFixed(1)}% over the last 10 sessions — strong short-term momentum. Rate of change above 0 confirms buyers have been in control.`
      : `Price is down ${Math.abs(v).toFixed(1)}% over the last 10 sessions. Negative short-term momentum — sellers have been in control over the past two weeks.`;
    context.push({ name: '10-Day Rate of Change', value: pctSign(v), label: bull ? 'Positive' : 'Negative', bull, desc });
  }

  // ROC 20d
  if (ind.roc20 !== null) {
    const v = ind.roc20, bull = v > 0;
    const desc = bull
      ? `Price is up ${v.toFixed(1)}% over the past 20 sessions (roughly one month). Positive monthly momentum — the stock has been trending higher.`
      : `Price is down ${Math.abs(v).toFixed(1)}% over the past 20 sessions. One month of negative momentum — the stock has been in a declining phase.`;
    context.push({ name: '20-Day Rate of Change', value: pctSign(v), label: bull ? 'Positive' : 'Negative', bull, desc });
  }

  // Volume vs Average
  if (ind.volRatio !== null) {
    const v = ind.volRatio;
    let label: string, bull: boolean | null, desc: string;
    if (v > 2)        { label = 'Very High Volume'; bull = null; desc = `${v.toFixed(1)}× the 20-day average volume. Unusually high activity — often associated with news events, earnings, or a strong trend confirmation.`; }
    else if (v > 1.3) { label = 'Above Average'; bull = null; desc = `${v.toFixed(1)}× average volume. Above-average participation — price moves on elevated volume are typically more meaningful and sustainable.`; }
    else if (v >= 0.7){ label = 'Normal'; bull: null; desc = `${v.toFixed(1)}× average volume. Volume is in the normal range. No unusual buying or selling activity detected in recent sessions.`; bull = null; }
    else              { label = 'Below Average'; bull = null; desc = `${v.toFixed(1)}× average volume. Low participation — price moves on thin volume are less reliable and easier to reverse.`; }
    context.push({ name: 'Volume vs 20-Day Avg', value: `${v.toFixed(2)}×`, label, bull, desc });
  }

  // 52-Week Position
  {
    const p = ind.pos52w;
    let label: string, bull: boolean | null, desc: string;
    if (p >= 90)      { label = 'Near 52W High'; bull = true;  desc = `Price is in the top ${(100 - p).toFixed(0)}% of its yearly range — near the 52-week high of $${ind.high52w.toFixed(2)}. Stocks near 52-week highs often continue to outperform.`; }
    else if (p >= 60) { label = 'Upper Range';   bull = true;  desc = `At ${p.toFixed(0)}% of the 52-week range ($${ind.low52w.toFixed(2)} – $${ind.high52w.toFixed(2)}), price is in the upper portion — above the midpoint and closer to its high.`; }
    else if (p >= 40) { label = 'Mid Range';     bull: null;   desc = `At ${p.toFixed(0)}% of the 52-week range, price is near the middle of its yearly trading band. No strong directional signal from this reading alone.`; bull = null; }
    else if (p >= 10) { label = 'Lower Range';   bull = false; desc = `At ${p.toFixed(0)}% of the 52-week range, price is in the lower portion of its yearly trading band — closer to its low of $${ind.low52w.toFixed(2)}.`; }
    else              { label = 'Near 52W Low';  bull = false; desc = `Price is in the bottom ${p.toFixed(0)}% of its yearly range — near the 52-week low of $${ind.low52w.toFixed(2)}. Could signal deep value or a prolonged downtrend — context matters.`; }
    context.push({ name: '52-Week Position', value: `${p.toFixed(0)}%`, label, bull, desc });
  }

  return [
    { section: 'Oscillators', cards: oscillators },
    { section: 'Trend', cards: trend },
    { section: 'Volatility', cards: volatility },
    { section: 'Momentum & Context', cards: context },
  ].filter(s => s.cards.length > 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${v.toLocaleString()}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function TechAnalysis() {
  const [tickerInput, setTickerInput] = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [indicators, setIndicators]   = useState<IndicatorResult | null>(null);
  const [signal, setSignal]           = useState<Signal | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [snapState, setSnapState]     = useState<TaapiSnap | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const sym = tickerInput.trim().toUpperCase();
    if (!sym) return;

    setLoading(true);
    setError('');
    setIndicators(null);
    setSignal(null);
    setDisplayName('');
    setSnapState(null);

    try {
      const cacheKey = `tech_${sym}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { ts, data } = JSON.parse(cached);
          if (Date.now() - ts < 24 * 60 * 60 * 1000) {
            setIndicators(data.indicators);
            setSignal(data.signal);
            setDisplayName(data.displayName ?? sym);
            setSnapState(data.snap ?? null);
            setLoading(false);
            return;
          }
        } catch { localStorage.removeItem(cacheKey); }
      }

      const [candles, snap] = await Promise.all([fetchOHLCV(sym), fetchTAAPI(sym)]);
      const ind = computeAllIndicators(candles);
      const sig = computeSignal(ind, snap);

      safeSetItem(cacheKey, JSON.stringify({ ts: Date.now(), data: { indicators: ind, signal: sig, displayName: sym, snap } }));

      setIndicators(ind);
      setSignal(sig);
      setDisplayName(sym);
      setSnapState(snap);
    } catch (err: any) {
      setError(err.message || 'Failed to load technical data.');
    } finally {
      setLoading(false);
    }
  };

  const cards = indicators && signal ? buildIndicatorCards(indicators, snapState) : [];

  const badgeCls = (bull: boolean | null) => {
    if (bull === true)  return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    if (bull === false) return 'bg-red-500/15 text-red-300 border border-red-500/30';
    return 'bg-slate-700/50 text-slate-400 border border-slate-600/40';
  };

  const cardBorder = (bull: boolean | null) => {
    if (bull === true)  return 'border-emerald-500/20 hover:border-emerald-500/40';
    if (bull === false) return 'border-red-500/20 hover:border-red-500/40';
    return 'border-slate-700/50 hover:border-slate-600/60';
  };

  const valueColor = (bull: boolean | null) => {
    if (bull === true)  return 'text-emerald-300';
    if (bull === false) return 'text-red-300';
    return 'text-slate-200';
  };

  return (
    <div className="max-w-5xl mx-auto py-6 space-y-6">

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="flex gap-3 max-w-xl mx-auto">
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value)}
            placeholder="Enter ticker (e.g. AAPL, MSFT, TSLA)"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-12 pr-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent uppercase transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={!tickerInput.trim() || loading}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3.5 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
        >
          <Activity className="w-4 h-4" />
          Analyze
        </button>
      </form>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-col items-center justify-center h-48 space-y-4">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 animate-pulse">Fetching price data & computing indicators…</p>
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 flex items-start gap-3 max-w-xl mx-auto">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Error loading data</p>
            <p className="text-red-400/80 text-sm mt-0.5">{error}</p>
            <p className="text-slate-500 text-xs mt-2">If this keeps happening, click <span className="text-slate-300 font-medium">Clear Cache</span> in the top-right corner and try again.</p>
          </div>
        </div>
      )}

      {/* ── About / Landing hint ─────────────────────────────────────────────── */}
      {!loading && !error && !indicators && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-6 max-w-xl mx-auto space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-300">About Technical Analysis</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Fetches 1 year of daily price data and computes 15 indicators across four categories: oscillators, trend, volatility, and momentum context. Each indicator includes a plain-English explanation of what the current reading means.
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
            {([
              ['RSI, Stochastic, Williams %R, CCI', 'Momentum oscillators — spot overbought / oversold extremes.'],
              ['MACD + SMA 20 / 50 / 200', 'Trend-following — where price stands vs. its moving averages.'],
              ['Bollinger %B + ATR', 'Volatility — how extended or compressed price movement is.'],
              ['ROC, Volume, 52-Week Position', 'Context — recent momentum, participation, and yearly range.'],
            ] as [string, string][]).map(([title, desc]) => (
              <div key={title} className="text-xs space-y-0.5">
                <p className="font-medium text-slate-300">{title}</p>
                <p className="text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      {!loading && indicators && signal && (
        <div className="space-y-6">

          {/* Header: ticker + price + 1yr change */}
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="text-2xl font-bold text-white">{displayName}</h2>
            <span className="text-xl font-semibold text-slate-200">${indicators.close.toFixed(2)}</span>
            {indicators.yearChange !== null && (
              <span className={`text-sm font-medium flex items-center gap-1 ${indicators.yearChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {indicators.yearChange >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {indicators.yearChange >= 0 ? '+' : ''}{indicators.yearChange.toFixed(2)}% (1 yr)
              </span>
            )}
          </div>

          {/* Signal Summary */}
          <div className={`rounded-xl p-4 border ${
            signal.label === 'Bullish' ? 'bg-emerald-500/5 border-emerald-500/20' :
            signal.label === 'Bearish' ? 'bg-red-500/5 border-red-500/20' :
            'bg-slate-800/50 border-slate-700/50'
          }`}>
            <div className="flex items-center flex-wrap gap-4">
              <div className="flex items-center gap-3 shrink-0">
                <div className={`w-14 h-14 rounded-full flex flex-col items-center justify-center border-2 ${
                  signal.label === 'Bullish' ? 'border-emerald-500 text-emerald-400' :
                  signal.label === 'Bearish' ? 'border-red-500 text-red-400' :
                  'border-amber-500 text-amber-400'
                }`}>
                  <span className="text-lg font-bold leading-none">{signal.score}</span>
                  <span className="text-[9px] text-slate-500 mt-0.5">/ 100</span>
                </div>
                <div>
                  <p className={`text-lg font-bold ${
                    signal.label === 'Bullish' ? 'text-emerald-400' :
                    signal.label === 'Bearish' ? 'text-red-400' : 'text-amber-400'
                  }`}>{signal.label}</p>
                  <p className="text-xs text-slate-500">Technical Signal</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {signal.details.map((d, i) => (
                  <div key={i} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${
                    d.bull === true  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' :
                    d.bull === false ? 'bg-red-500/10 border-red-500/20 text-red-300' :
                    'bg-slate-700/50 border-slate-600/50 text-slate-300'
                  }`}>
                    <span className="text-slate-400 text-xs">{d.name}:</span>
                    <span className="font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Indicator Sections */}
          {cards.map(({ section, cards: sCards }) => (
            <div key={section} className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{section}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {sCards.map((card) => (
                  <div
                    key={card.name}
                    className={`bg-slate-800/50 border rounded-xl p-4 space-y-2 transition-colors ${cardBorder(card.bull)}`}
                  >
                    {/* Name + badge row */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-slate-400 leading-tight">{card.name}</p>
                      <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap ${badgeCls(card.bull)}`}>
                        {card.label}
                      </span>
                    </div>
                    {/* Value */}
                    <p className={`text-2xl font-bold tabular-nums ${valueColor(card.bull)}`}>{card.value}</p>
                    {/* Description */}
                    <p className="text-xs text-slate-500 leading-relaxed">{card.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

        </div>
      )}
    </div>
  );
}
