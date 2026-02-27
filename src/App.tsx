import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, ComposedChart } from 'recharts';
import { Search, TrendingUp, TrendingDown, Info, DollarSign, Activity, PieChart, AlertCircle, Download, LayoutDashboard, Users, Award, Printer, Target } from 'lucide-react';
import * as XLSX from 'xlsx';
import CompAnalysis from './CompAnalysis';
import CompanyGrade from './CompanyGrade';

const API_KEY = 'ctj1dchr01qgfbsvp4mgctj1dchr01qgfbsvp4n0';
const BASE_URL = 'https://finnhub.io/api/v1';

const parseNum = (val: any): number => {
  if (val === 'None' || val === null || val === undefined || val === '0') return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

const formatCurrency = (val: number) => {
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  if (absVal >= 1e9) return `${isNegative ? '-' : ''}$${(absVal / 1e9).toFixed(2)}B`;
  if (absVal >= 1e6) return `${isNegative ? '-' : ''}$${(absVal / 1e6).toFixed(2)}M`;
  return `${isNegative ? '-' : ''}$${absVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const formatModelCurrency = (val: number, unit: 'M' | 'B' = 'M') => {
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  const divisor = unit === 'B' ? 1e9 : 1e6;
  return `${isNegative ? '-' : ''}$${(absVal / divisor).toFixed(2)}${unit}`;
};

const formatModelNumber = (val: number, unit: 'M' | 'B' = 'M') => {
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  const divisor = unit === 'B' ? 1e9 : 1e6;
  return `${isNegative ? '-' : ''}${(absVal / divisor).toFixed(2)}${unit}`;
};

const formatPct = (val: number) => `${(val * 100).toFixed(2)}%`;

export default function App() {
  const [tickerInput, setTickerInput] = useState('');
  const [ticker, setTicker] = useState('');
  const [showLanding, setShowLanding] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  // Sliders
  const [revGrowthStart, setRevGrowthStart] = useState(5); // % year 1
  const [revGrowthEnd, setRevGrowthEnd] = useState(5); // % final year
  const [ebitMarginStart, setEbitMarginStart] = useState(10); // % year 1
  const [ebitMarginEnd, setEbitMarginEnd] = useState(10); // % final year
  const [termGrowth, setTermGrowth] = useState(2); // %
  const [waccAdj, setWaccAdj] = useState(0); // %
  const [erp, setErp] = useState(6); // %
  const [forecastYears, setForecastYears] = useState(5);
  const [formatUnit, setFormatUnit] = useState<'M' | 'B'>('B');
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'dcf' | 'comp' | 'grade'>('dcf');
  const [analystTarget, setAnalystTarget] = useState<{ mean: number; high: number; low: number } | null>(null);

  const handleLegendClick = (e: any, chartKeys: string[]) => {
    setHiddenSeries(prev => {
      const allOthersHidden = chartKeys.every(k => k === e.dataKey || prev[k]);
      
      if (allOthersHidden && !prev[e.dataKey]) {
        // If this is the only one showing, and we click it, show all
        const newState = { ...prev };
        chartKeys.forEach(k => newState[k] = false);
        return newState;
      } else {
        // Isolate the clicked one
        const newState = { ...prev };
        chartKeys.forEach(k => {
          newState[k] = k !== e.dataKey;
        });
        return newState;
      }
    });
  };

  const fetchData = async (symbol: string) => {
    setLoading(true);
    setError('');
    try {
      const cacheKey = `finnhub_${symbol}_financials`;
      const cached = localStorage.getItem(cacheKey);
      let fetchedData;

      if (cached) {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          fetchedData = data;
        }
      }

      if (!fetchedData) {
        // Fetch Financials
        const resFin = await fetch(`${BASE_URL}/stock/financials-reported?symbol=${symbol}&freq=annual&token=${API_KEY}`);
        const finData = await resFin.json();

        // Fetch Profile for Beta, Market Cap, Shares Outstanding
        const resProf = await fetch(`${BASE_URL}/stock/profile2?symbol=${symbol}&token=${API_KEY}`);
        const profData = await resProf.json();

        // Fetch Basic Financials for Beta (if not in profile)
        const resMetric = await fetch(`${BASE_URL}/stock/metric?symbol=${symbol}&metric=all&token=${API_KEY}`);
        const metricData = await resMetric.json();

        if (finData.error || profData.error || metricData.error) {
          throw new Error(finData.error || profData.error || metricData.error);
        }

        fetchedData = {
          financials: finData.data,
          profile: profData,
          metrics: metricData.metric
        };

        localStorage.setItem(cacheKey, JSON.stringify({
          timestamp: Date.now(),
          data: fetchedData
        }));
      }

      if (!fetchedData.financials || fetchedData.financials.length === 0) {
        throw new Error('No financial data found for this ticker.');
      }

      setData(fetchedData);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data from Finnhub API.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ticker) {
      fetchData(ticker);
      setAnalystTarget(null);
      fetch(`${BASE_URL}/stock/price-target?symbol=${ticker}&token=${API_KEY}`)
        .then(r => r.json())
        .then(d => {
          if (d?.targetMean || d?.targetMedian) {
            setAnalystTarget({ mean: d.targetMean ?? d.targetMedian ?? 0, high: d.targetHigh ?? 0, low: d.targetLow ?? 0 });
          }
        })
        .catch(() => {});
    }
  }, [ticker]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickerInput.trim()) {
      setTicker(tickerInput.trim().toUpperCase());
    }
  };

  const handleGoBack = () => {
    setData(null);
    setTicker('');
    setTickerInput('');
    setAnalystTarget(null);
  };

  const dcf = useMemo(() => {
    if (!data) return null;

    const { financials, profile, metrics } = data;

    if (!financials || financials.length === 0) return null;

    // Helper to find concept value in a report section
    const findConcept = (section: any[], concepts: string[]) => {
      if (!section) return 0;
      for (const concept of concepts) {
        const item = section.find((i: any) => i.concept === concept);
        if (item) return parseNum(item.value);
      }
      return 0;
    };

    const getRev = (report: any) => findConcept(report.report.ic, ['us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap_SalesRevenueNet', 'us-gaap_Revenues', 'ifrs-full_Revenue']);
    const getShares = (report: any) => findConcept(report.report.ic, ['us-gaap_WeightedAverageNumberOfSharesOutstandingBasic', 'ifrs-full_WeightedAverageShares', 'ifrs-full_NumberOfSharesOutstanding']) || findConcept(report.report.bs, ['us-gaap_CommonStockSharesOutstanding']);

    const revs = financials.slice(0, 6).map(getRev);
    let revCagr3yr = 0;
    let revCagr5yr = 0;
    if (revs.length >= 4 && revs[3] > 0 && revs[0] > 0) {
      revCagr3yr = Math.pow(revs[0] / revs[3], 1/3) - 1;
    }
    if (revs.length >= 6 && revs[5] > 0 && revs[0] > 0) {
      revCagr5yr = Math.pow(revs[0] / revs[5], 1/5) - 1;
    }

    const sharesArr = financials.slice(0, 6).map(getShares);
    let sharesCagr3yr = 0;
    let sharesCagr5yr = 0;
    if (sharesArr.length >= 4 && sharesArr[3] > 0 && sharesArr[0] > 0) {
      sharesCagr3yr = Math.pow(sharesArr[0] / sharesArr[3], 1/3) - 1;
    }
    if (sharesArr.length >= 6 && sharesArr[5] > 0 && sharesArr[0] > 0) {
      sharesCagr5yr = Math.pow(sharesArr[0] / sharesArr[5], 1/5) - 1;
    }

    const historicalSummary = financials.slice(0, 6).map((report: any, index: number, arr: any[]) => {
      const ic = report.report.ic;
      const bs = report.report.bs;
      const cf = report.report.cf;

      const rev = getRev(report);
      const prevRev = index < arr.length - 1 ? getRev(arr[index + 1]) : rev;
      const revGrowth = prevRev ? (rev - prevRev) / prevRev : 0;

      const gp = findConcept(ic, ['us-gaap_GrossProfit', 'ifrs-full_GrossProfit']);
      const ebit = findConcept(ic, ['us-gaap_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities']);
      const tax = findConcept(ic, ['us-gaap_IncomeTaxExpenseBenefit', 'ifrs-full_IncomeTaxExpenseContinuingOperations', 'ifrs-full_IncomeTaxExpense']);
      const netIncome = findConcept(ic, ['us-gaap_NetIncomeLoss', 'ifrs-full_ProfitLoss']);
      const da = findConcept(cf, ['us-gaap_DepreciationDepletionAndAmortization', 'us-gaap_DepreciationAmortizationAndAccretionNet', 'ifrs-full_DepreciationAndAmortisationExpense']);
      const ebitda = ebit + da;
      const eps = findConcept(ic, ['us-gaap_EarningsPerShareBasic', 'ifrs-full_BasicEarningsLossPerShare']);
      const shares = findConcept(ic, ['us-gaap_WeightedAverageNumberOfSharesOutstandingBasic', 'ifrs-full_WeightedAverageShares', 'ifrs-full_NumberOfSharesOutstanding']) || findConcept(bs, ['us-gaap_CommonStockSharesOutstanding']);

      const totalAssets = findConcept(bs, ['us-gaap_Assets', 'ifrs-full_Assets']);
      const currentLiabilities = findConcept(bs, ['us-gaap_LiabilitiesCurrent', 'ifrs-full_CurrentLiabilities']);
      const nonCurrentLiabilities = findConcept(bs, ['us-gaap_LiabilitiesNoncurrent', 'ifrs-full_NoncurrentLiabilities']);
      const totalLiabilities = findConcept(bs, ['us-gaap_Liabilities', 'ifrs-full_Liabilities']) || (currentLiabilities + nonCurrentLiabilities);
      const totalEquity = findConcept(bs, ['us-gaap_StockholdersEquity', 'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'us-gaap_PartnersCapital', 'us-gaap_CommonStockholdersEquity', 'ifrs-full_Equity']);
      const cash = findConcept(bs, ['us-gaap_CashAndCashEquivalentsAtCarryingValue', 'us-gaap_CashAndCashEquivalentsAtCarryingValueIncludingVariableInterestEntities', 'ifrs-full_CashAndCashEquivalents']);
      
      const currentAssets = findConcept(bs, ['us-gaap_AssetsCurrent', 'ifrs-full_CurrentAssets']);
      const inventory = findConcept(bs, ['us-gaap_InventoryNet', 'ifrs-full_Inventories']);
      
      const shortTermDebt = findConcept(bs, ['us-gaap_LongTermDebtCurrent', 'us-gaap_ShortTermDebt', 'us-gaap_DebtCurrent', 'us-gaap_ShortTermBorrowings', 'us-gaap_CommercialPaper', 'us-gaap_NotesPayableCurrent', 'ifrs-full_CurrentBorrowings']);
      const longTermDebt = findConcept(bs, ['us-gaap_LongTermDebtNoncurrent', 'us-gaap_LongTermDebt', 'us-gaap_LongTermDebtAndCapitalLeaseObligations', 'us-gaap_LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'ifrs-full_NoncurrentBorrowings']);
      const totalDebt = shortTermDebt + longTermDebt;
      
      const interestExpense = Math.abs(findConcept(ic, ['us-gaap_InterestExpense', 'us-gaap_InterestPaidNet', 'ifrs-full_InterestExpense']) || findConcept(cf, ['us-gaap_InterestPaidNet', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities']));

      const cfo = findConcept(cf, ['us-gaap_NetCashProvidedByUsedInOperatingActivities', 'us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'ifrs-full_CashFlowsFromUsedInOperatingActivities']);
      const cfi = findConcept(cf, ['us-gaap_NetCashProvidedByUsedInInvestingActivities', 'us-gaap_NetCashProvidedByUsedInInvestingActivitiesContinuingOperations', 'ifrs-full_CashFlowsFromUsedInInvestingActivities']);
      const cff = findConcept(cf, ['us-gaap_NetCashProvidedByUsedInFinancingActivities', 'us-gaap_NetCashProvidedByUsedInFinancingActivitiesContinuingOperations', 'ifrs-full_CashFlowsFromUsedInFinancingActivities']);
      const capex = Math.abs(findConcept(cf, ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 'ifrs-full_PurchaseOfPropertyPlantAndEquipment']));
      const changeInCash = findConcept(cf, ['us-gaap_CashAndCashEquivalentsPeriodIncreaseDecrease', 'us-gaap_CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect', 'ifrs-full_IncreaseDecreaseInCashAndCashEquivalents']);

      const currentRatio = currentLiabilities ? currentAssets / currentLiabilities : 0;
      const quickRatio = currentLiabilities ? (currentAssets - inventory) / currentLiabilities : 0;
      const interestCoverage = interestExpense ? ebit / interestExpense : 0;
      const debtToEquity = totalEquity ? totalDebt / totalEquity : 0;
      const roe = totalEquity ? netIncome / totalEquity : 0;
      const roa = totalAssets ? netIncome / totalAssets : 0;
      
      const netReceivables = findConcept(bs, ['us-gaap_AccountsReceivableNetCurrent', 'ifrs-full_TradeAndOtherCurrentReceivables']);
      const accountsPayable = findConcept(bs, ['us-gaap_AccountsPayableCurrent', 'ifrs-full_TradeAndOtherCurrentPayables']);
      const wc = (netReceivables + inventory) - accountsPayable;

      const ebiat = ebit - tax;
      const fcff = ebiat + da - capex;

      const yearStr = report.endDate ? report.endDate.substring(0, 7) : report.year;

      return {
        year: yearStr,
        rev, revGrowth, gp, gpm: rev ? gp/rev : 0,
        ebit, ebitMargin: rev ? ebit/rev : 0,
        ebitda, ebitdaMargin: rev ? ebitda/rev : 0,
        netIncome, netProfitMargin: rev ? netIncome/rev : 0,
        eps, shares,
        totalAssets, totalLiabilities, totalDebt, totalEquity, cash, wc,
        cfo, cfi, cff, capex, changeInCash,
        currentRatio, quickRatio, interestCoverage, debtToEquity, roe, roa,
        grossMargin: rev ? gp / rev : 0,
        profitMargin: rev ? netIncome / rev : 0,
        taxRate: ebit ? tax / ebit : 0,
        ebiat, dna: da, deltaWc: 0, fcff
      };
    }).slice(0, 5).reverse();

    // 1. Tax Rate (5-year average)
    const taxRates = financials.slice(0, 5).map((report: any) => {
      const ic = report.report.ic;
      const tax = findConcept(ic, ['us-gaap_IncomeTaxExpenseBenefit', 'ifrs-full_IncomeTaxExpenseContinuingOperations', 'ifrs-full_IncomeTaxExpense']);
      const ebt = findConcept(ic, ['us-gaap_IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'us-gaap_IncomeBeforeTax', 'ifrs-full_ProfitLossBeforeTax']);
      return ebt !== 0 ? tax / ebt : 0;
    });
    const avgTaxRate = taxRates.length > 0 ? taxRates.reduce((a: number, b: number) => a + b, 0) / taxRates.length : 0.21;

    // 2. Base Year Metrics (Year 0)
    const latestReport = financials[0].report;
    const ic = latestReport.ic;
    const bs = latestReport.bs;
    const cf = latestReport.cf;

    const baseRev = findConcept(ic, ['us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap_SalesRevenueNet', 'us-gaap_Revenues', 'ifrs-full_Revenue']);
    const baseEbit = findConcept(ic, ['us-gaap_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities']);
    const ebitMargin = baseRev !== 0 ? baseEbit / baseRev : 0;

    const baseDna = findConcept(cf, ['us-gaap_DepreciationDepletionAndAmortization', 'us-gaap_DepreciationAmortizationAndAccretionNet', 'ifrs-full_DepreciationAndAmortisationExpense']);
    const dnaMargin = baseRev !== 0 ? baseDna / baseRev : 0;

    const baseCapex = Math.abs(findConcept(cf, ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 'ifrs-full_PurchaseOfPropertyPlantAndEquipment']));
    const capexMargin = baseRev !== 0 ? baseCapex / baseRev : 0;

    const netReceivables = findConcept(bs, ['us-gaap_AccountsReceivableNetCurrent', 'ifrs-full_TradeAndOtherCurrentReceivables']);
    const inventory = findConcept(bs, ['us-gaap_InventoryNet', 'ifrs-full_Inventories']);
    const accountsPayable = findConcept(bs, ['us-gaap_AccountsPayableCurrent', 'ifrs-full_TradeAndOtherCurrentPayables']);
    const baseWc = (netReceivables + inventory) - accountsPayable;
    const wcMargin = baseRev !== 0 ? baseWc / baseRev : 0;

    // 3. WACC Calculation
    const beta = parseNum(metrics?.beta) || 1.0;
    const rf = 0.04;
    const ke = rf + beta * (erp / 100);

    const shortTermDebt = findConcept(bs, ['us-gaap_LongTermDebtCurrent', 'us-gaap_ShortTermDebt', 'us-gaap_DebtCurrent', 'us-gaap_ShortTermBorrowings', 'us-gaap_CommercialPaper', 'us-gaap_NotesPayableCurrent', 'ifrs-full_CurrentBorrowings']);
    const longTermDebt = findConcept(bs, ['us-gaap_LongTermDebtNoncurrent', 'us-gaap_LongTermDebt', 'us-gaap_LongTermDebtAndCapitalLeaseObligations', 'us-gaap_LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'ifrs-full_NoncurrentBorrowings']);
    const totalDebt = shortTermDebt + longTermDebt;

    const interestExpense = Math.abs(findConcept(ic, ['us-gaap_InterestExpense', 'us-gaap_InterestPaidNet', 'ifrs-full_InterestExpense']) || findConcept(cf, ['us-gaap_InterestPaidNet', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities']));
    const kd = totalDebt !== 0 ? interestExpense / totalDebt : 0;

    // Market Cap from profile is in millions, convert to actual value
    const marketCap = parseNum(profile?.marketCapitalization) * 1e6 || parseNum(metrics?.marketCapitalization) * 1e6;
    const totalValue = marketCap + totalDebt;
    const wEquity = totalValue !== 0 ? marketCap / totalValue : 1;
    const wDebt = totalValue !== 0 ? totalDebt / totalValue : 0;

    const baseWacc = wEquity * ke + wDebt * kd * (1 - avgTaxRate);
    const wacc = Math.max(baseWacc + (waccAdj / 100), (termGrowth / 100) + 0.001); // Prevent infinite TV

    const sharesOut = parseNum(profile?.shareOutstanding) * 1e6 || findConcept(bs, ['us-gaap_CommonStockSharesOutstanding', 'us-gaap_WeightedAverageNumberOfSharesOutstandingBasic', 'ifrs-full_WeightedAverageShares', 'ifrs-full_NumberOfSharesOutstanding']);

    // 4. Projections
    const projections = [];
    let prevRev = baseRev;
    let prevWc = baseWc;
    let prevShares = sharesOut;

    const lastHistYearStr = historicalSummary.length > 0 ? historicalSummary[historicalSummary.length - 1].year.toString() : new Date().getFullYear().toString();
    const lastYearNum = parseInt(lastHistYearStr.substring(0, 4));

    const currentMonth = new Date().getMonth() + 1;
    const fractionOfYear = 1 - (currentMonth / 12);

    for (let i = 1; i <= forecastYears; i++) {
      const projYear = lastYearNum + i;
      const yearGrowth = forecastYears <= 1
        ? revGrowthStart
        : revGrowthStart + (revGrowthEnd - revGrowthStart) * (i - 1) / (forecastYears - 1);
      const rev = prevRev * (1 + yearGrowth / 100);
      const shares = prevShares * (1 + sharesCagr3yr);
      const yearEbitMargin = forecastYears <= 1
        ? ebitMarginStart / 100
        : (ebitMarginStart + (ebitMarginEnd - ebitMarginStart) * (i - 1) / (forecastYears - 1)) / 100;
      const ebit = rev * yearEbitMargin;
      const tax = ebit * avgTaxRate;
      const ebiat = ebit - tax;
      const dna = rev * dnaMargin;
      const capex = rev * capexMargin;
      const wc = rev * wcMargin;
      const deltaWc = wc - prevWc;

      const fcff = ebiat + dna - capex - deltaWc;

      const discountPeriod = i === 1 ? fractionOfYear * 0.5 : fractionOfYear + (i - 2) + 0.5;
      const discountedFcff = fcff / Math.pow(1 + wacc, discountPeriod);
      
      let tv = 0;
      let discountedTv = 0;
      if (i === forecastYears) {
        tv = fcff * (1 + termGrowth / 100) / (wacc - termGrowth / 100);
        const tvDiscountPeriod = fractionOfYear + (i - 1);
        discountedTv = tv / Math.pow(1 + wacc, tvDiscountPeriod);
      }

      projections.push({
        year: `${projYear}E`,
        rev,
        ebit,
        taxRate: avgTaxRate,
        ebiat,
        dna,
        capex,
        deltaWc,
        fcff,
        discountPeriod,
        discountedFcff,
        tv,
        discountedTv,
        shares
      });

      prevRev = rev;
      prevWc = wc;
      prevShares = shares;
    }

    // 5. Valuation
    let pvFcff = 0;
    projections.forEach((p) => {
      pvFcff += p.discountedFcff;
    });

    const tv = projections[forecastYears - 1].tv;
    const pvTv = projections[forecastYears - 1].discountedTv;

    const ev = pvFcff + pvTv;
    const totalCash = findConcept(bs, ['us-gaap_CashAndCashEquivalentsAtCarryingValue', 'us-gaap_CashAndCashEquivalentsAtCarryingValueIncludingVariableInterestEntities', 'ifrs-full_CashAndCashEquivalents']);
    const equityValue = ev + totalCash - totalDebt;

    const terminalShares = projections.length > 0 ? projections[forecastYears - 1].shares : sharesOut;
    const intrinsicValue = terminalShares !== 0 ? equityValue / terminalShares : 0;

    const currentPrice = sharesOut !== 0 ? marketCap / sharesOut : 0;
    const upside = currentPrice !== 0 ? (intrinsicValue - currentPrice) / currentPrice : 0;

    // Sensitivity Analysis (5×5: WACC rows × terminal growth cols)
    const waccSteps = [-0.02, -0.01, 0, 0.01, 0.02].map(d => wacc + d);
    const growthSteps = [-0.01, -0.005, 0, 0.005, 0.01].map(d => (termGrowth / 100) + d);
    const tvDiscPeriod = fractionOfYear + (forecastYears - 1);
    const lastFcff = projections[forecastYears - 1]?.fcff ?? 0;
    const sensitivityMatrix = growthSteps.map(g =>
      waccSteps.map(w => {
        if (w <= g || w <= 0) return null;
        let pvFcff = 0;
        projections.forEach(p => { pvFcff += p.fcff / Math.pow(1 + w, p.discountPeriod); });
        const tvSens = lastFcff * (1 + g) / (w - g);
        const pvTvSens = tvSens / Math.pow(1 + w, tvDiscPeriod);
        const equitySens = pvFcff + pvTvSens + totalCash - totalDebt;
        return terminalShares > 0 ? equitySens / terminalShares : null;
      })
    );

    return {
      historicalSummary,
      projections,
      intrinsicValue,
      currentPrice,
      upside,
      wacc,
      baseWacc,
      beta,
      avgTaxRate,
      baseRev,
      baseEbitMargin: ebitMargin,
      dnaMargin,
      capexMargin,
      wcMargin,
      baseWc,
      ev,
      equityValue,
      marketCap,
      totalDebt,
      totalCash,
      sharesOut,
      terminalShares,
      revCagr3yr,
      revCagr5yr,
      sharesCagr3yr,
      sharesCagr5yr,
      sensitivityMatrix,
      waccSteps,
      growthSteps,
      fractionOfYear,
    };
  }, [data, revGrowthStart, revGrowthEnd, ebitMarginStart, ebitMarginEnd, termGrowth, waccAdj, erp, forecastYears]);

  const lastTickerRef = useRef('');

  useEffect(() => {
    if (dcf && ticker !== lastTickerRef.current) {
      setRevGrowthStart(Number((dcf.revCagr5yr * 100).toFixed(1)));
      setRevGrowthEnd(Number((dcf.revCagr3yr * 100).toFixed(1)));
      setEbitMarginStart(Number((dcf.baseEbitMargin * 100).toFixed(1)));
      setEbitMarginEnd(Number((dcf.baseEbitMargin * 100).toFixed(1)));
      lastTickerRef.current = ticker;
    }
  }, [dcf, ticker]);

  const applyScenario = (s: 'bull' | 'base' | 'bear') => {
    if (!dcf) return;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    if (s === 'bull') {
      setRevGrowthStart(r1(dcf.revCagr3yr * 100 * 1.25));
      setRevGrowthEnd(r1(Math.max(1, dcf.revCagr3yr * 100 * 0.75)));
      setEbitMarginStart(r1(dcf.baseEbitMargin * 100));
      setEbitMarginEnd(r1(dcf.baseEbitMargin * 100 * 1.15));
      setWaccAdj(-0.5);
    } else if (s === 'base') {
      setRevGrowthStart(r1(dcf.revCagr5yr * 100));
      setRevGrowthEnd(r1(dcf.revCagr3yr * 100));
      setEbitMarginStart(r1(dcf.baseEbitMargin * 100));
      setEbitMarginEnd(r1(dcf.baseEbitMargin * 100));
      setWaccAdj(0);
    } else {
      setRevGrowthStart(r1(dcf.revCagr5yr * 100 * 0.5));
      setRevGrowthEnd(r1(Math.max(-5, dcf.revCagr5yr * 100 * 0.1)));
      setEbitMarginStart(r1(dcf.baseEbitMargin * 100 * 0.85));
      setEbitMarginEnd(r1(dcf.baseEbitMargin * 100 * 0.70));
      setWaccAdj(1.0);
    }
  };

  // Computed: which scenario (if any) matches current slider values
  const activeScenario = useMemo((): 'bull' | 'base' | 'bear' | 'custom' => {
    if (!dcf) return 'custom';
    const r1 = (v: number) => Math.round(v * 10) / 10;
    if (revGrowthStart === r1(dcf.revCagr5yr * 100) && revGrowthEnd === r1(dcf.revCagr3yr * 100) &&
        ebitMarginStart === r1(dcf.baseEbitMargin * 100) && ebitMarginEnd === r1(dcf.baseEbitMargin * 100) && waccAdj === 0)
      return 'base';
    if (revGrowthStart === r1(dcf.revCagr3yr * 100 * 1.25) && revGrowthEnd === r1(Math.max(1, dcf.revCagr3yr * 100 * 0.75)) &&
        ebitMarginStart === r1(dcf.baseEbitMargin * 100) && ebitMarginEnd === r1(dcf.baseEbitMargin * 100 * 1.15) && waccAdj === -0.5)
      return 'bull';
    if (revGrowthStart === r1(dcf.revCagr5yr * 100 * 0.5) && revGrowthEnd === r1(Math.max(-5, dcf.revCagr5yr * 100 * 0.1)) &&
        ebitMarginStart === r1(dcf.baseEbitMargin * 100 * 0.85) && ebitMarginEnd === r1(dcf.baseEbitMargin * 100 * 0.70) && waccAdj === 1.0)
      return 'bear';
    return 'custom';
  }, [dcf, revGrowthStart, revGrowthEnd, ebitMarginStart, ebitMarginEnd, waccAdj]);

  // ── Valuation Bridge ──────────────────────────────────────────────────────
  const bridgeData = useMemo(() => {
    if (!dcf) return null;
    const pvFcff = dcf.projections.reduce((s: number, p: any) => s + p.discountedFcff, 0);
    const pvTv   = dcf.projections.at(-1)?.discountedTv ?? 0;
    const div = formatUnit === 'B' ? 1e9 : 1e6;
    return [
      { label: 'PV of FCFs', value: +(pvFcff / div).toFixed(2), base: 0,                                     type: 'add'   },
      { label: 'PV of TV',   value: +(pvTv   / div).toFixed(2), base: +(pvFcff / div).toFixed(2),            type: 'add'   },
      { label: '= EV',       value: +(dcf.ev  / div).toFixed(2), base: 0,                                    type: 'total' },
      { label: '+ Cash',     value: +(dcf.totalCash / div).toFixed(2), base: +(dcf.ev / div).toFixed(2),     type: 'add'   },
      { label: '− Debt',     value: +(dcf.totalDebt / div).toFixed(2), base: +((dcf.ev + dcf.totalCash - dcf.totalDebt) / div).toFixed(2), type: 'sub' },
      { label: '= Equity',   value: +(dcf.equityValue / div).toFixed(2), base: 0,                            type: 'total' },
    ];
  }, [dcf, formatUnit]);

  // ── Reverse DCF ────────────────────────────────────────────────────────────
  const reverseDcf = useMemo(() => {
    if (!dcf || dcf.currentPrice <= 0 || dcf.terminalShares <= 0 || !dcf.fractionOfYear) return null;
    const pvFcff     = dcf.projections.reduce((s: number, p: any) => s + p.discountedFcff, 0);
    const lastFcff   = dcf.projections.at(-1)?.fcff ?? 0;
    if (lastFcff <= 0) return null; // can't solve for g with non-positive terminal FCF
    const tvDiscPer  = dcf.fractionOfYear + (dcf.projections.length - 1);
    const targetPvTv = (dcf.currentPrice * dcf.terminalShares) - pvFcff - dcf.totalCash + dcf.totalDebt;
    // Binary search: find g where PV(TV) = targetPvTv
    let lo = -0.05, hi = dcf.wacc - 0.001;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (mid >= dcf.wacc) { hi = mid; continue; }
      const tv    = lastFcff * (1 + mid) / (dcf.wacc - mid);
      const pvTv  = tv / Math.pow(1 + dcf.wacc, tvDiscPer);
      if (pvTv < targetPvTv) lo = mid; else hi = mid;
    }
    return { impliedTermGrowth: (lo + hi) / 2 };
  }, [dcf]);

  // ── Scenario Comparison ────────────────────────────────────────────────────
  const scenarioComparison = useMemo(() => {
    if (!dcf) return null;
    const computeScenarioDCF = (revGs: number, revGe: number, ebitMs: number, ebitMe: number, scenWaccAdj: number) => {
      const scenWacc = Math.max(dcf.baseWacc + scenWaccAdj / 100, termGrowth / 100 + 0.001);
      let prevRev = dcf.baseRev, prevWc = dcf.baseWc, prevShares = dcf.sharesOut;
      let sumPvFcff = 0, lastFcff = 0, lastDisc = 0;
      for (let i = 1; i <= forecastYears; i++) {
        const g = forecastYears <= 1 ? revGs : revGs + (revGe - revGs) * (i - 1) / (forecastYears - 1);
        const rev = prevRev * (1 + g / 100);
        const shares = prevShares * (1 + dcf.sharesCagr3yr);
        const margin = forecastYears <= 1 ? ebitMs / 100 : (ebitMs + (ebitMe - ebitMs) * (i - 1) / (forecastYears - 1)) / 100;
        const ebit = rev * margin;
        const ebiat = ebit * (1 - dcf.avgTaxRate);
        const dna = rev * dcf.dnaMargin;
        const capex = rev * dcf.capexMargin;
        const wc = rev * dcf.wcMargin;
        const deltaWc = wc - prevWc;
        const fcff = ebiat + dna - capex - deltaWc;
        const discPeriod = i === 1 ? dcf.fractionOfYear * 0.5 : dcf.fractionOfYear + (i - 2) + 0.5;
        sumPvFcff += fcff / Math.pow(1 + scenWacc, discPeriod);
        if (i === forecastYears) { lastFcff = fcff; lastDisc = dcf.fractionOfYear + (i - 1); }
        prevRev = rev; prevWc = wc; prevShares = shares;
      }
      const tv    = lastFcff * (1 + termGrowth / 100) / (scenWacc - termGrowth / 100);
      const pvTv  = tv / Math.pow(1 + scenWacc, lastDisc);
      const ev    = sumPvFcff + pvTv;
      const eq    = ev + dcf.totalCash - dcf.totalDebt;
      const price = dcf.terminalShares > 0 ? eq / dcf.terminalShares : 0;
      return { price, upside: dcf.currentPrice > 0 ? (price - dcf.currentPrice) / dcf.currentPrice : 0, ev, equityValue: eq };
    };
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      bear: computeScenarioDCF(r1(dcf.revCagr5yr*100*0.5), r1(Math.max(-5,dcf.revCagr5yr*100*0.1)), r1(dcf.baseEbitMargin*100*0.85), r1(dcf.baseEbitMargin*100*0.70), 1.0),
      base: computeScenarioDCF(r1(dcf.revCagr5yr*100),     r1(dcf.revCagr3yr*100),                  r1(dcf.baseEbitMargin*100),       r1(dcf.baseEbitMargin*100),       0),
      bull: computeScenarioDCF(r1(dcf.revCagr3yr*100*1.25),r1(Math.max(1,dcf.revCagr3yr*100*0.75)), r1(dcf.baseEbitMargin*100),       r1(dcf.baseEbitMargin*100*1.15),  -0.5),
    };
  }, [dcf, termGrowth, forecastYears]);

  const printDCF = () => {
    if (!dcf || !data) return;
    const fmtM = (v: number) => {
      const neg = v < 0; const abs = Math.abs(v);
      if (abs >= 1e9) return `${neg ? '-' : ''}$${(abs / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${neg ? '-' : ''}$${(abs / 1e6).toFixed(2)}M`;
      return `${neg ? '-' : ''}$${abs.toFixed(0)}`;
    };
    const fmtP = (v: number) => `${(v * 100).toFixed(1)}%`;
    const scenarioLabel = activeScenario !== 'custom'
      ? activeScenario.charAt(0).toUpperCase() + activeScenario.slice(1) + ' Case' : 'Custom';
    const companyNameStr = (data?.profile?.name ?? ticker).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const histCols = dcf.historicalSummary.map((h: any) => `<th class="hist-h">${h.year.substring(0, 4)}</th>`).join('');
    const projCols = dcf.projections.map((pr: any) => `<th class="proj-h">${pr.year}</th>`).join('');
    const rowFromArrays = (label: string, histVals: string[], projVals: string[]) =>
      `<tr><td class="row-label">${label}</td>${histVals.map(v => `<td class="hist-v">${v}</td>`).join('')}${projVals.map(v => `<td class="proj-v">${v}</td>`).join('')}</tr>`;
    const pvLast = dcf.projections[dcf.projections.length - 1].discountedTv;
    const sensRows = dcf.sensitivityMatrix.map((row: (number | null)[], ri: number) => {
      const g = dcf.growthSteps[ri];
      const isCurG = Math.abs(g - termGrowth / 100) < 0.0001;
      const cells = row.map((iv: number | null, ci: number) => {
        const w = dcf.waccSteps[ci];
        const isCurW = Math.abs(w - dcf.wacc) < 0.0001;
        const cls = [isCurW ? 'cur-w' : '', iv !== null && iv > dcf.currentPrice ? 'up' : iv !== null ? 'dn' : ''].filter(Boolean).join(' ');
        return `<td class="${cls}">${iv !== null ? '$' + iv.toFixed(0) : '&mdash;'}</td>`;
      }).join('');
      return `<tr><th class="g-th${isCurG ? ' cur-g' : ''}">${(g * 100).toFixed(1)}%</th>${cells}</tr>`;
    }).join('');
    const waccHdrs = dcf.waccSteps.map((w: number) =>
      `<th class="${Math.abs(w - dcf.wacc) < 0.0001 ? 'cur-w-h' : ''}">${(w * 100).toFixed(1)}%</th>`).join('');

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${ticker} DCF &mdash; ValuWise</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;color:#1e293b;background:#fff;padding:40px 48px;font-size:12px;line-height:1.5}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e2e8f0}.logo{font-size:16px;font-weight:800;color:#0f172a}.logo em{color:#10b981;font-style:normal}.title{font-size:22px;font-weight:700;color:#0f172a;margin-top:5px}.subtitle{font-size:12px;color:#64748b;margin-top:2px}.hdr-r{text-align:right;color:#64748b;font-size:11px;line-height:2}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}.card{border:1px solid #d1d5db;border-radius:9px;padding:14px 16px}.card-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}.card-val{font-size:24px;font-weight:300;color:#0f172a;letter-spacing:-.5px}.card-sub{font-size:10px;color:#94a3b8;margin-top:3px}.up{color:#059669}.dn{color:#dc2626}h2{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#64748b;margin:22px 0 10px;padding-bottom:5px;border-bottom:1px solid #f1f5f9}.asm{display:grid;grid-template-columns:1fr 1fr;gap:0 32px}.asm-r{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e5e7eb}.asm-k{color:#64748b}.asm-v{font-weight:600;color:#0f172a;font-family:monospace}table{width:100%;border-collapse:collapse;font-size:11px;border:1px solid #d1d5db}th,td{padding:5px 9px;text-align:right;border:1px solid #d1d5db}th{background:#f1f5f9;font-weight:600;color:#374151;font-size:10px}.hist-h,.hist-v{color:#94a3b8}.proj-h,.proj-v{color:#0f172a}.row-label{text-align:left;font-weight:500;color:#374151;min-width:110px}.sum-t{width:46%;border:1px solid #d1d5db}.sum-t td{padding:4px 9px;border:1px solid #d1d5db}.sum-t td:last-child{text-align:right;font-family:monospace;font-weight:500}.sum-tot td{border-top:2px solid #6b7280;font-weight:700;font-size:13px;background:#f8fafc}.sens th,.sens td{padding:4px 7px;border:1px solid #d1d5db;font-size:10px;text-align:center;font-family:monospace}.sens .g-th{background:#f8fafc;font-weight:600;color:#475569}.sens .g-th.cur-g{color:#059669;font-weight:700}.sens .cur-w-h{background:#dcfce7;color:#14532d}.sens .cur-w{border-left:2px solid #16a34a;border-right:2px solid #16a34a}.sens .up{color:#059669}.sens .dn{color:#dc2626}.footer{margin-top:28px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;line-height:1.6}@media print{body{padding:24px 30px}h2{margin-top:16px}}</style></head><body>
<div class="hdr"><div><div class="logo">Valu<em>Wise</em></div><div class="title">${ticker} &mdash; DCF Analysis</div><div class="subtitle">${companyNameStr} &nbsp;&bull;&nbsp; ${scenarioLabel}</div></div><div class="hdr-r"><div><strong>Date</strong>&nbsp; ${dateStr}</div><div><strong>Model</strong>&nbsp; Unlevered FCFF / Gordon Growth Terminal Value</div><div><strong>Data</strong>&nbsp; Finnhub</div></div></div>
<div class="cards"><div class="card"><div class="card-lbl">Intrinsic Value per Share</div><div class="card-val">$${dcf.intrinsicValue.toFixed(2)}</div><div class="card-sub">${forecastYears}-yr DCF &bull; ${scenarioLabel}</div></div><div class="card"><div class="card-lbl">Current Market Price</div><div class="card-val">$${dcf.currentPrice.toFixed(2)}</div><div class="card-sub">Market cap: ${fmtM(dcf.marketCap)}</div></div><div class="card"><div class="card-lbl">Upside / Downside</div><div class="card-val ${dcf.upside >= 0 ? 'up' : 'dn'}">${dcf.upside >= 0 ? '+' : ''}${(dcf.upside * 100).toFixed(1)}%</div><div class="card-sub">${dcf.upside >= 0 ? 'Undervalued vs intrinsic estimate' : 'Overvalued vs intrinsic estimate'}</div></div></div>
<h2>Key Assumptions</h2><div class="asm"><div><div class="asm-r"><span class="asm-k">Revenue Growth &mdash; Year 1</span><span class="asm-v">${revGrowthStart}%</span></div><div class="asm-r"><span class="asm-k">Revenue Growth &mdash; Year ${forecastYears}</span><span class="asm-v">${revGrowthEnd}%</span></div><div class="asm-r"><span class="asm-k">EBIT Margin &mdash; Year 1</span><span class="asm-v">${ebitMarginStart}%</span></div><div class="asm-r"><span class="asm-k">EBIT Margin &mdash; Year ${forecastYears}</span><span class="asm-v">${ebitMarginEnd}%</span></div></div><div><div class="asm-r"><span class="asm-k">WACC</span><span class="asm-v">${fmtP(dcf.wacc)}</span></div><div class="asm-r"><span class="asm-k">Terminal Growth Rate</span><span class="asm-v">${termGrowth}%</span></div><div class="asm-r"><span class="asm-k">Forecast Period</span><span class="asm-v">${forecastYears} years</span></div><div class="asm-r"><span class="asm-k">Beta</span><span class="asm-v">${dcf.beta.toFixed(2)}</span></div></div></div>
<h2>Forecast Model (${formatUnit})</h2><table><thead><tr><th style="text-align:left">Metric</th>${histCols}${projCols}</tr></thead><tbody>${rowFromArrays('Revenue', dcf.historicalSummary.map((h: any) => fmtM(h.rev)), dcf.projections.map((pr: any) => fmtM(pr.rev)))}${rowFromArrays('EBIT', dcf.historicalSummary.map((h: any) => fmtM(h.ebit)), dcf.projections.map((pr: any) => fmtM(pr.ebit)))}${rowFromArrays('EBIT Margin', dcf.historicalSummary.map((h: any) => fmtP(h.ebitMargin)), dcf.projections.map((pr: any) => fmtP(pr.rev ? pr.ebit / pr.rev : 0)))}<tr><td class="row-label">NOPAT (EBIAT)</td>${dcf.historicalSummary.map(() => '<td class="hist-v">&mdash;</td>').join('')}${dcf.projections.map((pr: any) => `<td class="proj-v">${fmtM(pr.ebiat)}</td>`).join('')}</tr><tr><td class="row-label">FCFF</td>${dcf.historicalSummary.map(() => '<td class="hist-v">&mdash;</td>').join('')}${dcf.projections.map((pr: any) => `<td class="proj-v">${fmtM(pr.fcff)}</td>`).join('')}</tr><tr><td class="row-label">PV of FCFF</td>${dcf.historicalSummary.map(() => '<td class="hist-v">&mdash;</td>').join('')}${dcf.projections.map((pr: any) => `<td class="proj-v">${fmtM(pr.discountedFcff)}</td>`).join('')}</tr></tbody></table>
<h2>Valuation Bridge</h2><table class="sum-t"><tbody><tr><td>PV of FCFFs (${forecastYears}-yr)</td><td>${fmtM(dcf.ev - pvLast)}</td></tr><tr><td>PV of Terminal Value</td><td>${fmtM(pvLast)}</td></tr><tr><td>= Enterprise Value</td><td>${fmtM(dcf.ev)}</td></tr><tr><td>+ Cash &amp; Equivalents</td><td>${fmtM(dcf.totalCash)}</td></tr><tr><td>&minus; Total Debt</td><td>(${fmtM(dcf.totalDebt)})</td></tr><tr class="sum-tot"><td>= Equity Value</td><td>${fmtM(dcf.equityValue)}</td></tr><tr><td>Intrinsic Value / Share</td><td>$${dcf.intrinsicValue.toFixed(2)}</td></tr></tbody></table>
<h2>Sensitivity Analysis &mdash; Implied Share Price</h2><p style="font-size:10px;color:#64748b;margin-bottom:8px">Rows: Terminal growth &nbsp;&bull;&nbsp; Columns: WACC &nbsp;&bull;&nbsp; Green = upside vs market price &nbsp;&bull;&nbsp; Current WACC (${fmtP(dcf.wacc)}) highlighted</p><table class="sens"><thead><tr><th class="g-th">g / WACC</th>${waccHdrs}</tr></thead><tbody>${sensRows}</tbody></table>
<div class="footer"><strong>Disclaimer:</strong> This DCF analysis is provided by ValuWise for informational and educational purposes only. It does not constitute investment advice or a solicitation to buy or sell any security. All projections are based on historical data from Finnhub and user-defined assumptions. Conduct independent due diligence before making any investment decisions.</div>
<script>setTimeout(function(){ window.print(); }, 400);</script></body></html>`;
    const win = window.open('', '_blank', 'width=1050,height=800');
    if (!win) { alert('Please allow pop-ups for this site to open the PDF report.'); return; }
    win.document.write(html);
    win.document.close();
  };

  const exportToExcel = () => {
    if (!data || !data.financials) return;
    
    const findConcept = (section: any[], concepts: string[]) => {
      if (!section) return 0;
      for (const concept of concepts) {
        const item = section.find((i: any) => i.concept === concept);
        if (item) return parseNum(item.value);
      }
      return 0;
    };

    const wb = XLSX.utils.book_new();
    
    const icData = data.financials.map((f: any) => {
      const ic = f.report.ic;
      return {
        Year: f.year,
        Revenue: findConcept(ic, ['us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap_SalesRevenueNet', 'us-gaap_Revenues']),
        COGS: findConcept(ic, ['us-gaap_CostOfGoodsAndServicesSold']),
        GrossProfit: findConcept(ic, ['us-gaap_GrossProfit']),
        OperatingExpenses: findConcept(ic, ['us-gaap_OperatingExpenses']),
        OperatingIncome: findConcept(ic, ['us-gaap_OperatingIncomeLoss']),
        NetIncome: findConcept(ic, ['us-gaap_NetIncomeLoss']),
      };
    });
    const wsIc = XLSX.utils.json_to_sheet(icData);
    XLSX.utils.book_append_sheet(wb, wsIc, "Income Statement");

    const bsData = data.financials.map((f: any) => {
      const bs = f.report.bs;
      return {
        Year: f.year,
        CashAndEquivalents: findConcept(bs, ['us-gaap_CashAndCashEquivalentsAtCarryingValue']),
        AccountsReceivable: findConcept(bs, ['us-gaap_AccountsReceivableNetCurrent']),
        Inventory: findConcept(bs, ['us-gaap_InventoryNet']),
        TotalCurrentAssets: findConcept(bs, ['us-gaap_AssetsCurrent']),
        TotalAssets: findConcept(bs, ['us-gaap_Assets']),
        AccountsPayable: findConcept(bs, ['us-gaap_AccountsPayableCurrent']),
        TotalCurrentLiabilities: findConcept(bs, ['us-gaap_LiabilitiesCurrent']),
        TotalLiabilities: findConcept(bs, ['us-gaap_Liabilities']),
        TotalEquity: findConcept(bs, ['us-gaap_StockholdersEquity']),
      };
    });
    const wsBs = XLSX.utils.json_to_sheet(bsData);
    XLSX.utils.book_append_sheet(wb, wsBs, "Balance Sheet");

    const cfData = data.financials.map((f: any) => {
      const cf = f.report.cf;
      return {
        Year: f.year,
        NetIncome: findConcept(cf, ['us-gaap_NetIncomeLoss']),
        DepreciationAndAmortization: findConcept(cf, ['us-gaap_DepreciationDepletionAndAmortization', 'us-gaap_DepreciationAmortizationAndAccretionNet']),
        OperatingCashFlow: findConcept(cf, ['us-gaap_NetCashProvidedByUsedInOperatingActivities', 'us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']),
        CapitalExpenditures: findConcept(cf, ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment']),
        InvestingCashFlow: findConcept(cf, ['us-gaap_NetCashProvidedByUsedInInvestingActivities', 'us-gaap_NetCashProvidedByUsedInInvestingActivitiesContinuingOperations']),
        FinancingCashFlow: findConcept(cf, ['us-gaap_NetCashProvidedByUsedInFinancingActivities', 'us-gaap_NetCashProvidedByUsedInFinancingActivitiesContinuingOperations']),
      };
    });
    const wsCf = XLSX.utils.json_to_sheet(cfData);
    XLSX.utils.book_append_sheet(wb, wsCf, "Cash Flow");

    XLSX.writeFile(wb, `${ticker}_Financials.xlsx`);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setShowLanding(true)}>
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">ValuWise</span>
            </div>
            
            <nav className="hidden md:flex items-center gap-1">
              <button
                onClick={() => { setActiveTab('dcf'); setShowLanding(false); }}
                className={`px-3 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition-colors ${activeTab === 'dcf' && !showLanding ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
              >
                <Activity className="w-4 h-4" />
                DCF Model
              </button>
              <button
                onClick={() => { setActiveTab('comp'); setShowLanding(false); }}
                className={`px-3 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition-colors ${activeTab === 'comp' && !showLanding ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
              >
                <Users className="w-4 h-4" />
                Comp Analysis
              </button>
              <button
                onClick={() => { setActiveTab('grade'); setShowLanding(false); }}
                className={`px-3 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition-colors ${activeTab === 'grade' && !showLanding ? 'bg-slate-800 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
              >
                <Award className="w-4 h-4" />
                Company Grade
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {showLanding ? (
          <div className="max-w-3xl mx-auto text-center py-20 space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-bold tracking-tight text-white">
                Professional <span className="text-emerald-500">Equity Valuation</span> Tool
              </h1>
              <p className="text-xl text-slate-400">
                Analyze stocks using Discounted Cash Flow (DCF) models, Comparable Company Analysis, and a financial report card grading system.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <button 
                onClick={() => { setActiveTab('dcf'); setShowLanding(false); }}
                className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 space-y-3 hover:bg-slate-800 hover:border-emerald-500/50 transition-all group text-left"
              >
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                  <Activity className="w-6 h-6 text-emerald-500" />
                </div>
                <h3 className="text-lg font-semibold text-white">DCF Modeling</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Project future free cash flows, determine terminal value, and discount back to present value using WACC.
                </p>
              </button>
              <button
                onClick={() => { setActiveTab('comp'); setShowLanding(false); }}
                className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 space-y-3 hover:bg-slate-800 hover:border-blue-500/50 transition-all group text-left"
              >
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                  <Users className="w-6 h-6 text-blue-500" />
                </div>
                <h3 className="text-lg font-semibold text-white">Comp Analysis</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Compare valuation multiples like EV/EBITDA and P/E against industry peers to find relative value.
                </p>
              </button>
              <button
                onClick={() => { setActiveTab('grade'); setShowLanding(false); }}
                className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 space-y-3 hover:bg-slate-800 hover:border-emerald-500/50 transition-all group text-left"
              >
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                  <Award className="w-6 h-6 text-emerald-500" />
                </div>
                <h3 className="text-lg font-semibold text-white">Company Grade</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Get a letter-grade report card (A–D) across financial health, profitability, growth, and cash flow quality.
                </p>
              </button>
            </div>

            <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl px-5 py-4 text-left max-w-2xl mx-auto">
              <svg className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-amber-400 mb-0.5">US-Listed Stocks Only</p>
                <p className="text-sm text-slate-400 leading-relaxed">
                  ValuWise currently only supports stocks listed on US exchanges (NYSE, NASDAQ). Foreign-listed companies such as <span className="text-slate-300">NVO</span> (Novo Nordisk), <span className="text-slate-300">TSM</span> (TSMC), or other ADRs and international tickers may return incomplete or no data.
                </p>
              </div>
            </div>
          </div>
        ) : activeTab === 'comp' ? (
          <CompAnalysis />
        ) : activeTab === 'grade' ? (
          <CompanyGrade />
        ) : (
          <>
            {(!data || error) && !loading && (
              <div className="max-w-2xl mx-auto py-8 space-y-5">
                <form onSubmit={handleSearch} className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={tickerInput}
                    onChange={(e) => setTickerInput(e.target.value)}
                    placeholder="Enter a stock ticker (e.g. AAPL, MSFT, TSLA)"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-12 pr-28 py-4 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent uppercase transition-all shadow-xl"
                  />
                  <button
                    type="submit"
                    disabled={!tickerInput.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Analyze
                  </button>
                </form>
                <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Info className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-300">About the DCF Model</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Build a Discounted Cash Flow valuation from reported financials. The model projects Free Cash Flow to the Firm (FCFF) using your growth and margin assumptions, discounts at WACC, and adds a Gordon Growth terminal value to arrive at an intrinsic price per share.
                  </p>
                  <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {[
                      'Enter a ticker and press Analyze to fetch historical financials from Finnhub.',
                      'The model pre-fills Revenue Growth and EBIT Margin from the company\'s historical CAGR.',
                      'Adjust sliders to reflect your own projections, or use Bear / Base / Bull presets.',
                      'The sensitivity table maps implied share price across WACC × terminal growth combinations.',
                      'Cells highlighted green indicate upside vs current price; ring marks the current assumptions.',
                      'Click Print / PDF to generate a clean, printer-friendly report with all key outputs.',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-xs text-slate-400">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs text-emerald-400 font-semibold">{i + 1}</span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-400 animate-pulse">Fetching financial data...</p>
              </div>
            ) : error ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-red-500 font-medium">Error loading data</h3>
              <p className="text-red-400/80 text-sm mt-1">{error}</p>
            </div>
          </div>
        ) : dcf && data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Controls & Assumptions */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-medium flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-emerald-500" />
                    Assumptions
                  </h2>
                  <button
                    onClick={handleGoBack}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-700/50 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Search className="w-3 h-3" />
                    New Search
                  </button>
                </div>
                
                <div className="space-y-6">
                  {/* Scenario Presets */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500 uppercase font-semibold tracking-wide">Scenario</label>
                      {activeScenario === 'custom' && <span className="text-xs text-slate-600 italic">Custom</span>}
                    </div>
                    <div className="flex gap-2">
                      {(['bear', 'base', 'bull'] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => applyScenario(s)}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                            activeScenario === s
                              ? s === 'bull' ? 'bg-emerald-600 text-white' : s === 'bear' ? 'bg-red-600 text-white' : 'bg-slate-500 text-white'
                              : 'bg-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                          }`}
                        >
                          {s === 'bull' ? 'Bull' : s === 'bear' ? 'Bear' : 'Base'}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-slate-600">
                      {activeScenario === 'bull' ? 'High growth + margin expansion + lower WACC' :
                       activeScenario === 'bear' ? 'Low growth + margin compression + higher WACC' :
                       activeScenario === 'base' ? 'Historical CAGR defaults' : 'Manually adjusted'}
                    </div>
                  </div>

                  {/* Revenue Growth — Tapered */}
                  <div className="space-y-3">
                    <label className="text-sm text-slate-400">Revenue Growth Rate</label>
                    <div className="text-xs text-slate-500">
                      CAGR 3yr: {formatPct(dcf.revCagr3yr)} | CAGR 5yr: {formatPct(dcf.revCagr5yr)}
                    </div>
                    {/* Start */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Yr 1 (Start)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            value={revGrowthStart}
                            onChange={(e) => setRevGrowthStart(Number(e.target.value))}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-emerald-400 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-mono text-emerald-400">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="-20"
                        max="50"
                        step="0.5"
                        value={revGrowthStart}
                        onChange={(e) => setRevGrowthStart(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    {/* End */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Yr {forecastYears} (End)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            value={revGrowthEnd}
                            onChange={(e) => setRevGrowthEnd(Number(e.target.value))}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-emerald-400 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-mono text-emerald-400">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="-20"
                        max="50"
                        step="0.5"
                        value={revGrowthEnd}
                        onChange={(e) => setRevGrowthEnd(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    {revGrowthStart !== revGrowthEnd && (
                      <div className="text-xs text-slate-600 italic">
                        Linear taper: {revGrowthStart}% → {revGrowthEnd}%
                      </div>
                    )}
                  </div>

                  {/* EBIT Margin — Tapered */}
                  <div className="space-y-3">
                    <label className="text-sm text-slate-400">EBIT Margin</label>
                    <div className="text-xs text-slate-500">
                      Base year: {dcf.baseEbitMargin >= 0 ? '+' : ''}{(dcf.baseEbitMargin * 100).toFixed(1)}%
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Yr 1 (Start)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            value={ebitMarginStart}
                            onChange={(e) => setEbitMarginStart(Number(e.target.value))}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-emerald-400 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-mono text-emerald-400">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="-30"
                        max="60"
                        step="0.5"
                        value={ebitMarginStart}
                        onChange={(e) => setEbitMarginStart(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Yr {forecastYears} (End)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            value={ebitMarginEnd}
                            onChange={(e) => setEbitMarginEnd(Number(e.target.value))}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-emerald-400 text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <span className="text-xs font-mono text-emerald-400">%</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="-30"
                        max="60"
                        step="0.5"
                        value={ebitMarginEnd}
                        onChange={(e) => setEbitMarginEnd(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    {ebitMarginStart !== ebitMarginEnd && (
                      <div className="text-xs text-slate-600 italic">
                        Linear taper: {ebitMarginStart}% → {ebitMarginEnd}%
                      </div>
                    )}
                  </div>

                  {/* Terminal Growth Slider */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm text-slate-400">Terminal Growth Rate</label>
                      <span className="text-sm font-mono text-emerald-400">{termGrowth}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="5"
                      step="0.5"
                      value={termGrowth}
                      onChange={(e) => setTermGrowth(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  {/* WACC Adjustment Slider */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm text-slate-400">WACC Adjustment</label>
                      <span className="text-sm font-mono text-emerald-400">{waccAdj > 0 ? '+' : ''}{waccAdj}%</span>
                    </div>
                    <input
                      type="range"
                      min="-5"
                      max="5"
                      step="0.5"
                      value={waccAdj}
                      onChange={(e) => setWaccAdj(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  {/* ERP Slider */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm text-slate-400">Equity Risk Premium</label>
                      <span className="text-sm font-mono text-emerald-400">{erp}%</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="10"
                      step="0.5"
                      value={erp}
                      onChange={(e) => setErp(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>

                  {/* Forecast Years */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-sm text-slate-400">Forecast Period</label>
                      <div className="flex gap-2">
                        {[3, 5, 7, 10].map(y => (
                          <button
                            key={y}
                            onClick={() => setForecastYears(y)}
                            className={`px-2.5 py-1 text-xs rounded-md ${forecastYears === y ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
                          >
                            {y}yr
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-700/50 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Calculated WACC</span>
                    <span className="font-mono">{formatPct(dcf.wacc)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Beta</span>
                    <span className="font-mono">{dcf.beta.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Avg Tax Rate</span>
                    <span className="font-mono">{formatPct(dcf.avgTaxRate)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Output & Charts */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* Top Metrics Row */}
              <div className={`grid grid-cols-1 gap-4 ${analystTarget ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <div className="text-sm text-slate-400 mb-1">Intrinsic Value</div>
                  <div className="text-3xl font-light tracking-tight">
                    ${dcf.intrinsicValue.toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">{activeScenario !== 'custom' ? activeScenario.charAt(0).toUpperCase() + activeScenario.slice(1) + ' case' : 'Custom'}</div>
                </div>

                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <div className="text-sm text-slate-400 mb-1">Current Price</div>
                  <div className="text-3xl font-light tracking-tight">
                    ${dcf.currentPrice.toFixed(2)}
                  </div>
                </div>

                <div className={`bg-slate-800/50 border rounded-xl p-5 ${dcf.upside >= 0 ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
                  <div className="text-sm text-slate-400 mb-1">Upside / Downside</div>
                  <div className={`text-3xl font-light tracking-tight flex items-center gap-2 ${dcf.upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {dcf.upside >= 0 ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                    {formatPct(dcf.upside)}
                  </div>
                </div>

                {analystTarget && (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                    <div className="text-sm text-slate-400 mb-1 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5" /> Analyst Target
                    </div>
                    <div className="text-3xl font-light tracking-tight">${analystTarget.mean.toFixed(2)}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Range: ${analystTarget.low.toFixed(0)}–${analystTarget.high.toFixed(0)}
                    </div>
                    <div className={`text-xs mt-1 font-medium ${dcf.currentPrice < analystTarget.mean ? 'text-emerald-400' : 'text-red-400'}`}>
                      {dcf.currentPrice > 0 ? `${dcf.currentPrice < analystTarget.mean ? '+' : ''}${((analystTarget.mean - dcf.currentPrice) / dcf.currentPrice * 100).toFixed(1)}% vs price` : ''}
                    </div>
                  </div>
                )}
              </div>

              {/* Reverse DCF insight */}
              {reverseDcf && (
                <div className={`border rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                  reverseDcf.impliedTermGrowth < 0.02 ? 'bg-emerald-500/5 border-emerald-500/25' :
                  reverseDcf.impliedTermGrowth < 0.04 ? 'bg-amber-500/5 border-amber-500/25' :
                                                        'bg-red-500/5 border-red-500/25'}`}>
                  <div className="flex-1">
                    <div className="text-xs text-slate-500 mb-0.5">Market-Implied Terminal Growth</div>
                    <div className={`text-2xl font-light font-mono ${
                      reverseDcf.impliedTermGrowth < 0.02 ? 'text-emerald-400' :
                      reverseDcf.impliedTermGrowth < 0.04 ? 'text-amber-400' : 'text-red-400'}`}>
                      {(reverseDcf.impliedTermGrowth * 100).toFixed(2)}%
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    At ${dcf.currentPrice.toFixed(2)}/share, holding WACC at {formatPct(dcf.wacc)} and current revenue projections, the market prices in {(reverseDcf.impliedTermGrowth * 100).toFixed(2)}% long-run terminal growth.
                    {reverseDcf.impliedTermGrowth >= 0.04 ? ' This implies high long-term expectations.' : reverseDcf.impliedTermGrowth < 0 ? ' This implies the market expects long-run contraction.' : ''}
                  </p>
                </div>
              )}

              {/* Chart */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
                <h3 className="text-lg font-medium mb-6">Projected Free Cash Flow (FCFF)</h3>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dcf.projections} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis 
                        dataKey="year" 
                        stroke="#94a3b8" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false} 
                      />
                      <YAxis 
                        stroke="#94a3b8" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(value) => `$${(value / 1e9).toFixed(0)}B`}
                      />
                      <Tooltip 
                        cursor={{ fill: '#334155', opacity: 0.4 }}
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                        itemStyle={{ color: '#10b981' }}
                        formatter={(value: number) => [formatCurrency(value), 'FCFF']}
                      />
                      <ReferenceLine y={0} stroke="#475569" />
                      <Bar 
                        dataKey="fcff" 
                        fill="#10b981" 
                        radius={[4, 4, 0, 0]} 
                        maxBarSize={60}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Historical Trend Charts */}
              {dcf.historicalSummary.length >= 2 && (() => {
                const histChart = dcf.historicalSummary.map((h: any) => ({
                  year: h.year.substring(0, 4),
                  rev: +(h.rev / (formatUnit === 'B' ? 1e9 : 1e6)).toFixed(2),
                  revGrowth: +(h.revGrowth * 100).toFixed(1),
                  grossMargin:    +(h.grossMargin    * 100).toFixed(1),
                  ebitMargin:     +(h.ebitMargin     * 100).toFixed(1),
                  ebitdaMargin:   +(h.ebitdaMargin   * 100).toFixed(1),
                  netMargin:      +(h.netProfitMargin * 100).toFixed(1),
                }));
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Revenue & Growth */}
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                      <h3 className="text-sm font-medium text-slate-300 mb-4">Historical Revenue &amp; Growth</h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={histChart} margin={{ top: 4, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                          <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                          <YAxis yAxisId="left"  tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `$${v}${formatUnit}`} width={48} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}%`} width={40} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(v: number, name: string) => [name === 'Revenue' ? `$${v}${formatUnit}` : `${v}%`, name]}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          <Bar  yAxisId="left"  dataKey="rev"       name="Revenue"     fill="#34d399" opacity={0.8} radius={[3,3,0,0]} maxBarSize={48} />
                          <Line yAxisId="right" dataKey="revGrowth" name="Rev Growth %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Margin Trends */}
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                      <h3 className="text-sm font-medium text-slate-300 mb-4">Historical Margin Trends</h3>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={histChart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                          <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}%`} width={40} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                            labelStyle={{ color: '#e2e8f0' }}
                            formatter={(v: number, name: string) => [`${v}%`, name]}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          <ReferenceLine y={0} stroke="#475569" />
                          <Line type="monotone" dataKey="grossMargin"  name="Gross"   stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="ebitdaMargin" name="EBITDA"  stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="ebitMargin"   name="EBIT"    stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="netMargin"    name="Net"     stroke="#f87171" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })()}

              {/* Valuation Summary */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
                <h3 className="text-lg font-medium mb-4">Valuation Summary</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Enterprise Value</div>
                    <div className="font-mono text-sm">{formatCurrency(dcf.ev)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Total Cash</div>
                    <div className="font-mono text-sm">{formatCurrency(dcf.totalCash)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Total Debt</div>
                    <div className="font-mono text-sm">{formatCurrency(dcf.totalDebt)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Equity Value</div>
                    <div className="font-mono text-sm text-emerald-400">{formatCurrency(dcf.equityValue)}</div>
                  </div>
                </div>
              </div>

              {/* Valuation Bridge Chart */}
              {bridgeData && (() => {
                const unit = formatUnit;
                return (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
                    <h3 className="text-sm font-medium text-slate-300 mb-4">Valuation Bridge (${unit})</h3>
                    <div className="space-y-2">
                      {bridgeData.map(item => {
                        const isTotal = item.type === 'total';
                        const isSub   = item.type === 'sub';
                        const color   = isTotal ? 'bg-blue-500' : isSub ? 'bg-red-500' : 'bg-emerald-500';
                        const textCol = isTotal ? 'text-blue-400' : isSub ? 'text-red-400' : 'text-emerald-400';
                        const maxVal  = Math.max(...bridgeData.filter(d => d.type === 'total').map(d => Math.abs(d.value)), 1);
                        const pct     = Math.min(Math.abs(item.value) / maxVal * 100, 100);
                        return (
                          <div key={item.label} className={`flex items-center gap-3 ${isTotal ? 'mt-3 pt-3 border-t border-slate-700/50' : ''}`}>
                            <div className={`text-xs w-20 flex-shrink-0 text-right font-mono ${isTotal ? 'text-slate-300 font-semibold' : 'text-slate-500'}`}>{item.label}</div>
                            <div className="flex-1 relative h-5 bg-slate-700/40 rounded overflow-hidden">
                              <div
                                className={`absolute inset-y-0 left-0 ${color} opacity-80 rounded transition-all duration-500`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className={`text-xs font-mono w-20 flex-shrink-0 ${textCol}`}>
                              {isSub ? '-' : ''}{item.type === 'sub' ? '' : ''}${Math.abs(item.value).toFixed(1)}{unit}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-600 mt-3">PV of FCFs + PV of Terminal Value = Enterprise Value → +Cash −Debt = Equity Value</p>
                  </div>
                );
              })()}

              {/* Sensitivity Analysis Table */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 overflow-x-auto">
                <div className="mb-4">
                  <h3 className="text-lg font-medium">Sensitivity Analysis</h3>
                  <p className="text-xs text-slate-500 mt-1">Implied price per share — rows: terminal growth rate, columns: WACC</p>
                </div>
                <table className="w-full text-sm font-mono text-center">
                  <thead>
                    <tr>
                      <th className="text-left text-xs text-slate-500 pb-3 pr-4">g \ WACC</th>
                      {dcf.waccSteps.map((w: number) => (
                        <th key={w} className={`pb-3 px-3 text-xs font-medium ${Math.abs(w - dcf.wacc) < 0.0001 ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {(w * 100).toFixed(1)}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dcf.sensitivityMatrix.map((row: (number | null)[], ri: number) => {
                      const g = dcf.growthSteps[ri];
                      const isCurrentG = Math.abs(g - termGrowth / 100) < 0.0001;
                      return (
                        <tr key={ri} className="border-t border-slate-700/30">
                          <td className={`text-left py-2.5 pr-4 text-xs ${isCurrentG ? 'text-emerald-400 font-medium' : 'text-slate-500'}`}>
                            {(g * 100).toFixed(1)}%
                          </td>
                          {row.map((iv: number | null, ci: number) => {
                            const w = dcf.waccSteps[ci];
                            const isCurrentCell = isCurrentG && Math.abs(w - dcf.wacc) < 0.0001;
                            const pct = iv !== null && dcf.currentPrice > 0 ? (iv - dcf.currentPrice) / dcf.currentPrice : null;
                            const aboveAnalyst = iv !== null && analystTarget && iv >= analystTarget.mean;
                            const bg = iv === null ? '' : pct !== null && pct >= 0.10 ? 'bg-emerald-500/25' : pct !== null && pct >= 0 ? 'bg-emerald-500/10' : pct !== null && pct >= -0.10 ? 'bg-red-500/10' : 'bg-red-500/25';
                            const textColor = iv === null ? 'text-slate-600' : pct !== null && pct >= 0 ? 'text-emerald-400' : 'text-red-400';
                            return (
                              <td key={ci} className={`py-2.5 px-3 rounded ${bg} ${textColor} ${isCurrentCell ? 'ring-2 ring-emerald-500' : ''} ${aboveAnalyst && !isCurrentCell ? 'ring-1 ring-blue-400/50' : ''}`}>
                                {iv === null ? '—' : `$${iv.toFixed(0)}`}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-600">
                  <span>Current price: ${dcf.currentPrice.toFixed(2)}</span>
                  {analystTarget && <span className="text-blue-400/70">Analyst target: ${analystTarget.mean.toFixed(0)} (range ${analystTarget.low.toFixed(0)}–${analystTarget.high.toFixed(0)})</span>}
                  <span>Green = upside · Red = downside · Ring = current assumptions{analystTarget ? ' · Blue outline = at/above analyst target' : ''}</span>
                </div>
              </div>

            </div>
          </div>

          {/* Scenario Comparison */}
          {scenarioComparison && (
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
              <h3 className="text-sm font-medium text-slate-300 mb-4">Scenario Comparison</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {([
                  { key: 'bear', label: 'Bear Case', color: 'border-red-500/30 bg-red-500/5', textColor: 'text-red-400', desc: `Rev ${(dcf.revCagr5yr*100*0.5).toFixed(1)}%→${Math.max(-5, dcf.revCagr5yr*100*0.1).toFixed(1)}%, Margin ×0.85→0.70` },
                  { key: 'base', label: 'Base Case', color: 'border-slate-500/30 bg-slate-700/20', textColor: 'text-slate-300', desc: `Rev ${(dcf.revCagr5yr*100).toFixed(1)}%→${(dcf.revCagr3yr*100).toFixed(1)}%, Margin unchanged` },
                  { key: 'bull', label: 'Bull Case', color: 'border-emerald-500/30 bg-emerald-500/5', textColor: 'text-emerald-400', desc: `Rev ${(dcf.revCagr3yr*100*1.25).toFixed(1)}%→…, Margin ×1.15` },
                ] as const).map(({ key, label, color, textColor, desc }) => {
                  const s = scenarioComparison[key];
                  return (
                    <div key={key} className={`rounded-xl border p-4 space-y-2 ${color}`}>
                      <div className="text-xs text-slate-500 font-medium">{label}</div>
                      <div className={`text-3xl font-light font-mono ${textColor}`}>${s.price.toFixed(2)}</div>
                      <div className={`text-sm font-medium ${s.upside >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.upside >= 0 ? '+' : ''}{(s.upside * 100).toFixed(1)}% vs ${dcf.currentPrice.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-600 leading-relaxed">{desc}</div>
                    </div>
                  );
                })}
              </div>
              {/* Mini comparison bar */}
              <div className="mt-5 space-y-2">
                {(['bear', 'base', 'bull'] as const).map(key => {
                  const s = scenarioComparison[key];
                  const labels = { bear: 'Bear', base: 'Base', bull: 'Bull' };
                  const colors = { bear: 'bg-red-500', base: 'bg-slate-500', bull: 'bg-emerald-500' };
                  const maxPrice = Math.max(scenarioComparison.bull.price, dcf.currentPrice) * 1.05;
                  const pct = Math.min(s.price / maxPrice * 100, 100);
                  const curPct = Math.min(dcf.currentPrice / maxPrice * 100, 100);
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <div className="text-xs text-slate-500 w-10 flex-shrink-0">{labels[key]}</div>
                      <div className="flex-1 relative h-4 bg-slate-700/40 rounded overflow-visible">
                        <div className={`absolute inset-y-0 left-0 ${colors[key]} rounded opacity-70`} style={{ width: `${pct}%` }} />
                        {/* Current price line */}
                        <div className="absolute inset-y-0 w-px bg-slate-300 opacity-60" style={{ left: `${curPct}%` }} />
                      </div>
                      <div className="text-xs font-mono text-slate-400 w-16 flex-shrink-0">${s.price.toFixed(0)}</div>
                    </div>
                  );
                })}
                <div className="text-xs text-slate-600 pl-14">Vertical line = current price (${dcf.currentPrice.toFixed(2)})</div>
              </div>
            </div>
          )}

          {/* DCF Model Table */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 overflow-x-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-medium">Forecast Model</h3>
              <div className="flex gap-4">
                <div className="flex bg-slate-800 rounded-md p-1 border border-slate-700">
                  <button onClick={() => setFormatUnit('M')} className={`px-3 py-1 text-xs rounded-sm ${formatUnit === 'M' ? 'bg-slate-600 text-white' : 'text-slate-400'}`}>M</button>
                  <button onClick={() => setFormatUnit('B')} className={`px-3 py-1 text-xs rounded-sm ${formatUnit === 'B' ? 'bg-slate-600 text-white' : 'text-slate-400'}`}>B</button>
                </div>
                <button
                  onClick={printDCF}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-sm px-4 py-2 rounded-md transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Print / PDF
                </button>
                <button
                  onClick={exportToExcel}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-sm px-4 py-2 rounded-md transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Financials
                </button>
              </div>
            </div>
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="text-left py-2 font-medium">Metric</th>
                  {dcf.historicalSummary.map((p: any) => <th key={p.year} className="py-2 font-medium text-slate-500">{p.year}</th>)}
                  {dcf.projections.map((p: any) => <th key={p.year} className="py-2 font-medium">{p.year}</th>)}
                </tr>
              </thead>
              <tbody className="font-mono text-base">
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Revenue</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-500">{formatModelCurrency(p.rev, formatUnit)}</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className="py-3">{formatModelCurrency(p.rev, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">EBIT</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-500">{formatModelCurrency(p.ebit, formatUnit)}</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className={`py-3 ${p.ebit < 0 ? 'text-red-400' : ''}`}>{formatModelCurrency(p.ebit, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50 text-sm italic text-slate-400">
                  <td className="text-left py-3">(1 - Tax)</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className="py-3">{formatPct(1 - p.taxRate)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">EBIAT (NOPAT)</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className={`py-3 ${p.ebiat < 0 ? 'text-red-400' : ''}`}>{formatModelCurrency(p.ebiat, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Plus: D&A</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className="py-3">{formatModelCurrency(p.dna, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Less: CapEx</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className="py-3 text-red-400">{formatModelCurrency(-p.capex, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Less: Δ WC</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className={`py-3 ${p.deltaWc > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatModelCurrency(-p.deltaWc, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-4 text-slate-300 font-semibold">Free Cash Flow</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-4 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className={`py-4 font-semibold ${p.fcff < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatModelCurrency(p.fcff, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Mid-Year DP</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className="py-3 text-slate-400">{p.discountPeriod.toFixed(2)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Discounted FCF</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className={`py-3 ${p.discountedFcff < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatModelCurrency(p.discountedFcff, formatUnit)}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Terminal Value</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any, i: number) => <td key={p.year} className="py-3">{i === dcf.projections.length - 1 ? formatModelCurrency(p.tv, formatUnit) : '-'}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Discounted TV</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-600">-</td>)}
                  {dcf.projections.map((p: any, i: number) => <td key={p.year} className={`py-3 ${p.discountedTv < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{i === dcf.projections.length - 1 ? formatModelCurrency(p.discountedTv, formatUnit) : '-'}</td>)}
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Shares Outstanding</td>
                  {dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-3 text-slate-500">{formatModelNumber(p.shares, formatUnit)}</td>)}
                  {dcf.projections.map((p: any) => <td key={p.year} className="py-3">{formatModelNumber(p.shares, formatUnit)}</td>)}
                </tr>
                
                {/* Valuation Summary Rows */}
                <tr className="border-t-2 border-slate-600">
                  <td className="text-left py-3 text-slate-300 font-semibold">Enterprise Value</td>
                  <td colSpan={dcf.historicalSummary.length + dcf.projections.length} className="py-3 font-semibold text-emerald-400">{formatModelCurrency(dcf.ev, formatUnit)}</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Plus: Cash</td>
                  <td colSpan={dcf.historicalSummary.length + dcf.projections.length} className="py-3">{formatModelCurrency(dcf.totalCash, formatUnit)}</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Less: Debt</td>
                  <td colSpan={dcf.historicalSummary.length + dcf.projections.length} className="py-3 text-red-400">({formatModelCurrency(dcf.totalDebt, formatUnit)})</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Equity Value</td>
                  <td colSpan={dcf.historicalSummary.length + dcf.projections.length} className="py-3 text-emerald-400">{formatModelCurrency(dcf.equityValue, formatUnit)}</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="text-left py-3 text-slate-300">Diluted Shares (Year {forecastYears})</td>
                  <td colSpan={dcf.historicalSummary.length + dcf.projections.length} className="py-3">{formatModelNumber(dcf.terminalShares, formatUnit)}</td>
                </tr>
                <tr className="font-bold text-lg">
                  <td className="text-left py-4 text-slate-200">Implied Price per Share</td>
                  <td colSpan={dcf.historicalSummary.length + dcf.projections.length} className="py-4 text-emerald-400">${dcf.intrinsicValue.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Historical Financials Tables */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Historical Financials</h2>
            
            {/* Income Statement */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 overflow-x-auto">
              <h3 className="text-lg font-medium mb-4">Income Statement</h3>
              <table className="w-full text-sm text-right">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2 font-medium">Metric</th>
                    {dcf.historicalSummary.map((p: any) => <th key={p.year} className="py-2 font-medium">{p.year}</th>)}
                  </tr>
                </thead>
                <tbody className="font-mono text-base">
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Revenue</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.rev, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50 text-xs italic text-slate-400"><td className="text-left py-2">Revenue Growth</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatPct(p.revGrowth)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Gross Profit</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.gp, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50 text-xs italic text-slate-400"><td className="text-left py-2">Gross Margin</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatPct(p.gpm)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">EBIT</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.ebit, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50 text-xs italic text-slate-400"><td className="text-left py-2">EBIT Margin</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatPct(p.ebitMargin)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">EBITDA</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.ebitda, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50 text-xs italic text-slate-400"><td className="text-left py-2">EBITDA Margin</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatPct(p.ebitdaMargin)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Net Income</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.netIncome, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50 text-xs italic text-slate-400"><td className="text-left py-2">Net Profit Margin</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatPct(p.netProfitMargin)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Basic EPS</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">${p.eps.toFixed(2)}</td>)}</tr>
                  <tr><td className="text-left py-2 text-slate-300">Shares Outstanding</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelNumber(p.shares, formatUnit)}</td>)}</tr>
                </tbody>
              </table>
            </div>

            {/* Balance Sheet */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 overflow-x-auto">
              <h3 className="text-lg font-medium mb-4">Balance Sheet</h3>
              <table className="w-full text-sm text-right">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2 font-medium">Metric</th>
                    {dcf.historicalSummary.map((p: any) => <th key={p.year} className="py-2 font-medium">{p.year}</th>)}
                  </tr>
                </thead>
                <tbody className="font-mono text-base">
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Total Assets</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.totalAssets, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Total Liabilities</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.totalLiabilities, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Total Debt</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.totalDebt, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Total Equity</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.totalEquity, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Cash & Equivalents</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.cash, formatUnit)}</td>)}</tr>
                  <tr><td className="text-left py-2 text-slate-300">Working Capital</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.wc, formatUnit)}</td>)}</tr>
                </tbody>
              </table>
            </div>

            {/* Cash Flow */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 overflow-x-auto">
              <h3 className="text-lg font-medium mb-4">Cash Flow Statement</h3>
              <table className="w-full text-sm text-right">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-2 font-medium">Metric</th>
                    {dcf.historicalSummary.map((p: any) => <th key={p.year} className="py-2 font-medium">{p.year}</th>)}
                  </tr>
                </thead>
                <tbody className="font-mono text-base">
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Cash from Operations (CFO)</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.cfo, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Cash from Investing (CFI)</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.cfi, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Cash from Financing (CFF)</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.cff, formatUnit)}</td>)}</tr>
                  <tr className="border-b border-slate-700/50"><td className="text-left py-2 text-slate-300">Capital Expenditures</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2 text-red-400">({formatModelCurrency(p.capex, formatUnit)})</td>)}</tr>
                  <tr><td className="text-left py-2 text-slate-300">Change in Cash</td>{dcf.historicalSummary.map((p: any) => <td key={p.year} className="py-2">{formatModelCurrency(p.changeInCash, formatUnit)}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        ) : null}
          </>
        )}
      </main>
    </div>
  );
}
