import React, { useState } from 'react';
import { Search, AlertCircle, TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react';

const NINJAS_KEY = 'B6w1uEBi5PI0NJkm84RzikQ5qH4IC2fsZP1ejSvJ';
const NINJAS_BASE = 'https://api.api-ninjas.com/v1';

const safeJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  if (!text || text.trim().startsWith('<')) throw new Error('API returned an error page.');
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) throw new Error(parsed.error);
    return parsed;
  } catch (e: any) {
    if (e.message && !e.message.startsWith('JSON')) throw e;
    throw new Error('Invalid response from API.');
  }
};

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      Object.keys(localStorage)
        .filter(k => k.startsWith('finnhub_') || k.startsWith('valuwise_') || k.startsWith('tech_') || k.startsWith('earnings_') || k.startsWith('insider_') || k.startsWith('news_') || k.startsWith('dividend_'))
        .forEach(k => localStorage.removeItem(k));
      try { localStorage.setItem(key, value); } catch { /* skip */ }
    }
  }
}

const fmtRev = (v: number | null) => {
  if (v == null || v === 0) return '—';
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
};

const fmtDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtQuarter = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
};

export default function EarningsEstimates() {
  const [input, setInput] = useState('');
  const [sym, setSym] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  const fetchData = async (symbol: string) => {
    setLoading(true);
    setError('');
    try {
      const cacheKey = `earnings_${symbol}_v3`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { ts, d } = JSON.parse(cached);
          if (Date.now() - ts < 6 * 60 * 60 * 1000) { setData(d); return; }
        } catch { localStorage.removeItem(cacheKey); }
      }

      const [histRes, upcomingRes] = await Promise.all([
        fetch(`${NINJAS_BASE}/earningscalendar?ticker=${symbol}`, { headers: { 'X-Api-Key': NINJAS_KEY } }),
        fetch(`${NINJAS_BASE}/upcomingearnings?ticker=${symbol}`, { headers: { 'X-Api-Key': NINJAS_KEY } }),
      ]);

      const [histRaw, upcomingRaw] = await Promise.all([
        safeJson(histRes).catch(() => []),
        safeJson(upcomingRes).catch(() => []),
      ]);

      // Historical: past quarters with actual vs estimated
      const history = (Array.isArray(histRaw) ? histRaw : [])
        .filter((r: any) => r.actual_eps != null)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Upcoming: next scheduled earnings event for this ticker
      const upcoming = (Array.isArray(upcomingRaw) ? upcomingRaw : [])
        .find((r: any) => r.ticker?.toUpperCase() === symbol.toUpperCase()) ?? null;

      if (!history.length && !upcoming) {
        throw new Error(`No earnings data found for ${symbol}. Ensure it is a US-listed ticker with analyst coverage.`);
      }

      const d = { history, upcoming };
      safeSetItem(cacheKey, JSON.stringify({ ts: Date.now(), d }));
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch earnings data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (s) { setSym(s); fetchData(s); }
  };

  const SurpriseBadge = ({ pct }: { pct: number }) => {
    if (Math.abs(pct) < 0.5) return <span className="text-slate-400 text-xs flex items-center gap-1"><Minus className="w-3 h-3" />In-line</span>;
    if (pct > 0) return <span className="text-emerald-400 text-xs flex items-center gap-1"><TrendingUp className="w-3 h-3" />+{pct.toFixed(1)}%</span>;
    return <span className="text-red-400 text-xs flex items-center gap-1"><TrendingDown className="w-3 h-3" />{pct.toFixed(1)}%</span>;
  };

  const beats = data?.history.filter((r: any) => {
    const spct = r.estimated_eps ? ((r.actual_eps - r.estimated_eps) / Math.abs(r.estimated_eps)) * 100 : 0;
    return spct > 0.5;
  }).length ?? 0;
  const misses = data?.history.filter((r: any) => {
    const spct = r.estimated_eps ? ((r.actual_eps - r.estimated_eps) / Math.abs(r.estimated_eps)) * 100 : 0;
    return spct < -0.5;
  }).length ?? 0;
  const total = data?.history.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Earnings Estimates</h2>
        <p className="text-slate-400 text-sm">Recent EPS results, surprise history, and next earnings date.</p>
      </div>

      <form onSubmit={handleSearch} className="max-w-xl relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter ticker (e.g. AAPL, MSFT)"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-12 pr-28 py-4 text-base focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent uppercase transition-all"
        />
        <button type="submit" disabled={!input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-cyan-500 hover:bg-cyan-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Analyze
        </button>
      </form>

      {loading && (
        <div className="flex items-center gap-3 py-8">
          <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400">Loading earnings data...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex gap-3 max-w-xl">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Error</p>
            <p className="text-red-400/70 text-sm mt-0.5">{error}</p>
            <p className="text-slate-500 text-xs mt-1.5">If this keeps happening, click <span className="text-slate-300 font-medium">Clear Cache</span> in the sidebar and try again.</p>
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-8">
          {/* Next Earnings */}
          {data.upcoming && (
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-5 flex items-start gap-4">
              <Calendar className="w-6 h-6 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs text-cyan-400/70 uppercase tracking-wide mb-1 font-medium">Next Earnings</div>
                <div className="text-xl font-bold text-white">{fmtDate(data.upcoming.date)}</div>
                <div className="flex gap-6 mt-2 text-sm text-slate-400">
                  {data.upcoming.eps_estimated != null && (
                    <span>EPS Est. <span className="text-white font-semibold">${data.upcoming.eps_estimated.toFixed(2)}</span></span>
                  )}
                  {data.upcoming.revenue_estimated != null && (
                    <span>Rev. Est. <span className="text-white font-semibold">{fmtRev(data.upcoming.revenue_estimated)}</span></span>
                  )}
                  {data.upcoming.exchange && (
                    <span className="text-slate-600">{data.upcoming.exchange}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Beat/Miss Summary */}
          {total > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">{beats}</div>
                <div className="text-xs text-slate-400 mt-0.5">Beats</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{misses}</div>
                <div className="text-xs text-slate-400 mt-0.5">Misses</div>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-white">{total > 0 ? ((beats / total) * 100).toFixed(0) : '0'}%</div>
                <div className="text-xs text-slate-400 mt-0.5">Beat Rate</div>
              </div>
            </div>
          )}

          {/* EPS Surprise History */}
          {data.history.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-slate-200">{sym} — EPS Results & Surprise History</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-3 font-medium">Period</th>
                      <th className="text-right px-4 py-3 font-medium">Actual EPS</th>
                      <th className="text-right px-4 py-3 font-medium">Est. EPS</th>
                      <th className="text-right px-4 py-3 font-medium">Actual Rev.</th>
                      <th className="text-right px-4 py-3 font-medium">Est. Rev.</th>
                      <th className="text-right px-4 py-3 font-medium">Surprise %</th>
                      <th className="text-center px-4 py-3 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.history.map((r: any, i: number) => {
                      const spct = r.estimated_eps ? ((r.actual_eps - r.estimated_eps) / Math.abs(r.estimated_eps)) * 100 : 0;
                      const beat = spct > 0.5;
                      const miss = spct < -0.5;
                      return (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 text-slate-300 font-medium">{fmtQuarter(r.date)}</td>
                          <td className="px-4 py-3 text-right text-white font-semibold">
                            {r.actual_eps != null ? `$${r.actual_eps.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {r.estimated_eps != null ? `$${r.estimated_eps.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">{fmtRev(r.actual_revenue)}</td>
                          <td className="px-4 py-3 text-right text-slate-500">{fmtRev(r.estimated_revenue)}</td>
                          <td className="px-4 py-3 text-right">
                            {r.estimated_eps != null ? <SurpriseBadge pct={spct} /> : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${beat ? 'bg-emerald-500/15 text-emerald-400' : miss ? 'bg-red-500/15 text-red-400' : 'bg-slate-700 text-slate-400'}`}>
                              {beat ? 'Beat' : miss ? 'Miss' : 'In-line'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-600">Showing {data.history.length} most recent quarters. Data via API Ninjas.</p>
            </div>
          )}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="max-w-xl bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-2">
          <p className="text-sm font-medium text-slate-300">What you'll see here</p>
          <ul className="space-y-1.5 text-xs text-slate-500">
            <li className="flex items-start gap-2"><span className="text-cyan-500 mt-0.5">•</span>Next scheduled earnings date with estimated EPS and revenue</li>
            <li className="flex items-start gap-2"><span className="text-cyan-500 mt-0.5">•</span>Historical EPS surprise — Beat/Miss/In-line vs. consensus</li>
            <li className="flex items-start gap-2"><span className="text-cyan-500 mt-0.5">•</span>Actual vs. estimated revenue per quarter</li>
            <li className="flex items-start gap-2"><span className="text-cyan-500 mt-0.5">•</span>Beat rate summary across recent quarters</li>
          </ul>
        </div>
      )}
    </div>
  );
}
