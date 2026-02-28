import React, { useState, useEffect, useMemo } from 'react';
import { Plus, X, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Briefcase, BarChart2 } from 'lucide-react';

const FINNHUB_KEY = 'ctj1dchr01qgfbsvp4mgctj1dchr01qgfbsvp4n0';
const FINNHUB_URL = 'https://finnhub.io/api/v1';
const NINJAS_KEY = 'B6w1uEBi5PI0NJkm84RzikQ5qH4IC2fsZP1ejSvJ';
const NINJAS_BASE = 'https://api.api-ninjas.com/v1';
const PROFILE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days — sector rarely changes

interface Holding {
  symbol: string;
  shares: number;
  costBasis?: number; // per share cost basis
}

interface HoldingData extends Holding {
  name: string;
  price: number;
  prevClose: number;
  sector: string;
  value: number;
  dayChange: number;
  dayChangePct: number;
  gain?: number;
  gainPct?: number;
  weight: number;
}

const safeJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  if (!text || text.trim().startsWith('<')) return {};
  try { return JSON.parse(text); } catch { return {}; }
};

const PORTFOLIO_KEY = 'portfolio_holdings_v1';

const fmtVal = (v: number) => {
  const neg = v < 0;
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `$${(abs / 1e3).toFixed(1)}K` : `$${abs.toFixed(2)}`;
  return neg ? `-${s}` : s;
};

function DiversificationGrade({ sectors }: { sectors: string[] }) {
  const unique = new Set(sectors.filter(Boolean)).size;
  const grade = unique >= 6 ? 'A' : unique >= 4 ? 'B' : unique >= 2 ? 'C' : 'D';
  const color = grade === 'A' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : grade === 'B' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10'
    : grade === 'C' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : 'text-red-400 border-red-500/30 bg-red-500/10';
  const desc = grade === 'A' ? 'Well diversified' : grade === 'B' ? 'Moderately diversified'
    : grade === 'C' ? 'Limited diversification' : 'Concentrated portfolio';
  return (
    <div className={`border rounded-xl p-4 ${color}`}>
      <div className="text-xs text-slate-400 mb-1">Diversification</div>
      <div className="text-2xl font-bold">{grade}</div>
      <div className="text-xs mt-0.5 opacity-80">{desc} · {unique} sector{unique !== 1 ? 's' : ''}</div>
    </div>
  );
}

