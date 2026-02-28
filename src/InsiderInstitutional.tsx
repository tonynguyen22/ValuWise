import React, { useState } from 'react';
import { Search, AlertCircle, TrendingUp, TrendingDown, Eye } from 'lucide-react';

const API_KEY = 'ctj1dchr01qgfbsvp4mgctj1dchr01qgfbsvp4n0';
const BASE_URL = 'https://finnhub.io/api/v1';

const safeJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  if (!text || text.trim().startsWith('<')) throw new Error('Finnhub returned an error page. This endpoint may not be available on the free plan or the ticker has no data.');
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) throw new Error(`Finnhub: ${parsed.error}`);
    return parsed;
  } catch (e: any) {
    if (e.message?.startsWith('Finnhub:')) throw e;
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

const fmtDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtNum = (n: number) => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`;
  return `$${abs.toFixed(0)}`;
};

const TRANS_CODE_LABELS: Record<string, string> = {
  P: 'Purchase',
  S: 'Sale',
  A: 'Award/Grant',
  D: 'Sale to Issuer',
  F: 'Tax Withholding',
  I: 'Discretionary Tx',
  M: 'Option Exercise',
  C: 'Conversion',
  W: 'Will/Inheritance',
  X: 'Option Exercise',
  G: 'Gift',
};

export default function InsiderInstitutional() {
  const [input, setInput] = useState('');
  const [sym, setSym] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  const getDateRange = () => {
    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    return {
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
    };
  };

  const fetchData = async (symbol: string) => {
    setLoading(true);
    setError('');
    try {
      const cacheKey = `insider_${symbol}_v1`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { ts, d } = JSON.parse(cached);
          if (Date.now() - ts < 6 * 60 * 60 * 1000) { setData(d); return; }
        } catch { localStorage.removeItem(cacheKey); }
      }

      const { from, to } = getDateRange();
      const [insiderRes, ownerRes, sentRes] = await Promise.all([
        fetch(`${BASE_URL}/stock/insider-transactions?symbol=${symbol}&from=${from}&to=${to}&token=${API_KEY}`),
        fetch(`${BASE_URL}/stock/ownership?symbol=${symbol}&limit=10&token=${API_KEY}`),
        fetch(`${BASE_URL}/stock/insider-sentiment?symbol=${symbol}&from=${from}&to=${to}&token=${API_KEY}`),
      ]);
      // ownerRes may fail on free tier — handle gracefully
      const [insiderData, sentData] = await Promise.all([
        safeJson(insiderRes), safeJson(sentRes).catch(() => ({})),
      ]);
      const ownerData = await safeJson(ownerRes).catch(() => ({}));

      const transactions = (insiderData.data || [])
        .filter((t: any) => !t.isDerivative)
        .sort((a: any, b: any) => new Date(b.transactionDate || b.filingDate).getTime() - new Date(a.transactionDate || a.filingDate).getTime())
        .slice(0, 30);

      const institutions = ownerData.ownership || [];
      const sentiment = sentData.data || [];

      if (!transactions.length && !institutions.length) {
        throw new Error('No insider or institutional data found for this ticker.');
      }

      const d = { transactions, institutions, sentiment };
      safeSetItem(cacheKey, JSON.stringify({ ts: Date.now(), d }));
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch insider data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (s) { setSym(s); fetchData(s); }
  };

  const netBuySell = data?.transactions
    ? data.transactions.reduce((acc: { buy: number; sell: number }, t: any) => {
        const shares = Math.abs(t.change ?? t.share ?? 0);
        if (t.transactionCode === 'P') acc.buy += shares;
        else if (t.transactionCode === 'S' || t.transactionCode === 'D') acc.sell += shares;
        return acc;
      }, { buy: 0, sell: 0 })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Insider &amp; Institutional</h2>
        <p className="text-slate-400 text-sm">Recent insider transactions and top institutional holders.</p>
      </div>

      <form onSubmit={handleSearch} className="max-w-xl relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter ticker (e.g. AAPL, MSFT)"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-12 pr-28 py-4 text-base focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent uppercase transition-all"
        />
        <button type="submit" disabled={!input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Analyze
        </button>
      </form>

      {loading && (
        <div className="flex items-center gap-3 py-8">
          <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400">Loading insider data...</span>
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
          {/* Summary Cards */}
          {netBuySell && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Insider Buys (12mo)</div>
                <div className="text-xl font-bold text-emerald-400 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4" />
                  {netBuySell.buy.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">shares purchased</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Insider Sales (12mo)</div>
                <div className="text-xl font-bold text-red-400 flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4" />
                  {netBuySell.sell.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">shares sold</div>
              </div>
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Total Transactions</div>
                <div className="text-xl font-bold text-white">{data.transactions.length}</div>
                <div className="text-xs text-slate-500 mt-0.5">last 12 months</div>
              </div>
              <div className={`border rounded-xl p-4 ${netBuySell.buy > netBuySell.sell ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                <div className="text-xs text-slate-400 mb-1">Net Sentiment</div>
                <div className={`text-xl font-bold flex items-center gap-1.5 ${netBuySell.buy > netBuySell.sell ? 'text-emerald-400' : 'text-red-400'}`}>
                  {netBuySell.buy > netBuySell.sell ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {netBuySell.buy > netBuySell.sell ? 'Buying' : 'Selling'}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">insider activity</div>
              </div>
            </div>
          )}

          {/* Insider Transactions */}
          {data.transactions.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-slate-200">{sym} — Recent Insider Transactions (last 12 months)</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-3 font-medium">Date</th>
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-center px-4 py-3 font-medium">Type</th>
                      <th className="text-right px-4 py-3 font-medium">Shares</th>
                      <th className="text-right px-4 py-3 font-medium">Price</th>
                      <th className="text-right px-4 py-3 font-medium">Est. Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.transactions.map((t: any, i: number) => {
                      const isBuy = t.transactionCode === 'P';
                      const isSell = t.transactionCode === 'S' || t.transactionCode === 'D';
                      const shares = Math.abs(t.change ?? t.share ?? 0);
                      const value = t.transactionPrice && shares ? t.transactionPrice * shares : null;
                      const label = TRANS_CODE_LABELS[t.transactionCode] ?? t.transactionCode ?? '—';
                      return (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{fmtDate(t.transactionDate || t.filingDate)}</td>
                          <td className="px-4 py-3 text-slate-200 max-w-[180px] truncate">{t.name || '—'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${isBuy ? 'bg-emerald-500/15 text-emerald-400' : isSell ? 'bg-red-500/15 text-red-400' : 'bg-slate-700 text-slate-400'}`}>
                              {label}
                            </span>
                          </td>
                          <td className={`px-4 py-3 text-right font-medium ${isBuy ? 'text-emerald-400' : isSell ? 'text-red-400' : 'text-slate-300'}`}>
                            {shares > 0 ? shares.toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {t.transactionPrice ? `$${t.transactionPrice.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {value ? fmtNum(value) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Institutional Ownership */}
          {data.institutions.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-base font-semibold text-slate-200">{sym} — Top Institutional Holders</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-3 font-medium">Institution</th>
                      <th className="text-right px-4 py-3 font-medium">Shares</th>
                      <th className="text-right px-4 py-3 font-medium">% Ownership</th>
                      <th className="text-right px-4 py-3 font-medium">Change</th>
                      <th className="text-right px-4 py-3 font-medium">Report Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.institutions.map((inst: any, i: number) => {
                      const change = inst.change ?? 0;
                      return (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3 text-slate-200 max-w-[220px] truncate">{inst.name || '—'}</td>
                          <td className="px-4 py-3 text-right text-slate-300">{inst.share ? inst.share.toLocaleString() : '—'}</td>
                          <td className="px-4 py-3 text-right text-white font-medium">
                            {inst.ownershipPercent != null ? `${inst.ownershipPercent.toFixed(2)}%` : '—'}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                            {change !== 0 ? `${change > 0 ? '+' : ''}${change.toLocaleString()}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-400 text-xs">{fmtDate(inst.reportDate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 max-w-xl">
              <Eye className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-medium text-sm">Institutional Ownership Unavailable</p>
                <p className="text-slate-400 text-xs mt-1">Detailed institutional ownership data may require a Finnhub premium plan. Insider transaction data is shown above.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="max-w-xl bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-2">
          <p className="text-sm font-medium text-slate-300">What you'll see here</p>
          <ul className="space-y-1.5 text-xs text-slate-500">
            <li className="flex items-start gap-2"><span className="text-orange-500 mt-0.5">•</span>Recent insider transactions — purchases, sales, and grants over the last 12 months</li>
            <li className="flex items-start gap-2"><span className="text-orange-500 mt-0.5">•</span>Net insider sentiment — whether insiders are net buyers or sellers</li>
            <li className="flex items-start gap-2"><span className="text-orange-500 mt-0.5">•</span>Top institutional holders by ownership percentage (where available)</li>
          </ul>
        </div>
      )}
    </div>
  );
}
