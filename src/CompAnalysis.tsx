import React, { useState, useMemo } from 'react';
import { Search, AlertCircle, Download, ArrowUpDown, ArrowUp, ArrowDown, Users, Plus, X } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend } from 'recharts';
import * as XLSX from 'xlsx';

const API_KEY = 'ctj1dchr01qgfbsvp4mgctj1dchr01qgfbsvp4n0';
const BASE_URL = 'https://finnhub.io/api/v1';

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      Object.keys(localStorage)
        .filter(k => k.startsWith('finnhub_') || k.startsWith('valuwise_'))
        .forEach(k => localStorage.removeItem(k));
      try { localStorage.setItem(key, value); } catch { /* skip if still full */ }
    }
  }
}

const formatCurrency = (val: number) => {
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  if (absVal >= 1e9) return `${isNegative ? '-' : ''}$${(absVal / 1e9).toFixed(2)}B`;
  if (absVal >= 1e6) return `${isNegative ? '-' : ''}$${(absVal / 1e6).toFixed(2)}M`;
  return `${isNegative ? '-' : ''}$${absVal.toFixed(2)}`;
};

const formatPct = (val: number) => `${(val * 100).toFixed(2)}%`;
const fmtX = (val: number | null | undefined) => (val != null && isFinite(val) && val > 0) ? `${val.toFixed(2)}x` : '—';

interface PeerSuggestion { symbol: string; name: string; isUS: boolean; }

