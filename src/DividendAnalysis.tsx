import React, { useState } from 'react';
import { Search, AlertCircle, TrendingUp, TrendingDown, Shield, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const FINNHUB_KEY = 'ctj1dchr01qgfbsvp4mgctj1dchr01qgfbsvp4n0';
const FINNHUB_URL = 'https://finnhub.io/api/v1';
const MASSIVE_KEY = 'M8zhNduoGphylrTzDQwdpDqz1E35B7Qx';
const MASSIVE_DIV_URL = 'https://api.massive.com/stocks/v1/dividends';

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

const computeCagr = (payments: any[], years: number) => {
  if (!payments || payments.length < 2) return null;
  const sorted = [...payments].sort((a, b) => new Date(a.date || a.exDate).getTime() - new Date(b.date || b.exDate).getTime());
  const recent = sorted[sorted.length - 1]?.amount ?? 0;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const old = sorted.find(p => new Date(p.date || p.exDate) <= cutoff || sorted.indexOf(p) === 0);
  const oldAmt = old?.amount ?? 0;
  if (!oldAmt || !recent || oldAmt === recent) return null;
  return (Math.pow(recent / oldAmt, 1 / years) - 1) * 100;
};

const computeAnnualDividend = (payments: any[]) => {
  if (!payments?.length) return 0;
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const recent = payments.filter(p => new Date(p.date || p.exDate) >= oneYearAgo);
  return recent.reduce((s: number, p: any) => s + (p.amount ?? 0), 0);
};

export default function DividendAnalysis() {
  const [input, setInput] = useState('');
  const [sym, setSym] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  const fetchData = async (symbol: string) => {
    setLoading(true);
    setError('');
    try {
      const cacheKey = `dividend_${symbol}_v5`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { ts, d } = JSON.parse(cached);
          if (Date.now() - ts < 6 * 60 * 60 * 1000) { setData(d); return; }
        } catch { localStorage.removeItem(cacheKey); }
      }

      const [massiveRes, metricRes, finRes, priceRes] = await Promise.all([
        // Fetch 40 for CAGR coverage; table displays only 10
        fetch(`${MASSIVE_DIV_URL}?ticker=${symbol}&limit=40&sort=ex_dividend_date.desc&apiKey=${MASSIVE_KEY}`).catch(() => null),
        fetch(`${FINNHUB_URL}/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`),
        fetch(`${FINNHUB_URL}/stock/financials-reported?symbol=${symbol}&freq=annual&token=${FINNHUB_KEY}`),
        fetch(`${FINNHUB_URL}/stock/quote?symbol=${symbol}&token=${FINNHUB_KEY}`),
      ]);

      const [massiveData, metricData, finData, priceData] = await Promise.all([
        massiveRes ? safeJson(massiveRes).catch(() => ({})) : Promise.resolve({}),
        safeJson(metricRes),
        safeJson(finRes).catch(() => ({ data: [] })),
        safeJson(priceRes).catch(() => ({})),
      ]);

      // Massive API: results array with ex_dividend_date, pay_date, cash_amount, distribution_type
      const payments = (Array.isArray(massiveData?.results) ? massiveData.results : [])
        .filter((p: any) => p.cash_amount > 0)
        .map((p: any) => ({
          date: p.ex_dividend_date ?? '',
          exDate: p.ex_dividend_date ?? '',
          amount: p.cash_amount,
          payDate: p.pay_date ?? '',
          type: p.distribution_type ?? '',
        }))
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const metrics = metricData?.metric ?? {};
      const financials = (finData?.data || []).slice(0, 3);
      const currentPrice = priceData?.c ?? 0;

      if (!payments.length && !metrics.dividendYieldIndicatedAnnual && !metrics.dividendsPerShareAnnual && !metrics.payoutRatioAnnual) {
        throw new Error(`${symbol} does not appear to pay dividends, or no dividend data is available.`);
      }

      // Compute FCF from financials for safety score
      let fcfTTM = metrics['freeCashFlowTTM'] ?? metrics['fcfTTM'] ?? null;
      if (!fcfTTM && financials.length > 0) {
        const cf = financials[0]?.report?.cf ?? [];
        const ocf = cf.find((x: any) => x.concept === 'us-gaap_NetCashProvidedByUsedInOperatingActivities')?.value ?? 0;
        const capex = Math.abs(cf.find((x: any) => x.concept === 'us-gaap_PaymentsToAcquirePropertyPlantAndEquipment')?.value ?? 0);
        fcfTTM = parseFloat(ocf) - capex || null;
      }

      const d = { payments, metrics, currentPrice, fcfTTM };
      safeSetItem(cacheKey, JSON.stringify({ ts: Date.now(), d }));
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch dividend data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (s) { setSym(s); fetchData(s); }
  };

  // Derived metrics
  const allPayments = data?.payments ?? [];
  // Recurring-only payments: used for CAGR and payout ratio to exclude special/irregular dividends
  const recurringPayments = allPayments.filter((p: any) => p.type === 'recurring' || p.type === '');

  const annualDiv = data ? computeAnnualDividend(allPayments) : 0;
  const annualRecurringDiv = data ? computeAnnualDividend(recurringPayments.length > 0 ? recurringPayments : allPayments) : 0;

  // CAGR uses recurring payments only to avoid special-dividend distortion
  const cagr3 = data ? computeCagr(recurringPayments.length >= 2 ? recurringPayments : allPayments, 3) : null;
  const cagr5 = data ? computeCagr(recurringPayments.length >= 2 ? recurringPayments : allPayments, 5) : null;
  const cagr10 = data ? computeCagr(recurringPayments.length >= 2 ? recurringPayments : allPayments, 10) : null;

  const yieldPct = data?.metrics?.dividendYieldIndicatedAnnual
    ?? (data?.currentPrice > 0 && annualDiv > 0 ? (annualDiv / data.currentPrice) * 100 : null);

  // Compute payout ratio from recurring dividends ÷ EPS to exclude special dividends
  // Finnhub's pre-calculated payoutRatioAnnual can be inflated by special dividends (e.g. CME)
  const eps = data?.metrics?.epsBasicExclExtraItemsTTM ?? data?.metrics?.epsNormalizedAnnual ?? null;
  const payoutRatioComputed = (eps && eps > 0 && annualRecurringDiv > 0) ? (annualRecurringDiv / eps) * 100 : null;
  const payoutRatio = payoutRatioComputed ?? data?.metrics?.payoutRatioAnnual ?? data?.metrics?.payoutRatioTTM ?? null;
  const payoutRatioIsComputed = payoutRatioComputed !== null;

  // FCF payout ratio uses recurring dividends only
  const sharesOutstanding = data?.metrics?.sharesOutstanding ?? data?.metrics?.shareOutstanding ?? null;
  const totalAnnualDiv = sharesOutstanding && annualRecurringDiv ? sharesOutstanding * annualRecurringDiv * 1e6 : null;
  const fcfPayoutRatio = totalAnnualDiv && data?.fcfTTM && data.fcfTTM > 0 ? (totalAnnualDiv / data.fcfTTM) * 100 : null;

  // Safety score
  const getSafetyInfo = () => {
    if (fcfPayoutRatio !== null) {
      if (fcfPayoutRatio < 40) return { label: 'Safe', grade: 'A', color: 'emerald', icon: CheckCircle, desc: `FCF payout ratio of ${fcfPayoutRatio.toFixed(0)}% is well-covered by free cash flow.` };
      if (fcfPayoutRatio < 70) return { label: 'Moderate', grade: 'B', color: 'blue', icon: Shield, desc: `FCF payout ratio of ${fcfPayoutRatio.toFixed(0)}% — dividend is adequately covered but monitor FCF trends.` };
      if (fcfPayoutRatio < 100) return { label: 'Caution', grade: 'C', color: 'amber', icon: AlertTriangle, desc: `FCF payout ratio of ${fcfPayoutRatio.toFixed(0)}% — dividend is consuming most free cash flow.` };
      return { label: 'At Risk', grade: 'D', color: 'red', icon: XCircle, desc: `FCF payout ratio of ${fcfPayoutRatio.toFixed(0)}% exceeds free cash flow — dividend may be unsustainable.` };
    }
    if (payoutRatio !== null) {
      const src = payoutRatioIsComputed ? 'Regular dividend payout ratio' : 'Earnings payout ratio';
      if (payoutRatio < 40) return { label: 'Safe', grade: 'A', color: 'emerald', icon: CheckCircle, desc: `${src} of ${payoutRatio.toFixed(0)}% leaves ample earnings cushion.` };
      if (payoutRatio < 65) return { label: 'Moderate', grade: 'B', color: 'blue', icon: Shield, desc: `${src} of ${payoutRatio.toFixed(0)}% — dividend is covered by earnings.` };
      if (payoutRatio < 90) return { label: 'Caution', grade: 'C', color: 'amber', icon: AlertTriangle, desc: `${src} of ${payoutRatio.toFixed(0)}% — high relative to earnings.` };
      return { label: 'At Risk', grade: 'D', color: 'red', icon: XCircle, desc: `${src} of ${payoutRatio.toFixed(0)}% — dividend exceeds or is near earnings.` };
    }
    return null;
  };

  const safety = data ? getSafetyInfo() : null;

  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Dividend Analysis</h2>
        <p className="text-slate-400 text-sm">Dividend history, growth CAGR, yield, and FCF safety score.</p>
      </div>

      <form onSubmit={handleSearch} className="max-w-xl relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter ticker (e.g. JNJ, KO, MSFT)"
          className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-12 pr-28 py-4 text-base focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent uppercase transition-all"
        />
        <button type="submit" disabled={!input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Analyze
        </button>
      </form>

      {loading && (
        <div className="flex items-center gap-3 py-8">
          <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400">Loading dividend data...</span>
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
        <div className="space-y-6">
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {yieldPct != null && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Dividend Yield</div>
                <div className="text-2xl font-bold text-rose-400">{yieldPct.toFixed(2)}%</div>
                {data.currentPrice > 0 && <div className="text-xs text-slate-500 mt-0.5">@ ${data.currentPrice.toFixed(2)}</div>}
              </div>
            )}
            {annualDiv > 0 && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Annual Dividend</div>
                <div className="text-2xl font-bold text-white">${annualDiv.toFixed(4)}</div>
                <div className="text-xs text-slate-500 mt-0.5">per share (TTM)</div>
              </div>
            )}
            {payoutRatio != null && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">Payout Ratio</div>
                <div className={`text-2xl font-bold ${payoutRatio < 60 ? 'text-emerald-400' : payoutRatio < 90 ? 'text-amber-400' : 'text-red-400'}`}>
                  {payoutRatio.toFixed(1)}%
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{payoutRatioIsComputed ? 'regular div ÷ EPS' : 'of earnings'}</div>
              </div>
            )}
            {fcfPayoutRatio != null && (
              <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                <div className="text-xs text-slate-400 mb-1">FCF Payout Ratio</div>
                <div className={`text-2xl font-bold ${fcfPayoutRatio < 50 ? 'text-emerald-400' : fcfPayoutRatio < 80 ? 'text-amber-400' : 'text-red-400'}`}>
                  {fcfPayoutRatio.toFixed(1)}%
                </div>
                <div className="text-xs text-slate-500 mt-0.5">of free cash flow</div>
              </div>
            )}
          </div>

          {/* Safety Score */}
          {safety && (
            <div className={`border rounded-xl p-5 flex items-start gap-4 ${colorMap[safety.color]}`}>
              <safety.icon className={`w-8 h-8 shrink-0 mt-0.5 text-${safety.color}-400`} />
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className={`text-2xl font-bold text-${safety.color}-400`}>{safety.grade}</span>
                  <span className={`text-lg font-semibold text-${safety.color}-400`}>Dividend Safety</span>
                  <span className={`text-sm px-2 py-0.5 rounded-full bg-${safety.color}-500/15 text-${safety.color}-400 font-medium`}>{safety.label}</span>
                </div>
                <p className="text-sm text-slate-300">{safety.desc}</p>
              </div>
            </div>
          )}

          {/* Growth CAGR */}
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-slate-200">Dividend Growth CAGR</h3>
            {(cagr3 !== null || cagr5 !== null || cagr10 !== null) ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[{ label: '3-Year', val: cagr3 }, { label: '5-Year', val: cagr5 }, { label: '10-Year', val: cagr10 }].map(({ label, val }) => (
                    val !== null && (
                      <div key={label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 text-center">
                        <div className="text-xs text-slate-400 mb-1">{label} CAGR</div>
                        <div className={`text-xl font-bold flex items-center justify-center gap-1 ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {val >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          {val >= 0 ? '+' : ''}{val.toFixed(1)}%
                        </div>
                      </div>
                    )
                  ))}
                </div>
                <p className="text-xs text-slate-600">CAGR computed from per-payment amounts. Actual annualized growth may differ slightly by frequency.</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">CAGR requires payment history data from Massive API, which could not be retrieved for {sym}.</p>
            )}
          </div>

          {/* Payment History */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-slate-200">{sym} — Dividend Payment History</h3>
            {data.payments.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-700/50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-800/60 text-slate-400 text-xs uppercase tracking-wide">
                        <th className="text-left px-4 py-3 font-medium">Ex-Date</th>
                        <th className="text-right px-4 py-3 font-medium">Amount / Share</th>
                        <th className="text-right px-4 py-3 font-medium">Pay Date</th>
                        <th className="text-center px-4 py-3 font-medium">Type</th>
                        <th className="text-right px-4 py-3 font-medium">vs Prior</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {data.payments.slice(0, 10).map((p: any, i: number) => {
                        // Compare only against the prior payment of the same type to avoid
                        // special dividends being compared against regular ones and vice versa
                        const prev = data.payments.slice(i + 1).find((q: any) => q.type === p.type);
                        const change = prev?.amount ? ((p.amount - prev.amount) / prev.amount) * 100 : null;
                        const isSpecial = p.type === 'irregular' || p.type === 'special';
                        return (
                          <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-4 py-3 text-slate-300">{fmtDate(p.date || p.exDate)}</td>
                            <td className="px-4 py-3 text-right text-white font-semibold">${p.amount?.toFixed(4)}</td>
                            <td className="px-4 py-3 text-right text-slate-400 text-xs">{p.payDate ? fmtDate(p.payDate) : '—'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded capitalize ${isSpecial ? 'bg-amber-500/15 text-amber-400' : 'bg-slate-700 text-slate-400'}`}>
                                {isSpecial ? 'Special' : p.type || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {change !== null && Math.abs(change) > 0.1 ? (
                                <span className={`text-xs ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {change > 0 ? '+' : ''}{change.toFixed(1)}%
                                </span>
                              ) : <span className="text-xs text-slate-600">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {data.payments.length > 10 && (
                  <p className="text-xs text-slate-600 text-center">Showing 10 most recent of {data.payments.length} total payments</p>
                )}
              </>
            ) : (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-500">
                  Dividend payment history could not be retrieved from Massive API for {sym}. Yield and payout metrics above are sourced from Finnhub aggregated data.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="max-w-xl bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-2">
          <p className="text-sm font-medium text-slate-300">What you'll see here</p>
          <ul className="space-y-1.5 text-xs text-slate-500">
            <li className="flex items-start gap-2"><span className="text-rose-500 mt-0.5">•</span>Dividend yield, annual per-share dividend, and earnings payout ratio</li>
            <li className="flex items-start gap-2"><span className="text-rose-500 mt-0.5">•</span>FCF safety score (A–D) based on free cash flow coverage of dividends</li>
            <li className="flex items-start gap-2"><span className="text-rose-500 mt-0.5">•</span>Dividend growth CAGR over 3, 5, and 10 years</li>
            <li className="flex items-start gap-2"><span className="text-rose-500 mt-0.5">•</span>Full payment history with per-payment change vs. prior period</li>
          </ul>
        </div>
      )}
    </div>
  );
}