export default function PortfolioTracker() {
  const [holdings, setHoldings] = useState<Holding[]>(() => {
    try {
      const saved = localStorage.getItem(PORTFOLIO_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [priceData, setPriceData] = useState<Record<string, any>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const [showAnalysis, setShowAnalysis] = useState(false);

  // Add holding form
  const [addSymbol, setAddSymbol] = useState('');
  const [addShares, setAddShares] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addError, setAddError] = useState('');

  // Persist holdings to localStorage
  useEffect(() => {
    try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(holdings)); } catch { /* skip */ }
  }, [holdings]);

  const addHolding = (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    const sym = addSymbol.trim().toUpperCase();
    const shares = parseFloat(addShares);
    const cost = addCost ? parseFloat(addCost) : undefined;

    if (!sym) { setAddError('Enter a ticker symbol.'); return; }
    if (isNaN(shares) || shares <= 0) { setAddError('Enter a valid number of shares.'); return; }
    if (holdings.find(h => h.symbol === sym)) { setAddError(`${sym} is already in your portfolio.`); return; }
    if (holdings.length >= 20) { setAddError('Max 20 holdings per portfolio.'); return; }

    setHoldings(prev => [...prev, { symbol: sym, shares, costBasis: cost }]);
    setAddSymbol('');
    setAddShares('');
    setAddCost('');
  };

  const removeHolding = (sym: string) => {
    setHoldings(prev => prev.filter(h => h.symbol !== sym));
    setPriceData(prev => { const next = { ...prev }; delete next[sym]; return next; });
  };

  const fetchPrices = async () => {
    if (holdings.length === 0) return;
    setLoadingPrices(true);
    setFetchError('');
    try {
      const results = await Promise.all(
        holdings.map(async (h) => {
          // API Ninjas for current price — no rate limit issues
          const priceRes = await fetch(`${NINJAS_BASE}/stockprice?ticker=${h.symbol}`, {
            headers: { 'X-Api-Key': NINJAS_KEY },
          }).catch(() => null);
          const priceData = priceRes ? await safeJson(priceRes).catch(() => ({})) : {};
          const price = typeof priceData?.price === 'number' ? priceData.price : 0;
          const prevClose = 0; // free tier doesn't provide prev close
          let name = h.symbol; // name is premium-only on API Ninjas

          // Finnhub profile2 for sector — cached 7 days
          const profileKey = `portfolio_profile_${h.symbol}_v1`;
          let sector = '';
          const cachedProfile = localStorage.getItem(profileKey);
          if (cachedProfile) {
            try {
              const { ts, d } = JSON.parse(cachedProfile);
              if (Date.now() - ts < PROFILE_TTL) { sector = d.sector; if (d.name && name === h.symbol) name = d.name; }
              else localStorage.removeItem(profileKey);
            } catch { localStorage.removeItem(profileKey); }
          }
          if (!sector) {
            const profileRes = await fetch(`${FINNHUB_URL}/stock/profile2?symbol=${h.symbol}&token=${FINNHUB_KEY}`).catch(() => null);
            if (profileRes) {
              const p = await safeJson(profileRes).catch(() => ({}));
              sector = p.finnhubIndustry ?? '';
              if (p.name && name === h.symbol) name = p.name;
              try { localStorage.setItem(profileKey, JSON.stringify({ ts: Date.now(), d: { sector, name } })); } catch { /* skip */ }
            }
          }

          return { symbol: h.symbol, price, prevClose, name, sector };
        })
      );
      const map: Record<string, any> = {};
      results.forEach(r => { map[r.symbol] = r; });
      setPriceData(map);
    } catch (e: any) {
      setFetchError('Failed to fetch prices. Please try again.');
    } finally {
      setLoadingPrices(false);
    }
  };

  const enriched: HoldingData[] = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => {
      const pd = priceData[h.symbol];
      return sum + (pd ? pd.price * h.shares : 0);
    }, 0);

    return holdings.map(h => {
      const pd = priceData[h.symbol];
      const price = pd?.price ?? 0;
      const prevClose = pd?.prevClose ?? 0;
      const value = price * h.shares;
      const dayChange = prevClose > 0 ? (price - prevClose) * h.shares : 0;
      const dayChangePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      const gain = h.costBasis != null ? (price - h.costBasis) * h.shares : undefined;
      const gainPct = h.costBasis != null && h.costBasis > 0 ? ((price - h.costBasis) / h.costBasis) * 100 : undefined;
      return {
        ...h,
        name: pd?.name ?? h.symbol,
        price,
        prevClose,
        sector: pd?.sector ?? '',
        value,
        dayChange,
        dayChangePct,
        gain,
        gainPct,
        weight: totalValue > 0 ? (value / totalValue) * 100 : 0,
      };
    });
  }, [holdings, priceData]);

  const totalValue = enriched.reduce((s, h) => s + h.value, 0);
  const totalDayChange = enriched.reduce((s, h) => s + h.dayChange, 0);
  const totalDayChangePct = totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0;
  const totalGain = enriched.reduce((s, h) => s + (h.gain ?? 0), 0);
  const hasCostBasis = enriched.some(h => h.costBasis != null);
  const hasPrices = Object.keys(priceData).length > 0;

  const sectors = enriched.map(h => h.sector);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Portfolio Tracker</h2>
        <p className="text-slate-400 text-sm">Build your portfolio, track value, weights, and P&amp;L. Holdings are saved in your browser.</p>
      </div>

      {/* Add Holding Form */}
      <form onSubmit={addHolding} className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-slate-300">Add a holding</p>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[100px] max-w-[140px]">
            <input
              value={addSymbol}
              onChange={e => setAddSymbol(e.target.value)}
              placeholder="Ticker"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
              maxLength={10}
            />
          </div>
          <div className="relative flex-1 min-w-[100px] max-w-[140px]">
            <input
              type="number"
              value={addShares}
              onChange={e => setAddShares(e.target.value)}
              placeholder="Shares"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              min="0.0001"
              step="any"
            />
          </div>
          <div className="relative flex-1 min-w-[120px] max-w-[160px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              value={addCost}
              onChange={e => setAddCost(e.target.value)}
              placeholder="Cost basis (opt.)"
              className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              min="0"
              step="any"
            />
          </div>
          <button type="submit"
            className="flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        {addError && <p className="text-red-400 text-xs">{addError}</p>}
        <p className="text-xs text-slate-600">Cost basis per share is optional — used to calculate unrealized P&amp;L.</p>
      </form>

      {holdings.length === 0 ? (
        <div className="text-center py-10 text-slate-500 space-y-2">
          <Briefcase className="w-10 h-10 mx-auto opacity-30" />
          <p className="text-sm">Your portfolio is empty. Add holdings above to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Refresh Prices Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={fetchPrices}
              disabled={loadingPrices}
              className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <RefreshCw className={`w-4 h-4 ${loadingPrices ? 'animate-spin' : ''}`} />
              {loadingPrices ? 'Refreshing...' : 'Refresh Prices'}
            </button>
            {hasPrices && <span className="text-xs text-slate-500">{holdings.length} holding{holdings.length !== 1 ? 's' : ''}</span>}
          </div>

          {fetchError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-red-400/80 text-sm">{fetchError}</p>
            </div>
          )}

          {/* Summary Cards */}
          {hasPrices && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Total Value</div>
                <div className="text-xl font-bold text-white">{fmtVal(totalValue)}</div>
              </div>
              <div className={`border rounded-xl p-4 ${totalDayChange >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                <div className="text-xs text-slate-400 mb-1">Today's Change</div>
                <div className={`text-xl font-bold ${totalDayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {totalDayChange >= 0 ? '+' : ''}{fmtVal(totalDayChange)}
                </div>
                <div className={`text-xs mt-0.5 ${totalDayChange >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                  {totalDayChangePct >= 0 ? '+' : ''}{totalDayChangePct.toFixed(2)}%
                </div>
              </div>
              {hasCostBasis && (
                <div className={`border rounded-xl p-4 ${totalGain >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                  <div className="text-xs text-slate-400 mb-1">Unrealized P&amp;L</div>
                  <div className={`text-xl font-bold ${totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalGain >= 0 ? '+' : ''}{fmtVal(totalGain)}
                  </div>
                </div>
              )}
              <DiversificationGrade sectors={sectors} />
            </div>
          )}

          {/* Holdings Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-700/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Ticker</th>
                  <th className="text-right px-4 py-3 font-medium">Shares</th>
                  {hasPrices && <th className="text-right px-4 py-3 font-medium">Price</th>}
                  {hasPrices && <th className="text-right px-4 py-3 font-medium">Value</th>}
                  {hasPrices && <th className="text-right px-4 py-3 font-medium">Weight</th>}
                  {hasPrices && <th className="text-right px-4 py-3 font-medium">Day Chg</th>}
                  {hasCostBasis && hasPrices && <th className="text-right px-4 py-3 font-medium">P&amp;L</th>}
                  <th className="text-center px-4 py-3 font-medium">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {enriched.map((h, i) => (
                  <tr key={h.symbol} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-indigo-500/15 rounded-lg flex items-center justify-center text-xs font-bold text-indigo-400">
                          {h.symbol[0]}
                        </div>
                        <div>
                          <div className="text-white font-medium">{h.symbol}</div>
                          {h.name !== h.symbol && <div className="text-slate-500 text-xs truncate max-w-[120px]">{h.name}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{h.shares.toLocaleString()}</td>
                    {hasPrices && (
                      <td className="px-4 py-3 text-right text-slate-200">
                        {h.price > 0 ? `$${h.price.toFixed(2)}` : <span className="text-slate-600 text-xs">—</span>}
                        {h.costBasis != null && h.price > 0 && (
                          <div className="text-xs text-slate-500">basis ${ h.costBasis.toFixed(2)}</div>
                        )}
                      </td>
                    )}
                    {hasPrices && (
                      <td className="px-4 py-3 text-right text-white font-semibold">
                        {h.value > 0 ? fmtVal(h.value) : '—'}
                      </td>
                    )}
                    {hasPrices && (
                      <td className="px-4 py-3 text-right">
                        {h.value > 0 && (
                          <>
                            <div className="text-slate-300 font-medium">{h.weight.toFixed(1)}%</div>
                            <div className="mt-0.5 h-1 bg-slate-700 rounded-full overflow-hidden w-16 ml-auto">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${h.weight}%` }} />
                            </div>
                          </>
                        )}
                      </td>
                    )}
                    {hasPrices && (
                      <td className={`px-4 py-3 text-right font-medium ${h.dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {h.price > 0 ? (
                          <>
                            <div>{h.dayChange >= 0 ? '+' : ''}{fmtVal(h.dayChange)}</div>
                            <div className="text-xs opacity-70">{h.dayChangePct >= 0 ? '+' : ''}{h.dayChangePct.toFixed(2)}%</div>
                          </>
                        ) : '—'}
                      </td>
                    )}
                    {hasCostBasis && hasPrices && (
                      <td className={`px-4 py-3 text-right font-medium ${(h.gain ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {h.gain != null && h.price > 0 ? (
                          <>
                            <div>{h.gain >= 0 ? '+' : ''}{fmtVal(h.gain)}</div>
                            <div className="text-xs opacity-70">{(h.gainPct ?? 0) >= 0 ? '+' : ''}{(h.gainPct ?? 0).toFixed(1)}%</div>
                          </>
                        ) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => removeHolding(h.symbol)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center mx-auto text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!hasPrices && (
            <p className="text-slate-500 text-xs text-center">Click <span className="text-slate-300">Refresh Prices</span> to fetch current market prices for all holdings.</p>
          )}

          {/* Analyze Portfolio Button */}
          {hasPrices && enriched.length > 0 && (
            <button
              onClick={() => setShowAnalysis(prev => !prev)}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border border-slate-600">
              <BarChart2 className="w-4 h-4" />
              {showAnalysis ? 'Hide Analysis' : 'Analyze Portfolio'}
            </button>
          )}

          {/* Portfolio Analysis Panel */}
          {hasPrices && showAnalysis && (() => {
            // Sector allocation
            const sectorMap: Record<string, { weight: number; value: number; holdings: string[] }> = {};
            enriched.forEach(h => {
              const s = h.sector || 'Unknown / Other';
              if (!sectorMap[s]) sectorMap[s] = { weight: 0, value: 0, holdings: [] };
              sectorMap[s].weight += h.weight;
              sectorMap[s].value += h.value;
              sectorMap[s].holdings.push(h.symbol);
            });
            const sectorList = Object.entries(sectorMap).sort((a, b) => b[1].weight - a[1].weight);

            // Concentration risk
            const topHolding = enriched.reduce((max, h) => h.weight > max.weight ? h : max, enriched[0]);
            const topSector = sectorList[0];
            const isConcentrated = topHolding.weight > 30;
            const isSectorConcentrated = topSector[1].weight > 50 && sectorList.length > 1;
            const uniqueSectors = sectorList.length;

            // Insights
            const insights: Array<{ type: 'warning' | 'good' | 'info'; text: string }> = [];
            if (isConcentrated) insights.push({ type: 'warning', text: `${topHolding.symbol} makes up ${topHolding.weight.toFixed(1)}% of the portfolio. A single position above 30% adds significant concentration risk.` });
            if (isSectorConcentrated) insights.push({ type: 'warning', text: `${topSector[0]} accounts for ${topSector[1].weight.toFixed(1)}% of value. High sector concentration increases correlated downside risk.` });
            if (uniqueSectors >= 5) insights.push({ type: 'good', text: `Portfolio spans ${uniqueSectors} sectors — good diversification reduces sector-specific risk.` });
            if (uniqueSectors <= 2) insights.push({ type: 'warning', text: `Portfolio is concentrated in only ${uniqueSectors} sector${uniqueSectors === 1 ? '' : 's'}. Consider adding stocks from other industries.` });
            if (enriched.length >= 10) insights.push({ type: 'good', text: `${enriched.length} holdings provides reasonable position diversification.` });
            if (enriched.length <= 3) insights.push({ type: 'info', text: `${enriched.length} holdings is a concentrated portfolio. Returns may be amplified in both directions.` });
            const hasIntl = enriched.some(h => !h.sector); // rough proxy
            if (enriched.length >= 5 && uniqueSectors >= 3) insights.push({ type: 'info', text: 'Consider adding international exposure or fixed-income ETFs to further reduce correlation.' });

            const bgColor = (type: string) => type === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : type === 'good' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-slate-700/60 border-slate-600/50 text-slate-300';
            const sectorColors = ['bg-indigo-500', 'bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-orange-500', 'bg-cyan-500', 'bg-rose-500', 'bg-amber-500', 'bg-teal-500', 'bg-pink-500'];

            return (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-5 space-y-6">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-indigo-400" />
                  Portfolio Analysis
                </h3>

                {/* Sector Allocation */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-slate-300">Sector Allocation</h4>
                  <div className="space-y-2">
                    {sectorList.map(([sector, data], i) => (
                      <div key={sector} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-sm ${sectorColors[i % sectorColors.length]}`} />
                            <span className="text-slate-300">{sector}</span>
                            <span className="text-slate-500 text-xs">({data.holdings.join(', ')})</span>
                          </div>
                          <span className="text-white font-semibold">{data.weight.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${sectorColors[i % sectorColors.length]}`}
                            style={{ width: `${data.weight}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top Positions */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-slate-300">Top Positions by Weight</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {enriched.sort((a, b) => b.weight - a.weight).slice(0, 6).map(h => (
                      <div key={h.symbol} className="bg-slate-700/50 rounded-lg p-3">
                        <div className="flex justify-between items-start">
                          <span className="text-white font-semibold text-sm">{h.symbol}</span>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${h.weight > 25 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600 text-slate-400'}`}>
                            {h.weight.toFixed(1)}%
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">{h.sector || '—'}</div>
                        <div className="text-xs text-slate-400 mt-1">{fmtVal(h.value)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Insights */}
                {insights.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-slate-300">Insights</h4>
                    <div className="space-y-2">
                      {insights.map((ins, i) => (
                        <div key={i} className={`border rounded-lg px-3 py-2.5 text-xs leading-relaxed ${bgColor(ins.type)}`}>
                          <span className="font-medium mr-1">{ins.type === 'warning' ? '⚠' : ins.type === 'good' ? '✓' : 'ℹ'}</span>
                          {ins.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Stats */}
                <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-700">
                  <div className="text-center">
                    <div className="text-xl font-bold text-white">{enriched.length}</div>
                    <div className="text-xs text-slate-400">Holdings</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-white">{uniqueSectors}</div>
                    <div className="text-xs text-slate-400">Sectors</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-xl font-bold ${topHolding.weight > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {topHolding.weight.toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-400">Largest Position</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