export default function CompAnalysis() {
  const [tickerInput, setTickerInput] = useState('');
  const [ticker, setTicker] = useState('');
  // Peer finder
  const [showPeerFinder, setShowPeerFinder]       = useState(false);
  const [peerFinderLoading, setPeerFinderLoading] = useState(false);
  const [peerSuggestions, setPeerSuggestions]     = useState<PeerSuggestion[]>([]);
  // User-selected peers (max 5)
  const [selectedPeerSymbols, setSelectedPeerSymbols] = useState<string[]>([]);
  const [customPeerInput, setCustomPeerInput]         = useState('');
  // Analysis results
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [data, setData]         = useState<any[]>([]);
  const [selectedPeers, setSelectedPeers] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey]   = useState<string | null>(null);
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fetchStockData = async (symbol: string) => {
    if (!symbol) return null;
    try {
      const cacheKey = `finnhub_${symbol}_comp_data_v4`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { timestamp, data } = JSON.parse(cached);
          if (Date.now() - timestamp < 24 * 60 * 60 * 1000) return data;
        } catch { localStorage.removeItem(cacheKey); }
      }

      const [resFin, resProf, resMetric] = await Promise.all([
        fetch(`${BASE_URL}/stock/financials-reported?symbol=${symbol}&freq=annual&token=${API_KEY}`),
        fetch(`${BASE_URL}/stock/profile2?symbol=${symbol}&token=${API_KEY}`),
        fetch(`${BASE_URL}/stock/metric?symbol=${symbol}&metric=all&token=${API_KEY}`),
      ]);
      const [finData, profData, metricData] = await Promise.all([
        resFin.json(), resProf.json(), resMetric.json(),
      ]);

      if (!profData.ticker || !metricData.metric) return null;

      const profile = profData;
      const metrics = metricData.metric;
      const marketCap = (parseFloat(profile.marketCapitalization) || parseFloat(metrics.marketCapitalization) || 0) * 1e6;
      const sharesOut = (parseFloat(profile.shareOutstanding) * 1e6) || 0;

      let rev: number, revGrowth: number, ebitda: number, ebitdaMargin: number,
          netIncome: number, niMargin: number, totalDebt: number, totalCash: number,
          totalEquity: number, fcf: number, histEvEbitda: any[];

      if (!finData.data || finData.data.length === 0) return null;

      const financials = finData.data;
      const findConcept = (section: any[], concepts: string[]) => {
        if (!section) return 0;
        for (const concept of concepts) {
          const item = section.find((i: any) => i.concept === concept);
          if (item) return parseFloat(item.value);
        }
        return 0;
      };

      const latestReport = financials[0].report;
      const prevReport = financials.length > 1 ? financials[1].report : null;
      const ic = latestReport.ic; const bs = latestReport.bs; const cf = latestReport.cf;

      rev = findConcept(ic, ['us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap_SalesRevenueNet', 'us-gaap_Revenues', 'ifrs-full_Revenue']);
      const prevRev = prevReport ? findConcept(prevReport.ic, ['us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap_SalesRevenueNet', 'us-gaap_Revenues', 'ifrs-full_Revenue']) : rev;
      revGrowth = prevRev ? (rev - prevRev) / prevRev : 0;

      let ebit = findConcept(ic, ['us-gaap_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities']);
      if (!ebit) {
        const ebt = findConcept(ic, [
          'us-gaap_IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
          'us-gaap_IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
          'ifrs-full_ProfitLossBeforeTax',
        ]);
        const intExp = Math.abs(findConcept(ic, ['us-gaap_InterestExpense', 'us-gaap_InterestAndDebtExpense', 'ifrs-full_FinanceCosts']));
        const intInc = Math.abs(findConcept(ic, ['us-gaap_InvestmentIncomeInterest', 'us-gaap_InterestAndDividendIncomeOperating', 'ifrs-full_FinanceIncome']));
        if (ebt) ebit = ebt + intExp - intInc;
      }
      // Fallback 2: Gross Profit − SG&A − R&D
      if (!ebit && rev > 0) {
        const gp2 = findConcept(ic, ['us-gaap_GrossProfit', 'ifrs-full_GrossProfit']) ||
          (rev - findConcept(ic, ['us-gaap_CostOfRevenue', 'us-gaap_CostOfGoodsAndServicesSold', 'us-gaap_CostOfGoodsSold', 'us-gaap_CostOfServices']));
        const sga = Math.abs(findConcept(ic, ['us-gaap_SellingGeneralAndAdministrativeExpense', 'us-gaap_SellingGeneralAndAdministrativeExpenses', 'us-gaap_GeneralAndAdministrativeExpense', 'ifrs-full_SellingGeneralAndAdministrativeExpense']));
        const rd  = Math.abs(findConcept(ic, ['us-gaap_ResearchAndDevelopmentExpense', 'us-gaap_ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost']));
        if (gp2 > 0 && sga > 0) ebit = gp2 - sga - rd;
      }
      const da = findConcept(cf, ['us-gaap_DepreciationDepletionAndAmortization', 'us-gaap_DepreciationAmortizationAndAccretionNet', 'ifrs-full_DepreciationAndAmortisationExpense']);
      ebitda = ebit + da;
      ebitdaMargin = rev ? ebitda / rev : 0;
      netIncome = findConcept(ic, ['us-gaap_NetIncomeLoss', 'ifrs-full_ProfitLoss']);
      niMargin = rev ? netIncome / rev : 0;

      const shortTermDebt = findConcept(bs, ['us-gaap_LongTermDebtCurrent', 'us-gaap_ShortTermDebt', 'us-gaap_DebtCurrent', 'us-gaap_ShortTermBorrowings', 'ifrs-full_CurrentBorrowings']);
      const longTermDebt = findConcept(bs, ['us-gaap_LongTermDebtNoncurrent', 'us-gaap_LongTermDebt', 'ifrs-full_NoncurrentBorrowings']);
      totalDebt = shortTermDebt + longTermDebt;
      totalCash = findConcept(bs, ['us-gaap_CashAndCashEquivalentsAtCarryingValue', 'us-gaap_CashAndCashEquivalentsAtCarryingValueIncludingVariableInterestEntities', 'ifrs-full_CashAndCashEquivalents']);
      totalEquity = findConcept(bs, ['us-gaap_StockholdersEquity', 'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs-full_Equity']);

      const cfo = findConcept(cf, ['us-gaap_NetCashProvidedByUsedInOperatingActivities', 'ifrs-full_CashFlowsFromUsedInOperatingActivities']);
      const capex = Math.abs(findConcept(cf, ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 'ifrs-full_PurchaseOfPropertyPlantAndEquipment']));
      fcf = cfo - capex;

      histEvEbitda = financials.slice(0, 3).map((r: any) => {
        const rIc = r.report?.ic ?? []; const rCf = r.report?.cf ?? [];
        let rEbit = findConcept(rIc, ['us-gaap_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities']);
        if (!rEbit) {
          const rEbt = findConcept(rIc, ['us-gaap_IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'ifrs-full_ProfitLossBeforeTax']);
          const rIntExp = Math.abs(findConcept(rIc, ['us-gaap_InterestExpense', 'us-gaap_InterestAndDebtExpense', 'ifrs-full_FinanceCosts']));
          const rIntInc = Math.abs(findConcept(rIc, ['us-gaap_InvestmentIncomeInterest', 'ifrs-full_FinanceIncome']));
          if (rEbt) rEbit = rEbt + rIntExp - rIntInc;
        }
        const rDa = findConcept(rCf, ['us-gaap_DepreciationDepletionAndAmortization', 'us-gaap_DepreciationAmortizationAndAccretionNet', 'ifrs-full_DepreciationAndAmortisationExpense']);
        const rEbitda = rEbit + rDa;
        return { year: r.endDate?.substring(0, 4) ?? String(r.year), evEbitda: rEbitda > 0 ? (marketCap + totalDebt - totalCash) / rEbitda : null };
      }).reverse();

      const ev = marketCap + totalDebt - totalCash;
      const price = sharesOut ? marketCap / sharesOut : 0;
      const evToRev = rev ? ev / rev : 0;
      const evToEbitda = ebitda ? ev / ebitda : 0;
      const pToSales = rev ? marketCap / rev : 0;
      const pToE = netIncome > 0 ? marketCap / netIncome : 0;
      const pToBook = totalEquity > 0 ? marketCap / totalEquity : 0;
      const pToFCF = fcf > 0 ? marketCap / fcf : 0;

      const result = { symbol: profile.ticker, name: profile.name, rev, revGrowth, ebitda, ebitdaMargin, netIncome, niMargin, price, marketCap, ev, evToRev, evToEbitda, pToSales, pToE, pToBook, pToFCF, totalDebt, totalCash, totalEquity, sharesOut, fcf, histEvEbitda };
      safeSetItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: result }));
      return result;
    } catch { return null; }
  };

  const fetchPeerSuggestions = async (sym: string) => {
    setPeerFinderLoading(true);
    setShowPeerFinder(true);
    setPeerSuggestions([]);
    try {
      const res = await fetch(`${BASE_URL}/stock/peers?symbol=${sym}&grouping=subindustry&token=${API_KEY}`);
      if (!res.ok) return;
      const list: string[] = await res.json();
      const candidates = list.filter(p => p !== sym).slice(0, 10);
      const profiles = await Promise.all(
        candidates.map(p =>
          fetch(`${BASE_URL}/stock/profile2?symbol=${p}&token=${API_KEY}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      setPeerSuggestions(
        candidates
          .map((p, i) => ({ symbol: p, name: profiles[i]?.name ?? p, isUS: profiles[i]?.country === 'US' }))
          .filter(s => s.name && s.name !== s.symbol) // skip empty profiles
      );
    } catch { /* silent */ } finally { setPeerFinderLoading(false); }
  };

  const togglePeerSelection = (sym: string) => {
    setSelectedPeerSymbols(prev => {
      if (prev.includes(sym)) return prev.filter(s => s !== sym);
      if (prev.length >= 5) return prev;
      return [...prev, sym];
    });
  };

  const addCustomPeer = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = customPeerInput.trim().toUpperCase();
    if (!sym || selectedPeerSymbols.includes(sym) || sym === ticker || selectedPeerSymbols.length >= 5) return;
    setSelectedPeerSymbols(prev => [...prev, sym]);
    setCustomPeerInput('');
  };

  const removePeer = (sym: string) => setSelectedPeerSymbols(prev => prev.filter(s => s !== sym));

  const fetchData = async () => {
    const sym = tickerInput.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError('');
    const confirmedTicker = sym;
    setTicker(confirmedTicker);
    try {
      const targetData = await fetchStockData(confirmedTicker);
      if (!targetData) throw new Error(`No financial data found for ${confirmedTicker}. Only US-listed stocks with SEC filings (NYSE / NASDAQ) are supported.`);

      const initialSelected: Record<string, boolean> = {};
      const peerResults = [];
      for (const peer of selectedPeerSymbols) {
        if (peer === confirmedTicker) continue;
        const d = await fetchStockData(peer);
        if (d) { peerResults.push(d); initialSelected[peer] = true; }
      }

      setData([targetData, ...peerResults]);
      setSelectedPeers(initialSelected);
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally { setLoading(false); }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = tickerInput.trim().toUpperCase();
    if (!sym) return;
    // Reset peer state when ticker changes
    setTicker(sym);
    setShowPeerFinder(false);
    setPeerSuggestions([]);
    setSelectedPeerSymbols([]);
    setData([]);
    setError('');
  };

  const togglePeer = (symbol: string) => setSelectedPeers(prev => ({ ...prev, [symbol]: !prev[symbol] }));

  const calcStats = (key: string) => {
    const values = data.slice(1).filter(d => selectedPeers[d.symbol]).map(d => d[key]).filter((v: any) => v != null && !isNaN(v) && v > 0).sort((a: number, b: number) => a - b);
    if (values.length === 0) return { mean: 0, median: 0, p25: 0, p75: 0 };
    const mean = values.reduce((a: number, b: number) => a + b, 0) / values.length;
    const getPercentile = (p: number) => {
      const idx = (values.length - 1) * p; const lower = Math.floor(idx); const upper = Math.ceil(idx);
      if (upper >= values.length) return values[lower];
      return values[lower] * (1 - (idx - lower)) + values[upper] * (idx - lower);
    };
    return { mean, median: getPercentile(0.5), p25: getPercentile(0.25), p75: getPercentile(0.75) };
  };

  const stats = useMemo(() => ({
    revGrowth: calcStats('revGrowth'), ebitda: calcStats('ebitda'), ebitdaMargin: calcStats('ebitdaMargin'),
    netIncome: calcStats('netIncome'), niMargin: calcStats('niMargin'), price: calcStats('price'),
    marketCap: calcStats('marketCap'), ev: calcStats('ev'), evToRev: calcStats('evToRev'),
    evToEbitda: calcStats('evToEbitda'), pToSales: calcStats('pToSales'), pToE: calcStats('pToE'),
    pToBook: calcStats('pToBook'), pToFCF: calcStats('pToFCF'),
  }), [data, selectedPeers]);

  // Sorted display data — target always stays at index 0
  const displayData = useMemo(() => {
    if (!sortKey || data.length === 0) return data;
    const [target, ...peers] = data;
    const sorted = [...peers].sort((a, b) => {
      const av = a[sortKey] ?? 0; const bv = b[sortKey] ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return [target, ...sorted];
  }, [data, sortKey, sortDir]);

  // Implied valuation using peer medians
  const impliedPrices = useMemo(() => {
    if (data.length === 0) return null;
    const t = data[0];
    if (!t || t.sharesOut <= 0) return null;
    const evBridge = (impliedEv: number) => t.sharesOut > 0 ? (impliedEv + t.totalCash - t.totalDebt) / t.sharesOut : null;
    return [
      { label: 'EV / Revenue', price: stats.evToRev.median > 0 && t.rev > 0 ? evBridge(stats.evToRev.median * t.rev) : null },
      { label: 'EV / EBITDA',  price: stats.evToEbitda.median > 0 && t.ebitda > 0 ? evBridge(stats.evToEbitda.median * t.ebitda) : null },
      { label: 'P / Sales',    price: stats.pToSales.median > 0 && t.rev > 0 ? stats.pToSales.median * (t.rev / t.sharesOut) : null },
      { label: 'P / Earnings', price: stats.pToE.median > 0 && t.netIncome > 0 ? stats.pToE.median * (t.netIncome / t.sharesOut) : null },
      { label: 'P / Book',     price: stats.pToBook.median > 0 && t.totalEquity > 0 ? stats.pToBook.median * (t.totalEquity / t.sharesOut) : null },
      { label: 'P / FCF',      price: stats.pToFCF.median > 0 && t.fcf > 0 ? stats.pToFCF.median * (t.fcf / t.sharesOut) : null },
    ].filter(r => r.price !== null && r.price > 0);
  }, [data, stats]);

  const getHeatmapColor = (val: number, key: string) => {
    const values = data.map(d => d[key]).filter((v: any) => v != null && !isNaN(v));
    if (values.length === 0) return '';
    const min = Math.min(...values); const max = Math.max(...values);
    if (min === max) return '';
    return `rgba(16, 185, 129, ${((val - min) / (max - min)) * 0.4})`;
  };

  const exportToExcel = () => {
    if (data.length === 0) return;
    const headers = ['Company', 'Symbol', 'Rev Growth', 'EBITDA', 'EBITDA %', 'Net Income', 'NI %', 'Price', 'Market Cap', 'EV', 'EV/Rev', 'EV/EBITDA', 'P/Sales', 'P/E', 'P/Book', 'P/FCF'];
    const rows = data.map(d => [d.name ?? '', d.symbol ?? '', formatPct(d.revGrowth), formatCurrency(d.ebitda), formatPct(d.ebitdaMargin), formatCurrency(d.netIncome), formatPct(d.niMargin), `$${d.price.toFixed(2)}`, formatCurrency(d.marketCap), formatCurrency(d.ev), fmtX(d.evToRev), fmtX(d.evToEbitda), fmtX(d.pToSales), fmtX(d.pToE), fmtX(d.pToBook), fmtX(d.pToFCF)]);
    const makeStatRow = (label: string, key: 'mean' | 'median' | 'p25' | 'p75') => [label, '', formatPct(stats.revGrowth[key]), formatCurrency(stats.ebitda[key]), formatPct(stats.ebitdaMargin[key]), formatCurrency(stats.netIncome[key]), formatPct(stats.niMargin[key]), `$${stats.price[key].toFixed(2)}`, formatCurrency(stats.marketCap[key]), formatCurrency(stats.ev[key]), fmtX(stats.evToRev[key]), fmtX(stats.evToEbitda[key]), fmtX(stats.pToSales[key]), fmtX(stats.pToE[key]), fmtX(stats.pToBook[key]), fmtX(stats.pToFCF[key])];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], makeStatRow('Mean', 'mean'), makeStatRow('Median', 'median'), makeStatRow('25th Percentile', 'p25'), makeStatRow('75th Percentile', 'p75')]);
    ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comp Analysis');
    XLSX.writeFile(wb, `comp_analysis_${ticker}_${new Date().toISOString().substring(0, 10)}.xlsx`);
  };

  // Sort header component
  const SortTh = ({ label, k, left }: { label: string; k: string; left?: boolean }) => (
    <th onClick={() => toggleSort(k)} className={`py-2 px-2 border border-slate-700/50 font-medium cursor-pointer select-none hover:bg-slate-700/30 transition-colors ${left ? 'text-left' : ''}`}>
      <span className="inline-flex items-center gap-1 justify-end w-full">
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />) : <ArrowUpDown className="w-3 h-3 text-slate-600" />}
      </span>
    </th>
  );

  // Sparkline component
  const Sparkline = ({ histEvEbitda }: { histEvEbitda: { year: string; evEbitda: number | null }[] }) => {
    const valid = histEvEbitda.filter(d => d.evEbitda != null && d.evEbitda > 0);
    if (valid.length < 2) return <span className="text-slate-500 text-xs">—</span>;
    return (
      <ResponsiveContainer width="100%" height={36}>
        <LineChart data={valid} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <Line type="monotone" dataKey="evEbitda" stroke="#10b981" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  // Bubble chart data
  const bubbleData = useMemo(() => data.map((d, i) => ({
    x: d.evToEbitda > 0 ? +d.evToEbitda.toFixed(1) : null,
    y: +(d.revGrowth * 100).toFixed(1),
    z: d.marketCap,
    symbol: d.symbol,
    isTarget: i === 0,
  })).filter(d => d.x !== null), [data]);

  const currentPrice = data[0]?.price ?? 0;

  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  // Target percentile vs all companies (higher = more favorable)
  const targetPercentiles = useMemo(() => {
    if (data.length < 2) return null;
    const getPercentile = (key: string, higherIsBetter: boolean) => {
      const vals = data.map(d => d[key]).filter((v: any) => v != null && isFinite(v) && !isNaN(v));
      if (vals.length === 0 || data[0][key] == null) return null;
      const tVal = data[0][key];
      if (higherIsBetter) return Math.round(vals.filter((v: number) => v < tVal).length / vals.length * 100);
      return Math.round(vals.filter((v: number) => v > tVal).length / vals.length * 100);
    };
    return {
      revGrowth:    getPercentile('revGrowth',    true),
      ebitdaMargin: getPercentile('ebitdaMargin', true),
      evToRev:      getPercentile('evToRev',      false),
      evToEbitda:   getPercentile('evToEbitda',   false),
      pToSales:     getPercentile('pToSales',     false),
      pToE:         getPercentile('pToE',         false),
      pToBook:      getPercentile('pToBook',      false),
      pToFCF:       getPercentile('pToFCF',       false),
    };
  }, [data]);

  // Multi-line EV/EBITDA history chart data
  const multiHistData = useMemo(() => {
    if (data.length === 0) return [];
    const years = Array.from(new Set(data.flatMap(d => (d.histEvEbitda ?? []).map((h: any) => h.year)))).sort();
    return years.map(year => {
      const row: any = { year };
      data.forEach(d => {
        const h = (d.histEvEbitda ?? []).find((h: any) => h.year === year);
        row[d.symbol] = h?.evEbitda ?? null;
      });
      return row;
    });
  }, [data]);

  // Relative bar ranking sorted data
  const rankingData = useMemo(() => {
    if (data.length === 0) return null;
    const makeRanked = (key: string, ascending: boolean) =>
      [...data].filter(d => d[key] != null && d[key] > 0)
        .sort((a, b) => ascending ? a[key] - b[key] : b[key] - a[key])
        .map(d => ({ symbol: d.symbol, value: +(d[key]).toFixed(2), isTarget: d.symbol === data[0]?.symbol }));
    return {
      evToEbitda: makeRanked('evToEbitda', true),
      pToE:       makeRanked('pToE',       true),
      evToRev:    makeRanked('evToRev',    true),
      revGrowth:  makeRanked('revGrowth',  false),
    };
  }, [data]);

  // Radar chart scores (0-100 percentile per axis, target vs peer median)
  const radarScores = useMemo(() => {
    if (!targetPercentiles || data.length < 2) return null;
    const getMedianPct = (key: string, higherIsBetter: boolean) => {
      const vals = data.map(d => d[key]).filter((v: any) => v != null && isFinite(v) && !isNaN(v));
      if (vals.length === 0) return 50;
      const medVal = (stats as any)[key]?.median ?? 0;
      if (higherIsBetter) return Math.round(vals.filter((v: number) => v < medVal).length / vals.length * 100);
      return Math.round(vals.filter((v: number) => v > medVal).length / vals.length * 100);
    };
    return [
      { subject: 'Rev Growth',    target: targetPercentiles.revGrowth    ?? 50, median: getMedianPct('revGrowth',    true)  },
      { subject: 'EBITDA Margin', target: targetPercentiles.ebitdaMargin ?? 50, median: getMedianPct('ebitdaMargin', true)  },
      { subject: 'EV/EBITDA',     target: targetPercentiles.evToEbitda   ?? 50, median: getMedianPct('evToEbitda',   false) },
      { subject: 'P/E',           target: targetPercentiles.pToE         ?? 50, median: getMedianPct('pToE',         false) },
      { subject: 'P/Book',        target: targetPercentiles.pToBook      ?? 50, median: getMedianPct('pToBook',      false) },
      { subject: 'P/FCF',         target: targetPercentiles.pToFCF       ?? 50, median: getMedianPct('pToFCF',       false) },
    ];
  }, [targetPercentiles, data, stats]);

  return (
    <div className="space-y-6">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-5">

        {/* Row 1: ticker input + action buttons */}
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[180px] max-w-xs">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Target Ticker</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value)}
                placeholder="e.g. AAPL"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 uppercase"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!tickerInput.trim() || peerFinderLoading}
            onClick={() => fetchPeerSuggestions(tickerInput.trim().toUpperCase())}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Users className="w-4 h-4" />
            {peerFinderLoading ? 'Finding…' : 'Peer Finder'}
          </button>

          <button
            type="button"
            disabled={loading || !tickerInput.trim()}
            onClick={fetchData}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading…' : 'Run Analysis'}
          </button>
        </form>

        {/* Row 2: Peer Finder suggestions panel */}
        {showPeerFinder && (
          <div className="border border-slate-700/60 rounded-xl p-4 space-y-3 bg-slate-900/40">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                Suggested Peers
                <span className="text-xs text-slate-500 font-normal">— click to add (max 5)</span>
              </p>
              <span className="text-xs text-slate-500">{selectedPeerSymbols.length}/5 selected</span>
            </div>

            {peerFinderLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                <div className="w-4 h-4 border border-slate-500 border-t-transparent rounded-full animate-spin" />
                Fetching peer list…
              </div>
            ) : peerSuggestions.length === 0 ? (
              <p className="text-xs text-slate-500 py-1">No peer suggestions found for this ticker.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {peerSuggestions.map(p => {
                  const isSelected = selectedPeerSymbols.includes(p.symbol);
                  const isFull = selectedPeerSymbols.length >= 5 && !isSelected;
                  return (
                    <button
                      key={p.symbol}
                      disabled={isFull}
                      onClick={() => togglePeerSelection(p.symbol)}
                      title={isFull ? 'Maximum 5 peers selected' : undefined}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                        isSelected
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : isFull
                          ? 'bg-slate-800/40 border-slate-700/30 text-slate-600 cursor-not-allowed'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                      }`}
                    >
                      <span className="font-bold">{p.symbol}</span>
                      <span className="text-slate-400 max-w-[100px] truncate">{p.name}</span>
                      <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        p.isUS ? 'bg-blue-500/15 text-blue-300' : 'bg-amber-500/15 text-amber-300'
                      }`}>
                        {p.isUS ? 'US' : 'Non-US'}
                      </span>
                      {isSelected && <X className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Manual custom peer input */}
            <form onSubmit={addCustomPeer} className="flex gap-2 pt-1 border-t border-slate-700/40">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                <Plus className="w-3.5 h-3.5" />
                Add manually:
              </div>
              <input
                type="text"
                value={customPeerInput}
                onChange={e => setCustomPeerInput(e.target.value)}
                placeholder="e.g. TSLA"
                className="flex-1 max-w-[120px] px-2.5 py-1 bg-slate-800 border border-slate-600 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 uppercase"
              />
              <button
                type="submit"
                disabled={selectedPeerSymbols.length >= 5 || !customPeerInput.trim()}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </form>
          </div>
        )}

        {/* Row 3: Selected peers tags (always visible if any selected) */}
        {selectedPeerSymbols.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 uppercase font-semibold tracking-wide">Peers selected:</span>
            {selectedPeerSymbols.map(sym => (
              <span key={sym} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-700 text-slate-200 border border-slate-600">
                {sym}
                <button onClick={() => removePeer(sym)} className="text-slate-400 hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button onClick={() => setSelectedPeerSymbols([])} className="text-xs text-slate-500 hover:text-red-400 transition-colors ml-1">
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── About hint (shown before any analysis runs) ──────────────────── */}
      {data.length === 0 && !loading && !error && (
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-sm font-semibold text-slate-300">About Comparable Company Analysis</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Benchmark your target company against up to 5 peers using EV/Revenue, EV/EBITDA, P/E, P/Sales, P/Book, and P/FCF. Only US-listed stocks with SEC filings are supported.
          </p>
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {[
              'Enter a ticker and click Run Analysis to load the target stock alone.',
              'Click Peer Finder to see Finnhub\'s suggested industry peers — each is labeled US or Non-US.',
              'Select up to 5 peers to add. Non-US peers may have missing data.',
              'Or type any ticker manually in the "Add manually" field inside the Peer Finder panel.',
              'Click any column header to sort the comparison table ascending or descending.',
              'The football-field chart shows the implied price range using peer medians across 6 valuation methods.',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-slate-400">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs text-blue-400 font-semibold">{i + 1}</span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-500 font-medium">Error loading data</h3>
            <p className="text-red-400/80 text-sm mt-1">{error}</p>
            <p className="text-slate-500 text-xs mt-2">If this keeps happening, click <span className="text-slate-300 font-medium">Clear Cache</span> in the top-right corner and try again.</p>
          </div>
        </div>
      )}

      {data.length > 0 && !loading && (
        <>
          {/* Main Comparison Table */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 overflow-x-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-medium">Comparable Company Analysis</h3>
                <p className="text-xs text-slate-500 mt-0.5">Click any column header to sort peers</p>
              </div>
              <button onClick={exportToExcel} className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium rounded-lg transition-colors">
                <Download className="w-4 h-4" /> Export to Excel
              </button>
            </div>
            <table className="w-full text-sm text-right border-collapse">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 px-2 border border-slate-700/50 font-medium">Company</th>
                  <th className="py-2 px-2 border border-slate-700/50 font-medium text-center">Include</th>
                  <SortTh label="Rev Growth" k="revGrowth" />
                  <SortTh label="EBITDA" k="ebitda" />
                  <SortTh label="EBITDA %" k="ebitdaMargin" />
                  <SortTh label="Net Income" k="netIncome" />
                  <SortTh label="NI %" k="niMargin" />
                  <SortTh label="Price / Share" k="price" />
                  <SortTh label="Market Cap" k="marketCap" />
                  <SortTh label="EV" k="ev" />
                  <th className="py-2 px-2 border border-slate-700/50 border-l-2 border-l-slate-500 font-medium cursor-pointer hover:bg-slate-700/30" onClick={() => toggleSort('evToRev')}>
                    <span className="inline-flex items-center gap-1 justify-end w-full">EV / Rev {sortKey === 'evToRev' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />) : <ArrowUpDown className="w-3 h-3 text-slate-600" />}</span>
                  </th>
                  <SortTh label="EV / EBITDA" k="evToEbitda" />
                  <SortTh label="P / Sales" k="pToSales" />
                  <SortTh label="P / E" k="pToE" />
                  <SortTh label="P / Book" k="pToBook" />
                  <SortTh label="P / FCF" k="pToFCF" />
                  <th className="py-2 px-2 border border-slate-700/50 font-medium text-center" style={{ minWidth: '80px' }}>EV/EBITDA Trend</th>
                </tr>
              </thead>
              <tbody className="font-mono text-base">
                {displayData.map((d, i) => {
                  const isTarget = i === 0;
                  const isIncluded = isTarget || selectedPeers[d.symbol];
                  return (
                    <tr key={d.symbol} className={`border-b border-slate-700/50 ${isTarget ? 'bg-slate-700/30 font-semibold' : ''} ${!isIncluded ? 'opacity-50' : ''}`}>
                      <td className="text-left py-3 px-2 border border-slate-700/50 text-slate-300">
                        <div className="flex flex-col"><span>{d.symbol}</span><span className="text-xs text-slate-500 font-sans truncate max-w-[120px]">{d.name}</span></div>
                      </td>
                      <td className="py-3 px-2 border border-slate-700/50 text-center">
                        {!isTarget && <input type="checkbox" checked={selectedPeers[d.symbol] || false} onChange={() => togglePeer(d.symbol)} className="w-4 h-4 accent-emerald-500 cursor-pointer" />}
                      </td>
                      <td className={`py-3 px-2 border border-slate-700/50 italic text-xs ${d.revGrowth < 0 ? 'text-red-400' : ''}`} style={{ backgroundColor: getHeatmapColor(d.revGrowth, 'revGrowth') }}>{formatPct(d.revGrowth)}</td>
                      <td className={`py-3 px-2 border border-slate-700/50 ${d.ebitda < 0 ? 'text-red-400' : ''}`} style={{ backgroundColor: getHeatmapColor(d.ebitda, 'ebitda') }}>{formatCurrency(d.ebitda)}</td>
                      <td className={`py-3 px-2 border border-slate-700/50 italic text-xs ${d.ebitdaMargin < 0 ? 'text-red-400' : ''}`} style={{ backgroundColor: getHeatmapColor(d.ebitdaMargin, 'ebitdaMargin') }}>{formatPct(d.ebitdaMargin)}</td>
                      <td className={`py-3 px-2 border border-slate-700/50 ${d.netIncome < 0 ? 'text-red-400' : ''}`} style={{ backgroundColor: getHeatmapColor(d.netIncome, 'netIncome') }}>{formatCurrency(d.netIncome)}</td>
                      <td className={`py-3 px-2 border border-slate-700/50 italic text-xs ${d.niMargin < 0 ? 'text-red-400' : ''}`} style={{ backgroundColor: getHeatmapColor(d.niMargin, 'niMargin') }}>{formatPct(d.niMargin)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.price, 'price') }}>${d.price.toFixed(2)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.marketCap, 'marketCap') }}>{formatCurrency(d.marketCap)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.ev, 'ev') }}>{formatCurrency(d.ev)}</td>
                      <td className="py-3 px-2 border border-slate-700/50 border-l-2 border-l-slate-500" style={{ backgroundColor: getHeatmapColor(d.evToRev, 'evToRev') }}>{fmtX(d.evToRev)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.evToEbitda, 'evToEbitda') }}>{fmtX(d.evToEbitda)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.pToSales, 'pToSales') }}>{fmtX(d.pToSales)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.pToE, 'pToE') }}>{fmtX(d.pToE)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.pToBook, 'pToBook') }}>{fmtX(d.pToBook)}</td>
                      <td className="py-3 px-2 border border-slate-700/50" style={{ backgroundColor: getHeatmapColor(d.pToFCF, 'pToFCF') }}>{fmtX(d.pToFCF)}</td>
                      <td className="py-1 px-2 border border-slate-700/50" style={{ minWidth: '80px' }}>
                        <Sparkline histEvEbitda={d.histEvEbitda ?? []} />
                      </td>
                    </tr>
                  );
                })}

                {/* Stats rows */}
                {(['Mean', 'Median', '25th Percentile', '75th Percentile'] as const).map((label, li) => {
                  const key = (['mean', 'median', 'p25', 'p75'] as const)[li];
                  return (
                    <tr key={label} className={`text-slate-400 text-sm font-mono ${li === 0 ? 'border-t-2 border-slate-600' : ''}`}>
                      <td className="text-left py-3 px-2 border border-slate-700/50 font-semibold" colSpan={2}>{label}</td>
                      <td className={`py-3 px-2 border border-slate-700/50 italic text-xs ${stats.revGrowth[key] < 0 ? 'text-red-400' : ''}`}>{formatPct(stats.revGrowth[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{formatCurrency(stats.ebitda[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50 italic text-xs">{formatPct(stats.ebitdaMargin[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{formatCurrency(stats.netIncome[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50 italic text-xs">{formatPct(stats.niMargin[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">${stats.price[key].toFixed(2)}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{formatCurrency(stats.marketCap[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{formatCurrency(stats.ev[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50 border-l-2 border-l-slate-500">{fmtX(stats.evToRev[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{fmtX(stats.evToEbitda[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{fmtX(stats.pToSales[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{fmtX(stats.pToE[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{fmtX(stats.pToBook[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50">{fmtX(stats.pToFCF[key])}</td>
                      <td className="py-3 px-2 border border-slate-700/50 text-center text-slate-600">—</td>
                    </tr>
                  );
                })}
                {/* Target Percentile row */}
                {targetPercentiles && (() => {
                  const pctCell = (v: number | null) => {
                    if (v == null) return <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>;
                    const color = v >= 75 ? 'text-emerald-400' : v >= 40 ? 'text-slate-400' : 'text-amber-400';
                    return <td className={`py-2.5 px-2 border border-slate-700/50 text-center text-xs font-medium ${color}`}>{ordinal(v)}</td>;
                  };
                  return (
                    <tr className="border-t-2 border-slate-500 bg-slate-700/20">
                      <td className="text-left py-2.5 px-2 border border-slate-700/50 text-xs font-semibold text-slate-300" colSpan={2}>Target Percentile</td>
                      {pctCell(targetPercentiles.revGrowth)}
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                      {pctCell(targetPercentiles.ebitdaMargin)}
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                      {pctCell(targetPercentiles.evToRev)}
                      {pctCell(targetPercentiles.evToEbitda)}
                      {pctCell(targetPercentiles.pToSales)}
                      {pctCell(targetPercentiles.pToE)}
                      {pctCell(targetPercentiles.pToBook)}
                      {pctCell(targetPercentiles.pToFCF)}
                      <td className="py-2.5 px-2 border border-slate-700/50 text-center text-slate-600 text-xs">—</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
            <p className="text-xs text-slate-600 mt-2">Target Percentile: higher % = more favorable vs peer group (100 = highest growth / lowest multiple)</p>
          </div>

          {/* Implied Valuation Football Field */}
          {impliedPrices && impliedPrices.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
              <div className="mb-4">
                <h3 className="text-lg font-medium">Implied Valuation — Peer Median Multiples</h3>
                <p className="text-xs text-slate-500 mt-1">Implied share price for {data[0]?.symbol} using each peer group median multiple</p>
              </div>
              <div className="space-y-3">
                {(() => {
                  const prices = impliedPrices.map(r => r.price as number);
                  const minP = Math.min(...prices, currentPrice) * 0.8;
                  const maxP = Math.max(...prices, currentPrice) * 1.15;
                  const range = maxP - minP || 1;
                  return impliedPrices.map(({ label, price }) => {
                    const p = price as number;
                    const barPct = ((p - minP) / range) * 100;
                    const curPct = ((currentPrice - minP) / range) * 100;
                    const upside = currentPrice > 0 ? (p - currentPrice) / currentPrice : 0;
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <div className="w-28 text-xs text-slate-400 text-right shrink-0">{label}</div>
                        <div className="flex-1 relative h-6 bg-slate-700/40 rounded-md overflow-visible">
                          {/* Implied price bar */}
                          <div className={`absolute top-0 h-full rounded-md ${upside >= 0 ? 'bg-emerald-500/30' : 'bg-red-500/30'}`}
                               style={{ width: `${Math.max(2, Math.min(100, barPct))}%` }} />
                          {/* Current price line */}
                          <div className="absolute top-0 h-full w-0.5 bg-slate-400/70" style={{ left: `${Math.max(0, Math.min(100, curPct))}%` }} />
                        </div>
                        <div className="w-20 text-right font-mono text-sm text-slate-200">${p.toFixed(2)}</div>
                        <div className={`w-16 text-right text-xs font-medium ${upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {upside >= 0 ? '+' : ''}{(upside * 100).toFixed(1)}%
                        </div>
                      </div>
                    );
                  });
                })()}
                <div className="flex items-center gap-3 pt-1 border-t border-slate-700/50">
                  <div className="w-28 text-xs text-slate-500 text-right shrink-0">Current Price</div>
                  <div className="flex-1 h-px bg-slate-600" />
                  <div className="w-20 text-right font-mono text-sm text-slate-400">${currentPrice.toFixed(2)}</div>
                  <div className="w-16" />
                </div>
              </div>
            </div>
          )}

          {/* EV/EBITDA Multi-line History Chart */}
          {multiHistData.length >= 2 && data.length >= 2 && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
              <h3 className="text-sm font-medium text-slate-300 mb-4">EV/EBITDA Trend — 3 Years</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={multiHistData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}x`} width={40} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                    labelStyle={{ color: '#e2e8f0' }}
                    formatter={(v: number, name: string) => [`${v?.toFixed(1)}x`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  {data.map((d, i) => (
                    <Line
                      key={d.symbol}
                      type="monotone"
                      dataKey={d.symbol}
                      stroke={i === 0 ? '#10b981' : '#475569'}
                      strokeWidth={i === 0 ? 2.5 : 1}
                      dot={{ r: i === 0 ? 4 : 2, fill: i === 0 ? '#10b981' : '#475569' }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Relative Bar Ranking */}
          {rankingData && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
              <h3 className="text-sm font-medium text-slate-300 mb-4">Peer Ranking by Metric</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {([
                  { key: 'evToEbitda', label: 'EV / EBITDA', fmt: (v: number) => `${v.toFixed(1)}x`, ascending: true },
                  { key: 'pToE',       label: 'P / E',       fmt: (v: number) => `${v.toFixed(1)}x`, ascending: true },
                  { key: 'evToRev',    label: 'EV / Revenue', fmt: (v: number) => `${v.toFixed(1)}x`, ascending: true },
                  { key: 'revGrowth',  label: 'Rev Growth %', fmt: (v: number) => `${(v*100).toFixed(1)}%`, ascending: false },
                ] as const).map(({ key, label, fmt }) => {
                  const rows = rankingData[key];
                  if (rows.length === 0) return null;
                  const maxVal = Math.max(...rows.map(r => Math.abs(r.value)));
                  return (
                    <div key={key}>
                      <div className="text-xs text-slate-500 font-medium mb-2">{label} {key !== 'revGrowth' ? '(lower = cheaper)' : '(higher = better)'}</div>
                      <div className="space-y-1.5">
                        {rows.map(row => (
                          <div key={row.symbol} className="flex items-center gap-2">
                            <div className={`text-xs font-mono w-12 flex-shrink-0 text-right ${row.isTarget ? 'text-emerald-400 font-semibold' : 'text-slate-500'}`}>{row.symbol}</div>
                            <div className="flex-1 relative h-4 bg-slate-700/40 rounded overflow-hidden">
                              <div
                                className={`absolute inset-y-0 left-0 rounded ${row.isTarget ? 'bg-emerald-500' : 'bg-slate-600'} opacity-80`}
                                style={{ width: `${Math.min(Math.abs(row.value) / maxVal * 100, 100)}%` }}
                              />
                            </div>
                            <div className={`text-xs font-mono w-14 flex-shrink-0 ${row.isTarget ? 'text-emerald-400' : 'text-slate-500'}`}>
                              {key === 'revGrowth' ? fmt(row.value) : fmt(row.value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Valuation Radar Chart */}
          {radarScores && radarScores.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
              <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-300">Valuation Profile vs. Peer Median</h3>
                <p className="text-xs text-slate-500 mt-0.5">Percentile scores (0–100) — higher = more favorable (cheaper multiple / stronger growth)</p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarScores}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="Peer Median" dataKey="median" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.08} strokeDasharray="4 2" strokeWidth={1.5} />
                  <Radar name={data[0]?.symbol ?? 'Target'} dataKey="target" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                    formatter={(v: number, name: string) => [`${v}th percentile`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bubble Chart */}
          {bubbleData.length > 1 && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
              <div className="mb-4">
                <h3 className="text-lg font-medium">Valuation vs. Growth Bubble Chart</h3>
                <p className="text-xs text-slate-500 mt-1">X: EV/EBITDA multiple · Y: Revenue growth · Bubble size: market cap</p>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="x" name="EV/EBITDA" type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} label={{ value: 'EV / EBITDA', position: 'insideBottom', offset: -10, fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis dataKey="y" name="Rev Growth %" type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}%`} label={{ value: 'Rev Growth %', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }} />
                  <ZAxis dataKey="z" range={[40, 600]} name="Market Cap" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs space-y-1">
                          <div className="font-semibold text-white">{d.symbol}</div>
                          <div className="text-slate-400">EV/EBITDA: <span className="text-slate-200">{d.x?.toFixed(1)}x</span></div>
                          <div className="text-slate-400">Rev Growth: <span className="text-slate-200">{d.y?.toFixed(1)}%</span></div>
                          <div className="text-slate-400">Market Cap: <span className="text-slate-200">{formatCurrency(d.z)}</span></div>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={bubbleData} isAnimationActive={false}>
                    {bubbleData.map((entry, index) => (
                      <Cell key={index} fill={entry.isTarget ? '#10b981' : '#3b82f6'} fillOpacity={entry.isTarget ? 0.9 : 0.6} stroke={entry.isTarget ? '#6ee7b7' : '#93c5fd'} strokeWidth={1} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 justify-center text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Target company</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Peers</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
