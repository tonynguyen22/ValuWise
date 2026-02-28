import React, { useState, useMemo, useEffect } from 'react';
import { TrendingUp, TrendingDown, Shield, DollarSign, Activity, Award, Search, AlertCircle, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar, ReferenceLine, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';

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

// ─── Data helpers (mirrored from App.tsx) ────────────────────────────────────

const parseNum = (val: any): number => {
  if (val === 'None' || val === null || val === undefined || val === '0') return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

const findConcept = (section: any[], concepts: string[]): number => {
  if (!section) return 0;
  for (const concept of concepts) {
    const item = section.find((i: any) => i.concept === concept);
    if (item) return parseNum(item.value);
  }
  return 0;
};

function buildHistoricalSummary(financials: any[]) {
  const getRev = (report: any) =>
    findConcept(report.report.ic, [
      'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
      'us-gaap_SalesRevenueNet', 'us-gaap_Revenues', 'ifrs-full_Revenue',
    ]);

  // revCagr3yr
  const revs = financials.slice(0, 6).map(getRev);
  let revCagr3yr = 0;
  if (revs.length >= 4 && revs[3] > 0 && revs[0] > 0) {
    revCagr3yr = Math.pow(revs[0] / revs[3], 1 / 3) - 1;
  }

  const historicalSummary = financials.slice(0, 6).map((report: any, index: number, arr: any[]) => {
    const ic = report.report.ic;
    const bs = report.report.bs;
    const cf = report.report.cf;

    const rev = getRev(report);
    const prevRev = index < arr.length - 1 ? getRev(arr[index + 1]) : rev;
    const revGrowth = prevRev ? (rev - prevRev) / prevRev : 0;

    let gp = findConcept(ic, ['us-gaap_GrossProfit', 'ifrs-full_GrossProfit']);
    if (!gp && rev > 0) {
      const cogs = findConcept(ic, ['us-gaap_CostOfRevenue', 'us-gaap_CostOfGoodsAndServicesSold', 'us-gaap_CostOfGoodsSold', 'us-gaap_CostOfServices', 'ifrs-full_CostOfSales']);
      if (cogs > 0) gp = rev - cogs;
    }
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
    // Fallback 2: Gross Profit − SG&A − R&D (uses already-computed gp)
    if (!ebit && gp > 0) {
      const sga = Math.abs(findConcept(ic, ['us-gaap_SellingGeneralAndAdministrativeExpense', 'us-gaap_SellingGeneralAndAdministrativeExpenses', 'us-gaap_GeneralAndAdministrativeExpense', 'ifrs-full_SellingGeneralAndAdministrativeExpense']));
      const rd  = Math.abs(findConcept(ic, ['us-gaap_ResearchAndDevelopmentExpense', 'us-gaap_ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost']));
      if (sga > 0) ebit = gp - sga - rd;
    }
    const tax  = findConcept(ic, ['us-gaap_IncomeTaxExpenseBenefit', 'ifrs-full_IncomeTaxExpenseContinuingOperations', 'ifrs-full_IncomeTaxExpense']);
    const netIncome = findConcept(ic, ['us-gaap_NetIncomeLoss', 'ifrs-full_ProfitLoss']);
    const da   = findConcept(cf, ['us-gaap_DepreciationDepletionAndAmortization', 'us-gaap_DepreciationAmortizationAndAccretionNet', 'ifrs-full_DepreciationAndAmortisationExpense']);
    const ebitda = ebit + da;
    const eps  = findConcept(ic, ['us-gaap_EarningsPerShareBasic', 'ifrs-full_BasicEarningsLossPerShare']);

    const totalAssets       = findConcept(bs, ['us-gaap_Assets', 'ifrs-full_Assets']);
    const currentLiabilities = findConcept(bs, ['us-gaap_LiabilitiesCurrent', 'ifrs-full_CurrentLiabilities']);
    const totalEquity        = findConcept(bs, ['us-gaap_StockholdersEquity', 'us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs-full_Equity']);
    const currentAssets      = findConcept(bs, ['us-gaap_AssetsCurrent', 'ifrs-full_CurrentAssets']);
    const inventory          = findConcept(bs, ['us-gaap_InventoryNet', 'ifrs-full_Inventories']);
    const shortTermDebt      = findConcept(bs, ['us-gaap_LongTermDebtCurrent', 'us-gaap_ShortTermDebt', 'us-gaap_DebtCurrent', 'ifrs-full_CurrentBorrowings']);
    const longTermDebt       = findConcept(bs, ['us-gaap_LongTermDebtNoncurrent', 'us-gaap_LongTermDebt', 'ifrs-full_NoncurrentBorrowings']);
    const totalDebt          = shortTermDebt + longTermDebt;

    const interestExpense = Math.abs(
      findConcept(ic, ['us-gaap_InterestExpense', 'us-gaap_InterestPaidNet', 'ifrs-full_InterestExpense']) ||
      findConcept(cf, ['us-gaap_InterestPaidNet', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities'])
    );
    const cfo   = findConcept(cf, ['us-gaap_NetCashProvidedByUsedInOperatingActivities', 'us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'ifrs-full_CashFlowsFromUsedInOperatingActivities']);
    const capex = Math.abs(findConcept(cf, ['us-gaap_PaymentsToAcquirePropertyPlantAndEquipment', 'ifrs-full_PurchaseOfPropertyPlantAndEquipment']));

    const currentRatio   = currentLiabilities ? currentAssets / currentLiabilities : 0;
    const quickRatio     = currentLiabilities ? (currentAssets - inventory) / currentLiabilities : 0;
    const interestCoverage = interestExpense ? ebit / interestExpense : 0;
    const debtToEquity   = totalEquity ? totalDebt / totalEquity : 0;
    const roe            = totalEquity ? netIncome / totalEquity : 0;
    const roa            = totalAssets ? netIncome / totalAssets : 0;

    const yearStr = report.endDate ? report.endDate.substring(0, 7) : String(report.year);

    const prevEps = index < arr.length - 1
      ? findConcept(arr[index + 1].report.ic, ['us-gaap_EarningsPerShareBasic', 'ifrs-full_BasicEarningsLossPerShare'])
      : null;
    const epsGrowth: number | null = (prevEps !== null && Math.abs(prevEps) > 0.001)
      ? (eps - prevEps) / Math.abs(prevEps)
      : null;

    return {
      year: yearStr, rev, revGrowth, gp,
      grossMargin: rev ? gp / rev : 0,
      ebitda, ebitdaMargin: rev ? ebitda / rev : 0,
      netIncome, netProfitMargin: rev ? netIncome / rev : 0,
      eps, epsGrowth, currentRatio, quickRatio, interestCoverage, debtToEquity, roe, roa, cfo, capex,
      ebit, totalAssets, totalEquity, currentAssets, currentLiabilities,
    };
  }).slice(0, 5).reverse();

  return { historicalSummary, revCagr3yr };
}

// ─── Grading pure helpers ─────────────────────────────────────────────────────

const safeAvg = (values: number[]): number => {
  const valid = values.filter(v => isFinite(v) && !isNaN(v));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
};

const safeDivide = (num: number, den: number): number => {
  if (!den || !isFinite(den) || isNaN(den)) return 0;
  if (!isFinite(num) || isNaN(num)) return 0;
  return num / den;
};

type LetterGrade = 'A' | 'B' | 'C' | 'D';

const gradeToScore = (g: LetterGrade): number => ({ A: 4, B: 3, C: 2, D: 1 }[g]);

const scoreToGrade = (s: number): LetterGrade => {
  if (s >= 3.5) return 'A';
  if (s >= 2.5) return 'B';
  if (s >= 1.5) return 'C';
  return 'D';
};

const scoreTo100 = (s: number): number => Math.round(((s - 1) / 3) * 100);

const gradeCurrRatio    = (v: number): LetterGrade => v >= 2.0 ? 'A' : v >= 1.5 ? 'B' : v >= 1.0 ? 'C' : 'D';
const gradeQuickRatio   = (v: number): LetterGrade => v >= 1.5 ? 'A' : v >= 1.0 ? 'B' : v >= 0.7 ? 'C' : 'D';
const gradeDebtToEquity = (v: number): LetterGrade => v <= 0.3 ? 'A' : v <= 0.7 ? 'B' : v <= 1.5 ? 'C' : 'D';
const gradeIntCoverage  = (v: number): LetterGrade => v >= 10  ? 'A' : v >= 5   ? 'B' : v >= 2   ? 'C' : 'D';
const gradeGrossMargin  = (v: number): LetterGrade => v >= 0.60 ? 'A' : v >= 0.40 ? 'B' : v >= 0.20 ? 'C' : 'D';
const gradeEbitdaMargin = (v: number): LetterGrade => v >= 0.30 ? 'A' : v >= 0.20 ? 'B' : v >= 0.10 ? 'C' : 'D';
const gradeNetMargin    = (v: number): LetterGrade => v >= 0.20 ? 'A' : v >= 0.10 ? 'B' : v >= 0.05 ? 'C' : 'D';
const gradeROE          = (v: number): LetterGrade => v >= 0.20 ? 'A' : v >= 0.12 ? 'B' : v >= 0.05 ? 'C' : 'D';
const gradeROA          = (v: number): LetterGrade => v >= 0.10 ? 'A' : v >= 0.05 ? 'B' : v >= 0.02 ? 'C' : 'D';
const gradeRevGrowth    = (v: number): LetterGrade => v >= 0.15 ? 'A' : v >= 0.08 ? 'B' : v >= 0.03 ? 'C' : 'D';
const gradeEpsGrowth    = (v: number): LetterGrade => v >= 0.15 ? 'A' : v >= 0.08 ? 'B' : v >= 0.03 ? 'C' : 'D';
const gradeFcfMargin    = (v: number): LetterGrade => v >= 0.15 ? 'A' : v >= 0.08 ? 'B' : v >= 0.03 ? 'C' : 'D';
const gradeFcfConv      = (v: number): LetterGrade => v >= 1.00 ? 'A' : v >= 0.60 ? 'B' : v >= 0.20 ? 'C' : 'D';
const gradeCfoMargin    = (v: number): LetterGrade => v >= 0.20 ? 'A' : v >= 0.12 ? 'B' : v >= 0.05 ? 'C' : 'D';

const detectTrend = (values: number[]): 'improving' | 'stable' | 'declining' => {
  const v = values.filter(x => isFinite(x) && !isNaN(x));
  if (v.length < 2) return 'stable';
  const mid  = Math.max(1, Math.floor(v.length / 2));
  const first = safeAvg(v.slice(0, mid));
  const last  = safeAvg(v.slice(mid));
  if (first === 0) return last > 0 ? 'improving' : 'stable';
  const change = (last - first) / Math.abs(first);
  if (change > 0.05) return 'improving';
  if (change < -0.05) return 'declining';
  return 'stable';
};

const detectTrendInverted = (values: number[]): 'improving' | 'stable' | 'declining' => {
  const t = detectTrend(values);
  return t === 'improving' ? 'declining' : t === 'declining' ? 'improving' : 'stable';
};

interface MetricResult {
  name: string;
  value: number;
  formattedValue: string;
  grade: LetterGrade;
  trend: 'improving' | 'stable' | 'declining';
}

interface CategoryResult {
  name: string;
  icon: React.ReactNode;
  weight: number;
  grade: LetterGrade;
  score: number;
  metrics: MetricResult[];
}

function computeGrades(historicalSummary: any[], revCagr3yr: number) {
  const hist   = historicalSummary;
  const recent = hist.slice(-3);
  if (recent.length === 0) return null;

  const isDebtFree = recent.every((y: any) => y.debtToEquity < 0.01);

  const avgCurr   = safeAvg(recent.map((y: any) => y.currentRatio));
  const avgQuick  = safeAvg(recent.map((y: any) => y.quickRatio));
  const avgDE     = safeAvg(recent.map((y: any) => y.debtToEquity));
  const avgIntCov = safeAvg(recent.map((y: any) => y.interestCoverage));
  const effectiveIntCovGrade: LetterGrade = (isDebtFree && avgIntCov === 0) ? 'A' : gradeIntCoverage(avgIntCov);

  const healthMetrics: MetricResult[] = [
    { name: 'Current Ratio',      value: avgCurr,   formattedValue: avgCurr.toFixed(2) + 'x', grade: gradeCurrRatio(avgCurr),    trend: detectTrend(recent.map((y: any) => y.currentRatio)) },
    { name: 'Quick Ratio',        value: avgQuick,  formattedValue: avgQuick.toFixed(2) + 'x', grade: gradeQuickRatio(avgQuick),   trend: detectTrend(recent.map((y: any) => y.quickRatio)) },
    { name: 'Debt / Equity',      value: avgDE,     formattedValue: avgDE.toFixed(2) + 'x',    grade: gradeDebtToEquity(avgDE),    trend: detectTrendInverted(recent.map((y: any) => y.debtToEquity)) },
    { name: 'Interest Coverage',  value: avgIntCov, formattedValue: (isDebtFree && avgIntCov === 0) ? '∞' : avgIntCov.toFixed(1) + 'x', grade: effectiveIntCovGrade, trend: isDebtFree ? 'stable' : detectTrend(recent.map((y: any) => y.interestCoverage)) },
  ];
  const healthScore = safeAvg(healthMetrics.map(m => gradeToScore(m.grade)));

  const avgGross  = safeAvg(recent.map((y: any) => y.grossMargin));
  const avgEbitda = safeAvg(recent.map((y: any) => y.ebitdaMargin));
  const avgNet    = safeAvg(recent.map((y: any) => y.netProfitMargin));
  const avgROE    = safeAvg(recent.map((y: any) => y.roe));
  const avgROA    = safeAvg(recent.map((y: any) => y.roa));

  const profMetrics: MetricResult[] = [
    { name: 'Gross Margin',       value: avgGross,  formattedValue: (avgGross * 100).toFixed(1) + '%',  grade: gradeGrossMargin(avgGross),  trend: detectTrend(recent.map((y: any) => y.grossMargin)) },
    { name: 'EBITDA Margin',      value: avgEbitda, formattedValue: (avgEbitda * 100).toFixed(1) + '%', grade: gradeEbitdaMargin(avgEbitda), trend: detectTrend(recent.map((y: any) => y.ebitdaMargin)) },
    { name: 'Net Profit Margin',  value: avgNet,    formattedValue: (avgNet * 100).toFixed(1) + '%',    grade: gradeNetMargin(avgNet),        trend: detectTrend(recent.map((y: any) => y.netProfitMargin)) },
    { name: 'ROE',                value: avgROE,    formattedValue: (avgROE * 100).toFixed(1) + '%',    grade: gradeROE(avgROE),              trend: detectTrend(recent.map((y: any) => y.roe)) },
    { name: 'ROA',                value: avgROA,    formattedValue: (avgROA * 100).toFixed(1) + '%',    grade: gradeROA(avgROA),              trend: detectTrend(recent.map((y: any) => y.roa)) },
  ];
  const profScore = safeAvg(profMetrics.map(m => gradeToScore(m.grade)));

  const avgRevGrowth = safeAvg(recent.map((y: any) => y.revGrowth));
  const epsRates: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1].eps;
    const curr = hist[i].eps;
    if (Math.abs(prev) > 0.001) epsRates.push((curr - prev) / Math.abs(prev));
  }
  const recentEpsRates = epsRates.slice(-3);
  const avgEpsGrowth   = safeAvg(recentEpsRates);

  const growthMetrics: MetricResult[] = [
    { name: 'Rev Growth (3yr Avg)', value: avgRevGrowth,  formattedValue: (avgRevGrowth * 100).toFixed(1) + '%',  grade: gradeRevGrowth(avgRevGrowth),   trend: detectTrend(recent.map((y: any) => y.revGrowth)) },
    { name: 'Rev CAGR (3yr)',       value: revCagr3yr,    formattedValue: (revCagr3yr * 100).toFixed(1) + '%',    grade: gradeRevGrowth(revCagr3yr),     trend: 'stable' },
    { name: 'EPS Growth (3yr Avg)', value: avgEpsGrowth,  formattedValue: (avgEpsGrowth * 100).toFixed(1) + '%',  grade: gradeEpsGrowth(avgEpsGrowth),   trend: detectTrend(recentEpsRates) },
  ];
  const growthScore = safeAvg(growthMetrics.map(m => gradeToScore(m.grade)));

  const fcfArr     = recent.map((y: any) => y.cfo - y.capex);
  const fcfMargins = recent.map((y: any, i: number) => safeDivide(fcfArr[i], y.rev));
  const cfoMargins = recent.map((y: any) => safeDivide(y.cfo, y.rev));
  const fcfConvArr = recent
    .map((y: any, i: number) => (y.netIncome > 0 ? safeDivide(fcfArr[i], y.netIncome) : null))
    .filter((v): v is number => v !== null);

  const avgFcfMargin = safeAvg(fcfMargins);
  const avgFcfConv   = safeAvg(fcfConvArr);
  const avgCfoMargin = safeAvg(cfoMargins);

  const cfMetrics: MetricResult[] = [
    { name: 'FCF Margin',     value: avgFcfMargin, formattedValue: (avgFcfMargin * 100).toFixed(1) + '%',                         grade: gradeFcfMargin(avgFcfMargin), trend: detectTrend(fcfMargins) },
    { name: 'FCF Conversion', value: avgFcfConv,   formattedValue: fcfConvArr.length === 0 ? 'N/A' : (avgFcfConv * 100).toFixed(0) + '%', grade: fcfConvArr.length === 0 ? 'D' : gradeFcfConv(avgFcfConv), trend: detectTrend(fcfConvArr) },
    { name: 'CFO Margin',     value: avgCfoMargin, formattedValue: (avgCfoMargin * 100).toFixed(1) + '%',                         grade: gradeCfoMargin(avgCfoMargin), trend: detectTrend(cfoMargins) },
  ];
  const cfScore = safeAvg(cfMetrics.map(m => gradeToScore(m.grade)));

  const weightedScore  = healthScore * 0.25 + profScore * 0.30 + growthScore * 0.25 + cfScore * 0.20;
  const overallGrade   = scoreToGrade(weightedScore);
  const overallScore   = scoreTo100(weightedScore);
  const healthGrade    = scoreToGrade(healthScore);
  const profGrade      = scoreToGrade(profScore);
  const growthGrade    = scoreToGrade(growthScore);
  const cfGrade        = scoreToGrade(cfScore);

  // Summary
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (healthGrade === 'A' || healthGrade === 'B') strengths.push('strong balance sheet');
  else if (healthGrade === 'D') weaknesses.push('weak financial health');
  if (profGrade === 'A' || profGrade === 'B') strengths.push('high profitability');
  else if (profGrade === 'D') weaknesses.push('poor profitability');
  if (growthGrade === 'A' || growthGrade === 'B') strengths.push('solid revenue growth');
  else if (growthGrade === 'D') weaknesses.push('declining growth');
  if (cfGrade === 'A' || cfGrade === 'B') strengths.push('robust cash generation');
  else if (cfGrade === 'D') weaknesses.push('weak cash conversion');
  const descriptor = { A: 'Excellent', B: 'Good', C: 'Fair', D: 'Poor' }[overallGrade];
  let summary = `${descriptor} overall financial profile across all categories.`;
  if (strengths.length > 0 && weaknesses.length === 0) summary = `${descriptor} overall with ${strengths.join(' and ')}.`;
  else if (weaknesses.length > 0 && strengths.length === 0) summary = `Faces challenges with ${weaknesses.join(' and ')}.`;
  else if (strengths.length > 0 && weaknesses.length > 0) summary = `Shows ${strengths[0]} but faces ${weaknesses[0]}.`;

  return {
    rawCategories: [
      { name: 'Financial Health', iconKey: 'shield', weight: 25, grade: healthGrade, score: healthScore, metrics: healthMetrics },
      { name: 'Profitability',    iconKey: 'dollar', weight: 30, grade: profGrade,   score: profScore,   metrics: profMetrics   },
      { name: 'Growth',           iconKey: 'trend',  weight: 25, grade: growthGrade, score: growthScore, metrics: growthMetrics },
      { name: 'Cash Flow Quality',iconKey: 'activity',weight:20, grade: cfGrade,     score: cfScore,     metrics: cfMetrics     },
    ],
    overallGrade, overallScore, summary,
  };
}

// ─── Per-year grade snapshot ──────────────────────────────────────────────────

function computeSingleYearGrades(y: any): {
  year: string; health: LetterGrade; prof: LetterGrade;
  growth: LetterGrade; cf: LetterGrade; overall: LetterGrade; score: number;
} {
  const isDebtFree = y.debtToEquity < 0.01;
  const intCovGrade: LetterGrade = (isDebtFree && y.interestCoverage === 0) ? 'A' : gradeIntCoverage(y.interestCoverage);

  const healthScore = safeAvg([
    gradeToScore(gradeCurrRatio(y.currentRatio)),
    gradeToScore(gradeQuickRatio(y.quickRatio)),
    gradeToScore(gradeDebtToEquity(y.debtToEquity)),
    gradeToScore(intCovGrade),
  ]);

  const profScore = safeAvg([
    gradeToScore(gradeGrossMargin(y.grossMargin)),
    gradeToScore(gradeEbitdaMargin(y.ebitdaMargin)),
    gradeToScore(gradeNetMargin(y.netProfitMargin)),
    gradeToScore(gradeROE(y.roe)),
    gradeToScore(gradeROA(y.roa)),
  ]);

  const growthVals = [gradeToScore(gradeRevGrowth(y.revGrowth))];
  if (y.epsGrowth !== null && isFinite(y.epsGrowth) && !isNaN(y.epsGrowth)) {
    growthVals.push(gradeToScore(gradeEpsGrowth(y.epsGrowth)));
  }
  const growthScore = safeAvg(growthVals);

  const fcf = y.cfo - y.capex;
  const fcfMargin = y.rev ? fcf / y.rev : 0;
  const cfoMargin = y.rev ? y.cfo / y.rev : 0;
  const cfVals = [gradeToScore(gradeFcfMargin(fcfMargin)), gradeToScore(gradeCfoMargin(cfoMargin))];
  if (y.netIncome > 0) cfVals.push(gradeToScore(gradeFcfConv(y.netIncome ? fcf / y.netIncome : 0)));
  const cfScore = safeAvg(cfVals);

  const weighted = healthScore * 0.25 + profScore * 0.30 + growthScore * 0.25 + cfScore * 0.20;
  return {
    year: y.year.substring(0, 4),
    health: scoreToGrade(healthScore),
    prof:   scoreToGrade(profScore),
    growth: scoreToGrade(growthScore),
    cf:     scoreToGrade(cfScore),
    overall: scoreToGrade(weighted),
    score:  scoreTo100(weighted),
  };
}

// ─── Altman Z''-Score ─────────────────────────────────────────────────────────

function computeAltmanZ(y: any): { z: number; zone: 'safe' | 'grey' | 'distress' } | null {
  if (!y.totalAssets || y.totalAssets === 0) return null;
  const wc       = y.currentAssets - y.currentLiabilities;
  const totalLiab = y.totalAssets - y.totalEquity;
  const X1 = wc / y.totalAssets;
  const X2 = y.totalEquity / y.totalAssets;           // retained earnings proxy
  const X3 = y.ebit / y.totalAssets;
  const X4 = totalLiab > 0 ? y.totalEquity / totalLiab : 5; // equity / liabilities; cap if debt-free
  const z  = 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;
  if (!isFinite(z) || isNaN(z)) return null;
  const zone: 'safe' | 'grey' | 'distress' = z > 2.99 ? 'safe' : z >= 1.81 ? 'grey' : 'distress';
  return { z, zone };
}

// ─── Risk flags ───────────────────────────────────────────────────────────────

function computeRiskFlags(hist: any[]): string[] {
  const flags: string[] = [];
  const recent = hist.slice(-3);
  if (recent.length === 0) return flags;
  const latest    = recent[recent.length - 1];
  const isDebtFree = recent.every((y: any) => y.debtToEquity < 0.01);

  const fcfNegCount = recent.filter((y: any) => (y.cfo - y.capex) < 0).length;
  if (fcfNegCount >= 2) flags.push('FCF negative in 2+ of last 3 years');

  if (recent.length >= 2) {
    const firstRev = recent[0].rev;
    const lastRev  = latest.rev;
    if (firstRev > 0 && lastRev < firstRev * 0.97) flags.push('Revenue in decline');
  }

  if (recent.length >= 3) {
    const gms = recent.map((y: any) => y.grossMargin);
    if (gms[2] < gms[1] && gms[1] < gms[0]) flags.push('Gross margin compressing 3 consecutive years');
  }

  if (recent.length >= 2) {
    const debtRising       = latest.debtToEquity > recent[0].debtToEquity * 1.2;
    const marginsCompressing = latest.ebitdaMargin < recent[0].ebitdaMargin * 0.9;
    if (debtRising && marginsCompressing) flags.push('Debt rising with compressing EBITDA margins');
  }

  if (!isDebtFree && latest.interestCoverage > 0 && latest.interestCoverage < 2)
    flags.push('Interest coverage below 2x');
  if (latest.currentRatio > 0 && latest.currentRatio < 1.0) flags.push('Current ratio below 1x');
  if (latest.netIncome < 0) flags.push('Net income negative');
  if (latest.debtToEquity > 3) flags.push('High leverage (D/E > 3x)');

  return flags;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const gradeColors = {
  A: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-500/40', badge: 'bg-emerald-500/20 text-emerald-300', bar: 'bg-emerald-500' },
  B: { text: 'text-blue-400',   bg: 'bg-blue-400/10',   border: 'border-blue-500/40',   badge: 'bg-blue-500/20 text-blue-300',   bar: 'bg-blue-500'   },
  C: { text: 'text-amber-400',  bg: 'bg-amber-400/10',  border: 'border-amber-500/40',  badge: 'bg-amber-500/20 text-amber-300',  bar: 'bg-amber-500'  },
  D: { text: 'text-red-400',    bg: 'bg-red-400/10',    border: 'border-red-500/40',    badge: 'bg-red-500/20 text-red-300',    bar: 'bg-red-500'    },
};

const gradeLabel = { A: 'Excellent', B: 'Good', C: 'Fair', D: 'Poor' };

const METRIC_THRESHOLDS: Record<string, string> = {
  'Current Ratio':       'A ≥ 2.0 · B ≥ 1.5 · C ≥ 1.0 · D < 1.0',
  'Quick Ratio':         'A ≥ 1.5 · B ≥ 1.0 · C ≥ 0.7 · D < 0.7',
  'Debt / Equity':       'A ≤ 0.3 · B ≤ 0.7 · C ≤ 1.5 · D > 1.5',
  'Interest Coverage':   'A ≥ 10x · B ≥ 5x · C ≥ 2x · D < 2x',
  'Gross Margin':        'A ≥ 60% · B ≥ 40% · C ≥ 20% · D < 20%',
  'EBITDA Margin':       'A ≥ 30% · B ≥ 20% · C ≥ 10% · D < 10%',
  'Net Profit Margin':   'A ≥ 20% · B ≥ 10% · C ≥ 5% · D < 5%',
  'ROE':                 'A ≥ 20% · B ≥ 12% · C ≥ 5% · D < 5%',
  'ROA':                 'A ≥ 10% · B ≥ 5% · C ≥ 2% · D < 2%',
  'Rev Growth (3yr Avg)':'A ≥ 15% · B ≥ 8% · C ≥ 3% · D < 3%',
  'Rev CAGR (3yr)':      'A ≥ 15% · B ≥ 8% · C ≥ 3% · D < 3%',
  'EPS Growth (3yr Avg)':'A ≥ 15% · B ≥ 8% · C ≥ 3% · D < 3%',
  'FCF Margin':          'A ≥ 15% · B ≥ 8% · C ≥ 3% · D < 3%',
  'FCF Conversion':      'A ≥ 100% · B ≥ 60% · C ≥ 20% · D < 20%',
  'CFO Margin':          'A ≥ 20% · B ≥ 12% · C ≥ 5% · D < 5%',
};

const gradeToScore100 = (g: LetterGrade): number => ({ A: 100, B: 75, C: 50, D: 25 }[g]);

const iconMap: Record<string, React.ReactNode> = {
  shield:   <Shield    className="w-5 h-5 text-emerald-400" />,
  dollar:   <DollarSign className="w-5 h-5 text-blue-400" />,
  trend:    <TrendingUp className="w-5 h-5 text-amber-400" />,
  activity: <Activity  className="w-5 h-5 text-purple-400" />,
};

function TrendIcon({ trend }: { trend: 'improving' | 'stable' | 'declining' }) {
  if (trend === 'improving') return <TrendingUp   className="w-3 h-3 text-emerald-400 flex-shrink-0" />;
  if (trend === 'declining') return <TrendingDown className="w-3 h-3 text-red-400 flex-shrink-0" />;
  return <span className="w-3 h-3 flex-shrink-0 text-slate-600 text-xs flex items-center justify-center">—</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompanyGrade() {
  const [tickerInput, setTickerInput] = useState('');
  const [ticker, setTicker] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rawResult, setRawResult] = useState<ReturnType<typeof computeGrades> | null>(null);
  const [historicalSummary, setHistoricalSummary] = useState<any[]>([]);
  const fetchAndGrade = async (sym: string) => {
    setLoading(true);
    setError('');
    setRawResult(null);
    setCompanyName('');

    const cacheKey = `valuwise_grade_v2_${sym}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { payload, ts } = JSON.parse(cached);
        if (Date.now() - ts < 24 * 60 * 60 * 1000) {
          processPayload(payload);
          setLoading(false);
          return;
        }
      } catch { /* ignore bad cache */ }
    }

    try {
      const [finRes, profRes] = await Promise.all([
        fetch(`${BASE_URL}/stock/financials-reported?symbol=${sym}&freq=annual&token=${API_KEY}`),
        fetch(`${BASE_URL}/stock/profile2?symbol=${sym}&token=${API_KEY}`),
      ]);
      const [finJson, profJson] = await Promise.all([finRes.json(), profRes.json()]);

      const financials = (finJson.data ?? []).slice(0, 6);

      if (financials.length === 0) {
        setError('No financial data found. Only US-listed stocks with SEC filings (NYSE / NASDAQ) are supported.');
        setLoading(false);
        return;
      }

      const payload = { financials, profile: profJson };
      safeSetItem(cacheKey, JSON.stringify({ payload, ts: Date.now() }));
      processPayload(payload);
    } catch {
      setError('Failed to fetch data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const processPayload = (payload: any) => {
    const { historicalSummary: hs, revCagr3yr } = buildHistoricalSummary(payload.financials);
    const result = computeGrades(hs, revCagr3yr);
    setRawResult(result);
    setHistoricalSummary(hs);
    setCompanyName(payload.profile?.name ?? '');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = tickerInput.trim().toUpperCase();
    if (sym) {
      setTicker(sym);
      fetchAndGrade(sym);
    }
  };

  // Attach JSX icons inside useMemo so pure logic stays outside React
  const gradeData = useMemo(() => {
    if (!rawResult) return null;
    const categories: CategoryResult[] = rawResult.rawCategories.map(cat => ({
      ...cat,
      icon: iconMap[cat.iconKey],
    }));
    return { categories, overallGrade: rawResult.overallGrade, overallScore: rawResult.overallScore, summary: rawResult.summary };
  }, [rawResult]);

  const yoyGrades = useMemo(
    () => historicalSummary.slice(-3).map(computeSingleYearGrades),
    [historicalSummary]);

  const altmanZ = useMemo(() => {
    const latest = historicalSummary[historicalSummary.length - 1];
    return latest ? computeAltmanZ(latest) : null;
  }, [historicalSummary]);

  const riskFlags = useMemo(
    () => historicalSummary.length > 0 ? computeRiskFlags(historicalSummary) : null,
    [historicalSummary]);

  // ── Peer grade comparison state ──────────────────────────────────────────────
  const [peerGrades, setPeerGrades] = useState<any[]>([]);
  const [peerGradesLoading, setPeerGradesLoading] = useState(false);

  useEffect(() => {
    if (!gradeData || !ticker) { setPeerGrades([]); return; }
    let cancelled = false;
    const run = async () => {
      setPeerGradesLoading(true);
      // 1. Fetch or read cached peer list
      const cacheKeyPeers = `valuwise_peers_v2_${ticker}`;
      let peers: string[] = [];
      const cachedPeers = localStorage.getItem(cacheKeyPeers);
      if (cachedPeers) {
        try {
          const { data, ts } = JSON.parse(cachedPeers);
          if (Date.now() - ts < 24 * 60 * 60 * 1000) peers = data;
        } catch { /* ignore */ }
      }
      if (peers.length === 0) {
        try {
          const res = await fetch(`${BASE_URL}/stock/peers?symbol=${ticker}&grouping=subindustry&token=${API_KEY}`);
          const json = await res.json();
          peers = (Array.isArray(json) ? json : []).filter((p: string) => p !== ticker).slice(0, 4);
          safeSetItem(cacheKeyPeers, JSON.stringify({ data: peers, ts: Date.now() }));
        } catch { /* ignore */ }
      }
      // 2. Grade each peer
      const results = await Promise.allSettled(peers.map(async (peerTicker: string) => {
        const cacheKey = `valuwise_grade_v2_${peerTicker}`;
        let payload: any = null;
        const cp = localStorage.getItem(cacheKey);
        if (cp) {
          try {
            const { payload: p, ts } = JSON.parse(cp);
            if (Date.now() - ts < 24 * 60 * 60 * 1000) payload = p;
          } catch { /* ignore */ }
        }
        if (!payload) {
          const [finRes, profRes] = await Promise.all([
            fetch(`${BASE_URL}/stock/financials-reported?symbol=${peerTicker}&freq=annual&token=${API_KEY}`),
            fetch(`${BASE_URL}/stock/profile2?symbol=${peerTicker}&token=${API_KEY}`),
          ]);
          const [finJson, profJson] = await Promise.all([finRes.json(), profRes.json()]);
          const financials = (finJson.data ?? []).slice(0, 6);
          if (financials.length === 0) throw new Error('No data');
          payload = { financials, profile: profJson };
          safeSetItem(cacheKey, JSON.stringify({ payload, ts: Date.now() }));
        }
        const { historicalSummary: hs, revCagr3yr } = buildHistoricalSummary(payload.financials);
        const result = computeGrades(hs, revCagr3yr);
        if (!result) throw new Error('Grade failed');
        return {
          symbol: peerTicker,
          name: payload.profile?.name ?? peerTicker,
          health:  result.rawCategories[0].grade as LetterGrade,
          prof:    result.rawCategories[1].grade as LetterGrade,
          growth:  result.rawCategories[2].grade as LetterGrade,
          cf:      result.rawCategories[3].grade as LetterGrade,
          overall: result.overallGrade as LetterGrade,
          score:   result.overallScore,
        };
      }));
      if (!cancelled) {
        const successful = results
          .filter(r => r.status === 'fulfilled')
          .map(r => (r as PromiseFulfilledResult<any>).value);
        setPeerGrades(successful);
        setPeerGradesLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [gradeData, ticker]);

  const chartData = useMemo(() => historicalSummary.map(y => ({
    year: y.year.substring(0, 4),
    grossMargin:      +(y.grossMargin      * 100).toFixed(1),
    ebitdaMargin:     +(y.ebitdaMargin     * 100).toFixed(1),
    netProfitMargin:  +(y.netProfitMargin  * 100).toFixed(1),
    currentRatio:     +y.currentRatio.toFixed(2),
    quickRatio:       +y.quickRatio.toFixed(2),
    debtToEquity:     +y.debtToEquity.toFixed(2),
    interestCoverage: +Math.min(y.interestCoverage, 30).toFixed(1),
    roe: +(y.roe * 100).toFixed(1),
    roa: +(y.roa * 100).toFixed(1),
  })), [historicalSummary]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Search Controls */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 max-w-2xl mx-auto">
        <form onSubmit={handleSearch}>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex flex-col gap-2 flex-1 max-w-sm">
              <label className="block text-sm font-medium text-slate-400">Company Ticker</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value)}
                  placeholder="e.g. AAPL"
                  className="block w-full pl-10 pr-3 py-2 border border-slate-600 rounded-lg leading-5 bg-slate-900 text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm uppercase"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !tickerInput.trim()}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading ? 'Loading...' : 'Grade Company'}
            </button>
          </div>
        </form>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm animate-pulse">Fetching financial data…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-5 flex items-start gap-3 max-w-lg">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm">{error}</p>
            <p className="text-slate-500 text-xs mt-2">If this keeps happening, click <span className="text-slate-300 font-medium">Clear Cache</span> in the top-right corner and try again.</p>
          </div>
        </div>
      )}

      {/* Instructions + Empty state */}
      {!loading && !error && !gradeData && (
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-300">About Company Grade</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Generate a letter-grade financial report card (A–D) for any public company. Grades are based on 3-year averages of reported GAAP/IFRS financials, benchmarked against absolute industry-agnostic thresholds across four weighted categories.
            </p>
            <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {[
                'Enter a ticker above and press Grade to fetch 5 years of reported financials.',
                'Financial Health (25%): liquidity ratios, leverage, and interest coverage.',
                'Profitability (30%): gross/EBITDA/net margins, ROE, and ROA.',
                'Growth (25%): revenue CAGR, average annual revenue growth, and EPS growth.',
                'Cash Flow Quality (20%): FCF margin, FCF conversion, and CFO margin.',
                'Trend arrows (↑/↓) show whether each metric improved or declined over recent periods.',
                'Risk flags highlight key financial warning signs automatically.',
                'The Altman Z″-Score provides a directional bankruptcy-risk signal based on balance sheet ratios.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-slate-400">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs text-emerald-400 font-semibold">{i + 1}</span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col items-center py-10 space-y-3 text-center">
            <div className="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center">
              <Award className="w-7 h-7 text-slate-500" />
            </div>
            <p className="text-slate-500 text-sm">Enter a ticker above to generate the report card.</p>
          </div>
        </div>
      )}

      {/* Grade report */}
      {!loading && gradeData && (() => {
        const { categories, overallGrade, overallScore, summary } = gradeData;
        const c = gradeColors[overallGrade];
        return (
          <>
            {/* ── Overall Hero ──────────────────────────────────────────────── */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-8">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8">

                {/* Grade circle */}
                <div className={`flex-shrink-0 w-28 h-28 rounded-full border-4 ${c.border} ${c.bg} flex items-center justify-center`}>
                  <span className={`text-6xl font-bold ${c.text}`}>{overallGrade}</span>
                </div>

                {/* Info */}
                <div className="flex-1 text-center sm:text-left space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-baseline gap-2">
                    <h2 className="text-2xl font-bold text-white font-mono">{ticker}</h2>
                    {companyName && <span className="text-slate-400">{companyName}</span>}
                  </div>
                  <div className="flex items-center justify-center sm:justify-start gap-3">
                    <span className="text-3xl font-light text-slate-300">
                      {overallScore}<span className="text-lg text-slate-500">/100</span>
                    </span>
                    <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${c.badge}`}>
                      {gradeLabel[overallGrade]}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm leading-relaxed max-w-lg">{summary}</p>
                </div>

                {/* Mini category grades */}
                <div className="flex sm:flex-col gap-2 flex-shrink-0">
                  {categories.map(cat => {
                    const cc = gradeColors[cat.grade];
                    return (
                      <div key={cat.name} className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 hidden sm:block text-right w-24 truncate">{cat.name.split(' ')[0]}</span>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cc.bg}`}>
                          <span className={`text-sm font-bold ${cc.text}`}>{cat.grade}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Score bar */}
              <div className="mt-6 space-y-1">
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${c.bar}`} style={{ width: `${overallScore}%` }} />
                </div>
                <div className="flex justify-between text-xs text-slate-600 px-0.5">
                  <span>D</span><span>C</span><span>B</span><span>A</span>
                </div>
              </div>
            </div>

            {/* ── Category Cards ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {categories.map(cat => {
                const cc = gradeColors[cat.grade];
                return (
                  <div key={cat.name} className={`bg-slate-800/50 border ${cc.border} rounded-xl p-6 space-y-4`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg ${cc.bg} flex items-center justify-center`}>{cat.icon}</div>
                        <div>
                          <div className="font-semibold text-slate-200">{cat.name}</div>
                          <div className="text-xs text-slate-500">{cat.weight}% weight</div>
                        </div>
                      </div>
                      <div className={`w-10 h-10 rounded-full ${cc.bg} border ${cc.border} flex items-center justify-center`}>
                        <span className={`text-lg font-bold ${cc.text}`}>{cat.grade}</span>
                      </div>
                    </div>
                    <div className="border-t border-slate-700/50" />
                    <div className="space-y-2">
                      {cat.metrics.map(metric => {
                        const mc = gradeColors[metric.grade];
                        return (
                          <div key={metric.name} className="flex items-center justify-between py-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <TrendIcon trend={metric.trend} />
                              <span className="text-sm text-slate-400 truncate cursor-help" title={METRIC_THRESHOLDS[metric.name]}>{metric.name}</span>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-sm font-mono text-slate-300">{metric.formattedValue}</span>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded min-w-[28px] text-center ${mc.badge}`}>{metric.grade}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Risk Flags ──────────────────────────────────────────────── */}
            {riskFlags !== null && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-slate-300">Risk Flags</h3>
                  {riskFlags.length > 0 && (
                    <span className="ml-auto text-xs bg-red-500/15 text-red-400 border border-red-500/30 rounded-full px-2 py-0.5">
                      {riskFlags.length} {riskFlags.length === 1 ? 'flag' : 'flags'}
                    </span>
                  )}
                </div>
                {riskFlags.length === 0 ? (
                  <p className="text-sm text-emerald-400">No significant risk flags identified.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {riskFlags.map(flag => (
                      <span key={flag} className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-300 border border-red-500/25 rounded-full px-3 py-1 text-xs font-medium">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        {flag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Historical Charts ───────────────────────────────────────── */}
            {chartData.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Historical Margins */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-300 mb-4">Historical Margins</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}%`} width={40} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number, name: string) => [`${v}%`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Line type="monotone" dataKey="grossMargin"     name="Gross"    stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="ebitdaMargin"    name="EBITDA"   stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="netProfitMargin" name="Net"      stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Financial Health Ratios */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-300 mb-4">Financial Health Ratios</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={36} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number, name: string) => [`${v}x`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 2" />
                      <Bar dataKey="currentRatio" name="Current" fill="#10b981" opacity={0.85} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="quickRatio"   name="Quick"   fill="#3b82f6" opacity={0.85} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="debtToEquity" name="D/E"     fill="#f59e0b" opacity={0.85} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* ROE & ROA */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-300 mb-4">Return on Equity &amp; Assets</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}%`} width={40} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number, name: string) => [`${v}%`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <ReferenceLine y={0} stroke="#64748b" strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="roe" name="ROE" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="roa" name="ROA" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

              </div>
            )}

            {/* ── Score Trend Chart ───────────────────────────────────────── */}
            {yoyGrades.length >= 2 && (() => {
              const trendData = yoyGrades.map(yg => ({
                year: yg.year,
                Overall:      yg.score,
                Health:       gradeToScore100(yg.health),
                Profitability:gradeToScore100(yg.prof),
                Growth:       gradeToScore100(yg.growth),
                'Cash Flow':  gradeToScore100(yg.cf),
              }));
              return (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-300 mb-4">Grade Score Trend</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `${v}`} width={36} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                        labelStyle={{ color: '#e2e8f0' }}
                        formatter={(v: number, name: string) => [`${v}/100`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Line type="monotone" dataKey="Overall"       stroke="#f1f5f9" strokeWidth={2.5} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="Health"        stroke="#10b981" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="Profitability" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="Growth"        stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="Cash Flow"     stroke="#a78bfa" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {/* ── YoY Grade History + Altman Z ────────────────────────────── */}
            {(yoyGrades.length > 0 || altmanZ) && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Radar Chart — Category Scores */}
                {gradeData && (() => {
                  const radarData = [
                    { subject: 'Health',  score: scoreTo100(gradeData.categories[0].score), fullMark: 100 },
                    { subject: 'Profit',  score: scoreTo100(gradeData.categories[1].score), fullMark: 100 },
                    { subject: 'Growth',  score: scoreTo100(gradeData.categories[2].score), fullMark: 100 },
                    { subject: 'Cash Flow', score: scoreTo100(gradeData.categories[3].score), fullMark: 100 },
                  ];
                  return (
                    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                      <h3 className="text-sm font-semibold text-slate-300 mb-2">Category Profile</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                          <PolarGrid stroke="#334155" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                          {/* Max boundary ring */}
                          <Radar name="Max" dataKey="fullMark" stroke="#334155" fill="none" strokeDasharray="3 2" />
                          {/* Company scores */}
                          <Radar name={ticker} dataKey="score" stroke="#10b981" fill="#10b981" fillOpacity={0.2} strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                            formatter={(v: number) => [`${v}/100`]}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {/* Year-over-Year Grade History */}
                {yoyGrades.length > 0 && (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-slate-300 mb-4">Year-over-Year Grade History</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-slate-500 text-xs uppercase tracking-wide border-b border-slate-700/50">
                            <th className="text-left pb-2.5 pr-4">Year</th>
                            <th className="text-center pb-2.5 px-2">Health</th>
                            <th className="text-center pb-2.5 px-2">Profit</th>
                            <th className="text-center pb-2.5 px-2">Growth</th>
                            <th className="text-center pb-2.5 px-2">Cash</th>
                            <th className="text-center pb-2.5 pl-2">Overall</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {yoyGrades.map(yg => (
                            <tr key={yg.year}>
                              <td className="py-2.5 pr-4 font-mono text-slate-400 text-xs">{yg.year}</td>
                              {(['health', 'prof', 'growth', 'cf'] as const).map(cat => {
                                const g  = yg[cat];
                                const cc = gradeColors[g];
                                return (
                                  <td key={cat} className="text-center py-2.5 px-2">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${cc.badge}`}>{g}</span>
                                  </td>
                                );
                              })}
                              <td className="text-center py-2.5 pl-2">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeColors[yg.overall].badge}`}>{yg.overall}</span>
                                  <span className="text-[10px] text-slate-600">{yg.score}/100</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Altman Z''-Score */}
                {altmanZ && (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-slate-300 mb-4">Altman Z&#8243;-Score</h3>
                    <div className="flex items-start gap-5">
                      <div className={`flex-shrink-0 w-24 h-24 rounded-xl flex flex-col items-center justify-center border
                        ${altmanZ.zone === 'safe'     ? 'bg-emerald-500/10 border-emerald-500/30' :
                          altmanZ.zone === 'grey'     ? 'bg-amber-500/10  border-amber-500/30'  :
                                                        'bg-red-500/10    border-red-500/30'}`}>
                        <span className={`text-3xl font-bold font-mono
                          ${altmanZ.zone === 'safe' ? 'text-emerald-400' : altmanZ.zone === 'grey' ? 'text-amber-400' : 'text-red-400'}`}>
                          {altmanZ.z.toFixed(2)}
                        </span>
                        <span className="text-xs text-slate-500 mt-1">Z&#8243;-Score</span>
                      </div>
                      <div className="flex-1 space-y-3">
                        <span className={`text-sm font-semibold
                          ${altmanZ.zone === 'safe' ? 'text-emerald-400' : altmanZ.zone === 'grey' ? 'text-amber-400' : 'text-red-400'}`}>
                          {altmanZ.zone === 'safe' ? '✓ Safe Zone' : altmanZ.zone === 'grey' ? '⚠ Grey Zone' : '✗ Distress Zone'}
                        </span>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className={`rounded-lg px-2 py-1.5 text-center ${altmanZ.zone === 'safe' ? 'bg-emerald-500/20 ring-1 ring-emerald-500/40' : 'bg-emerald-500/10'}`}>
                            <div className="font-semibold text-emerald-400">Safe</div>
                            <div className="text-slate-500">&gt; 2.99</div>
                          </div>
                          <div className={`rounded-lg px-2 py-1.5 text-center ${altmanZ.zone === 'grey' ? 'bg-amber-500/20 ring-1 ring-amber-500/40' : 'bg-amber-500/10'}`}>
                            <div className="font-semibold text-amber-400">Grey</div>
                            <div className="text-slate-500">1.81–2.99</div>
                          </div>
                          <div className={`rounded-lg px-2 py-1.5 text-center ${altmanZ.zone === 'distress' ? 'bg-red-500/20 ring-1 ring-red-500/40' : 'bg-red-500/10'}`}>
                            <div className="font-semibold text-red-400">Distress</div>
                            <div className="text-slate-500">&lt; 1.81</div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          Uses book equity ratios. Directional signal only — not a definitive bankruptcy predictor.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* ── Peer Grade Comparison ───────────────────────────────────── */}
            {(peerGradesLoading || peerGrades.length > 0) && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-sm font-semibold text-slate-300">Peer Comparison</h3>
                  {peerGradesLoading && (
                    <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin ml-1" />
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs uppercase tracking-wide border-b border-slate-700/50">
                        <th className="text-left pb-2.5 pr-4 w-40">Company</th>
                        <th className="text-center pb-2.5 px-2">Health</th>
                        <th className="text-center pb-2.5 px-2">Profit</th>
                        <th className="text-center pb-2.5 px-2">Growth</th>
                        <th className="text-center pb-2.5 px-2">Cash Flow</th>
                        <th className="text-center pb-2.5 pl-2">Overall</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/30">
                      {/* Target row */}
                      <tr className="bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20 rounded">
                        <td className="py-2.5 pr-4">
                          <span className="font-mono text-emerald-400 text-xs font-semibold">{ticker}</span>
                          <span className="text-slate-500 text-xs ml-1.5 hidden sm:inline truncate max-w-[80px]">{companyName}</span>
                        </td>
                        {gradeData && [0, 1, 2, 3].map(idx => {
                          const grade = gradeData.categories[idx]?.grade ?? 'D';
                          const cc = gradeColors[grade];
                          return (
                            <td key={idx} className="text-center py-2.5 px-2">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${cc.badge}`}>{grade}</span>
                            </td>
                          );
                        })}
                        {gradeData && (
                          <td className="text-center py-2.5 pl-2">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeColors[gradeData.overallGrade].badge}`}>{gradeData.overallGrade}</span>
                              <span className="text-[10px] text-slate-600">{gradeData.overallScore}/100</span>
                            </div>
                          </td>
                        )}
                      </tr>
                      {/* Peer rows */}
                      {peerGrades.map(pg => (
                        <tr key={pg.symbol}>
                          <td className="py-2.5 pr-4">
                            <span className="font-mono text-slate-300 text-xs font-semibold">{pg.symbol}</span>
                            <span className="text-slate-500 text-xs ml-1.5 hidden sm:inline">{pg.name}</span>
                          </td>
                          {(['health', 'prof', 'growth', 'cf'] as const).map(cat => {
                            const grade = pg[cat] as LetterGrade;
                            const cc = gradeColors[grade];
                            return (
                              <td key={cat} className="text-center py-2.5 px-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${cc.badge}`}>{grade}</span>
                              </td>
                            );
                          })}
                          <td className="text-center py-2.5 pl-2">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeColors[pg.overall].badge}`}>{pg.overall}</span>
                              <span className="text-[10px] text-slate-600">{pg.score}/100</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {/* Skeleton rows while loading */}
                      {peerGradesLoading && peerGrades.length === 0 && [1,2,3].map(i => (
                        <tr key={`skel-${i}`}>
                          <td className="py-2.5 pr-4"><div className="h-3 w-16 bg-slate-700 rounded animate-pulse" /></td>
                          {[1,2,3,4,5].map(j => (
                            <td key={j} className="text-center py-2.5 px-2"><div className="h-4 w-8 bg-slate-700 rounded animate-pulse mx-auto" /></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-600 text-center pb-4">
              Grades based on 3-year averages of reported financials using absolute benchmarks.
              Trend indicators reflect direction across the 3 most recent reported periods.
            </p>
          </>
        );
      })()}
    </div>
  );
}
