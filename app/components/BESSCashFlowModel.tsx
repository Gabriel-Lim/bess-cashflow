'use client';

import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  Download,
  TrendingUp,
  DollarSign,
  Calculator,
  Activity
} from 'lucide-react';

/**
 * BESS Cash Flow Model – Singapore (TSX)
 * --------------------------------------------------
 * 2025‑05‑27: Fixed build‑time syntax error by completing component markup
 *             & closing all braces/JSX tags.  Code now compiles under
 *             Next.js 15.3 TS/JSX parser.
 * 2025‑05‑27: Added payback‑period & IRR sensitivity analysis line chart
 *             across Capex/kWh values ($300‑$400) – positioned beneath
 *             detailed cash‑flow table.
 */

// ----------------------------------------------------------------------------------
//  Scenario‑specific market context numbers ----------------------------------------
// ----------------------------------------------------------------------------------
const MARKET_CONTEXT = {
  base: {
    drIncentive: 2316.59,
    eligiblePeriods: 382,
    participationRate: 0.426,
    conresaPrice: 19.7,
    drPeriods: 163,
    ilPeriods: 17357
  },
  downside: {
    drIncentive: 2297.1,
    eligiblePeriods: 229,
    participationRate: 0.426,
    conresaPrice: 15.27,
    drPeriods: 98,
    ilPeriods: 17422
  },
  upside: {
    drIncentive: 2770.0,
    eligiblePeriods: 801,
    participationRate: 0.426,
    conresaPrice: 16.51,
    drPeriods: 342,
    ilPeriods: 17178
  }
} as const;

// ----------------------------------------------------------------------------------
//  Types ---------------------------------------------------------------------------
// ----------------------------------------------------------------------------------

type ScenarioKey = keyof typeof MARKET_CONTEXT;

interface SensitivityPoint {
  capex: number;
  payback: number;
  irr: number; // percentage
}

// ----------------------------------------------------------------------------------
//  Component -----------------------------------------------------------------------
// ----------------------------------------------------------------------------------
const BESSCashFlowModel: React.FC = () => {
  /*─────────────────────────── State ───────────────────────────*/
  const [bessSize, setBessSize] = useState<number>(250);
  const [capexPerKwh, setCapexPerKwh] = useState<number>(350);
  const [revenueScenario, setRevenueScenario] = useState<ScenarioKey>('base');
  const [discountRate, setDiscountRate] = useState<number>(0.08);
  const [debtRatio, setDebtRatio] = useState<number>(0);
  const [interestRate, setInterestRate] = useState<number>(0.08);
  const [loanTenor, setLoanTenor] = useState<number>(7);

  // Optional aggregator fee
  const [includeAggregatorFee, setIncludeAggregatorFee] = useState<boolean>(false);
  const [aggregatorFeePercent, setAggregatorFeePercent] = useState<number>(22);

  /*──────────────────────── Constants ─────────────────────────*/
  const PROJECT_LIFE = 12; // yrs
  const OM_COST_RATE = 0.015; // 1.5 % of capex
  const DEGRADATION_RATE = 0.02; // 2 %/yr
  const POWER_TO_ENERGY = 0.5; // 2‑hour battery
  const DISCHARGE_EFF = 0.96; // 4 % loss

  const REVENUE_PER_KW = {
    downside: 245.57,
    base: 359.77,
    upside: 615.47
  } as const;

  /*───────────────────── Core Calculations ─────────────────────*/
  const calc = useMemo(() => {
    const feeRate = includeAggregatorFee ? aggregatorFeePercent / 100 : 0;

    const powerKw = bessSize * POWER_TO_ENERGY;
    const totalCapex = bessSize * capexPerKwh;
    const annualOm = totalCapex * OM_COST_RATE;
    const grossRevenue = powerKw * REVENUE_PER_KW[revenueScenario] * DISCHARGE_EFF;
    const feeAnnual = grossRevenue * feeRate;
    const netRevenue = grossRevenue - feeAnnual;

    // Debt service
    const debt = totalCapex * debtRatio;
    const equity = totalCapex - debt;
    let annualDebtPmt = 0;
    if (debt > 0 && loanTenor > 0) {
      annualDebtPmt = interestRate === 0
        ? debt / loanTenor
        : (debt * interestRate * Math.pow(1 + interestRate, loanTenor)) / (Math.pow(1 + interestRate, loanTenor) - 1);
    }

    // Cash‑flow projection
    const flows: any[] = [];
    let cumulative = 0;
    let npv = -equity;

    for (let yr = 0; yr <= PROJECT_LIFE; yr++) {
      const degFactor = yr === 0 ? 0 : Math.pow(1 - DEGRADATION_RATE, yr - 1);
      const gRev = yr === 0 ? 0 : grossRevenue * degFactor;
      const fee = yr === 0 ? 0 : gRev * feeRate;
      const rev = yr === 0 ? 0 : gRev - fee;
      const opex = yr === 0 ? 0 : annualOm;
      const debtSvc = yr > 0 && yr <= loanTenor ? annualDebtPmt : 0;
      const ebitda = rev - opex;
      const cashEq = ebitda - debtSvc;
      const initialInv = yr === 0 ? -equity : 0;
      const netCF = cashEq + initialInv;
      cumulative += netCF;
      const disc = Math.pow(1 + discountRate, -yr);
      npv += netCF * disc;

      flows.push({
        year: yr,
        revenue: Math.round(rev),
        aggregatorFee: Math.round(fee),
        opex: Math.round(opex),
        ebitda: Math.round(ebitda),
        debtService: Math.round(debtSvc),
        netCashFlow: Math.round(netCF),
        cumulativeCashFlow: Math.round(cumulative)
      });
    }

    // IRR & payback
    const irr = calcIRR(flows.map(f => f.netCashFlow));
    let payback = PROJECT_LIFE;
    for (let i = 1; i < flows.length; i++) {
      if (flows[i].cumulativeCashFlow > 0) {
        const prev = flows[i - 1].cumulativeCashFlow;
        const frac = -prev / flows[i].netCashFlow;
        payback = i - 1 + frac;
        break;
      }
    }

    return {
      powerKw,
      totalCapex,
      equity,
      debt,
      annualOm,
      grossRevenue,
      feeAnnual,
      netRevenue,
      annualDebtPmt,
      flows,
      npv,
      irr,
      payback,
      ebitdaMarginYear1: (((netRevenue - annualOm) / netRevenue) * 100).toFixed(1)
    } as const;
  }, [
    bessSize,
    capexPerKwh,
    revenueScenario,
    discountRate,
    debtRatio,
    interestRate,
    loanTenor,
    includeAggregatorFee,
    aggregatorFeePercent
  ]);

  /*──────────────── Sensitivity Analysis (Capex) ───────────────*/
  const sensitivityData: SensitivityPoint[] = useMemo(() => {
    const CAPEX_VALUES = [300, 325, 350, 375, 400] as const;
    const feeRate = includeAggregatorFee ? aggregatorFeePercent / 100 : 0;

    return CAPEX_VALUES.map((cpx) => {
      const powerKw = bessSize * POWER_TO_ENERGY;
      const totalCapex = bessSize * cpx;
      const annualOm = totalCapex * OM_COST_RATE;
      const grossRevenue = powerKw * REVENUE_PER_KW[revenueScenario] * DISCHARGE_EFF;
      const feeAnnual = grossRevenue * feeRate;
      const netRevenue = grossRevenue - feeAnnual;

      const debt = totalCapex * debtRatio;
      const equity = totalCapex - debt;

      // Debt service
      let annualDebtPmt = 0;
      if (debt > 0 && loanTenor > 0) {
        annualDebtPmt = interestRate === 0
          ? debt / loanTenor
          : (debt * interestRate * Math.pow(1 + interestRate, loanTenor)) / (Math.pow(1 + interestRate, loanTenor) - 1);
      }

      // Generate cash‑flow vector for IRR & payback
      const flows: number[] = [];
      for (let yr = 0; yr <= PROJECT_LIFE; yr++) {
        const degFactor = yr === 0 ? 0 : Math.pow(1 - DEGRADATION_RATE, yr - 1);
        const gRev = yr === 0 ? 0 : grossRevenue * degFactor;
        const fee = yr === 0 ? 0 : gRev * feeRate;
        const rev = yr === 0 ? 0 : gRev - fee;
        const opex = yr === 0 ? 0 : annualOm;
        const debtSvc = yr > 0 && yr <= loanTenor ? annualDebtPmt : 0;
        const ebitda = rev - opex;
        const cashEq = ebitda - debtSvc;
        const initialInv = yr === 0 ? -equity : 0;
        flows.push(cashEq + initialInv);
      }

      // IRR
      const irr = calcIRR(flows) * 100;

      // Payback
      let cumulative = 0;
      let payback = PROJECT_LIFE;
      for (let i = 0; i < flows.length; i++) {
        cumulative += flows[i];
        if (i > 0 && cumulative > 0) {
          const prevCum = cumulative - flows[i];
          const frac = -prevCum / flows[i];
          payback = i - 1 + frac;
          break;
        }
      }

      return { capex: cpx, payback, irr };
    });
  }, [
    bessSize,
    revenueScenario,
    debtRatio,
    interestRate,
    loanTenor,
    includeAggregatorFee,
    aggregatorFeePercent
  ]);

  /*─────────────────── Utility: IRR ───────────────────*/
  function calcIRR(cashFlows: number[]): number {
    let irr = 0.1;
    let step = 0.1;
    for (let iter = 0; iter < 100; iter++) {
      const npv = cashFlows.reduce((acc, cf, idx) => acc + cf / Math.pow(1 + irr, idx), 0);
      if (Math.abs(npv) < 0.01) break;
      if (npv > 0) {
        irr += step;
      } else {
        irr -= step;
        step /= 2;
      }
    }
    return irr;
  }

  /*───────────────── CSV Export ─────────────────*/
  const exportToCSV = () => {
    const headers = ['Year', 'Revenue', 'Aggregator Fee', 'OPEX', 'EBITDA', 'Debt Service', 'Net Cash Flow', 'Cumulative'];
    const rows = calc.flows.map(f => [f.year, f.revenue, f.aggregatorFee, f.opex, f.ebitda, f.debtService, f.netCashFlow, f.cumulativeCashFlow].join(','));
    const blob = new Blob([[headers.join(',')].concat(rows).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BESS_CashFlow_${bessSize}kWh_${capexPerKwh}perKwh.csv`;
    link.click();
  };

  /*─────────────────────────── UI ───────────────────────────*/
  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-lg shadow-lg">
        <h1 className="text-3xl font-bold mb-2">BESS Cash Flow Model – Singapore</h1>
        <p className="text-blue-100">Interactive financial analysis for Enva Solutions</p>
      </header>

      {/* Input Parameters */}
      <section className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Calculator className="text-blue-600" />Input Parameters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* BESS size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">BESS Size (kWh)</label>
            <select value={bessSize} onChange={e => setBessSize(+e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500">
              <option value={250}>250 kWh</option>
              <option value={500}>500 kWh</option>
            </select>
          </div>
          {/* Capex */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Capex per kWh (SGD)</label>
            <select value={capexPerKwh} onChange={e => setCapexPerKwh(+e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500">
              {[300, 325, 350, 375, 400].map(c => (<option key={c} value={c}>${c}</option>))}
            </select>
          </div>
          {/* Scenario */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Revenue Scenario</label>
            <select value={revenueScenario} onChange={e => setRevenueScenario(e.target.value as ScenarioKey)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500">
              <option value="downside">Downside (P90)</option>
              <option value="base">Base Case (P50)</option>
              <option value="upside">Upside (P10)</option>
            </select>
          </div>
          {/* Discount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Discount Rate (%)</label>
            <input type="number" value={discountRate * 100} onChange={e => setDiscountRate(+e.target.value / 100)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500" min={0} max={20} step={0.5} />
          </div>
          {/* Debt ratio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Debt Ratio (%)</label>
            <input type="number" value={debtRatio * 100} onChange={e => setDebtRatio(+e.target.value / 100)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500" min={0} max={90} step={5} />
          </div>
          {/* Interest */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Interest Rate (%)</label>
            <input type="number" value={interestRate * 100} onChange={e => setInterestRate(+e.target.value / 100)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500" min={0} max={15} step={0.25} />
          </div>
          {/* Aggregator fee checkbox */}
          <div className="flex items-center gap-2">
            <input id="feeToggle" type="checkbox" checked={includeAggregatorFee} onChange={e => setIncludeAggregatorFee(e.target.checked)} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
            <label htmlFor="feeToggle" className="text-sm font-medium text-gray-700">Include Aggregator Fee</label>
          </div>
          {/* Fee percent */}
          {includeAggregatorFee && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Aggregator Fee (%)</label>
              <input type="number" value={aggregatorFeePercent} onChange={e => setAggregatorFeePercent(+e.target.value)} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500" min={0} max={100} step={1} />
            </div>
          )}
        </div>
      </section>

      {/* Key Metrics */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Capex */}
        <MetricCard title="Total Capex" icon={<DollarSign className="text-green-600" size={20} />}>
          <p className="text-2xl font-bold">SGD {calc.totalCapex.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Equity: SGD {calc.equity.toLocaleString()}</p>
        </MetricCard>
        {/* NPV */}
        <MetricCard title={`NPV @ ${(discountRate * 100).toFixed(0)}%`} icon={<TrendingUp className="text-blue-600" size={20} />}>
          <p className="text-2xl font-bold">SGD {calc.npv.toLocaleString()}</p>
          <p className="text-xs text-gray-500">{calc.npv > 0 ? 'Positive' : 'Negative'} NPV</p>
        </MetricCard>
        {/* IRR */}
        <MetricCard title="Equity IRR" icon={<Activity className="text-purple-600" size={20} />}>
          <p className="text-2xl font-bold">{(calc.irr * 100).toFixed(1)}%</p>
          <p className="text-xs text-gray-500">{calc.irr > discountRate ? 'Above' : 'Below'} hurdle rate</p>
        </MetricCard>
        {/* Payback */}
        <MetricCard title="Payback Period" icon={<Calculator className="text-orange-600" size={20} />}>
          <p className="text-2xl font-bold">{calc.payback.toFixed(1)} yrs</p>
          <p className="text-xs text-gray-500">EBITDA Margin: {calc.ebitdaMarginYear1}%</p>
        </MetricCard>
      </section>

      {/* Cash‑flow Chart */}
      <section className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Annual Cash Flows</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={calc.flows.filter(f => f.year > 0)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis />
            <Tooltip formatter={(v: number) => `SGD ${v.toLocaleString()}`} />
            <Legend />
            {includeAggregatorFee && <Bar dataKey="aggregatorFee" fill="#a78bfa" name="Aggregator Fee" />}
            <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
            <Bar dataKey="opex" fill="#ef4444" name="OPEX" />
            <Bar dataKey="debtService" fill="#f59e0b" name="Debt Service" />
            <Bar dataKey="netCashFlow" fill="#3b82f6" name="Net Cash" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Detailed Table */}
      <section className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Detailed Cash Flow Table</h2>
          <button onClick={exportToCSV} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"><Download size={16} />Export CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {/* Year (left-aligned) */}
                <Th>Year</Th>
                {/* All numeric columns should be right-aligned */}
                <Th align>Revenue</Th>
                {includeAggregatorFee && <Th align>Aggregator Fee</Th>}
                <Th align>OPEX</Th>
                <Th align>EBITDA</Th>
                <Th align>Debt Service</Th>
                <Th align>Net Cash</Th>
                <Th align>Cumulative</Th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {calc.flows.map(f => (
                <tr key={f.year} className={f.year === 0 ? 'bg-gray-50' : ''}>
                  <Td>{f.year}</Td>
                  <Td align>{f.revenue.toLocaleString()}</Td>
                  {includeAggregatorFee && <Td align>{f.aggregatorFee.toLocaleString()}</Td>}
                  <Td align>{f.opex.toLocaleString()}</Td>
                  <Td align>{f.ebitda.toLocaleString()}</Td>
                  <Td align>{f.debtService.toLocaleString()}</Td>
                  <Td align className={f.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}>{f.netCashFlow.toLocaleString()}</Td>
                  <Td align className={f.cumulativeCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}>{f.cumulativeCashFlow.toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sensitivity Analysis */}
      <section className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Sensitivity Analysis: Payback &amp; IRR vs Capex</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={sensitivityData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="capex" tickFormatter={(v: number) => `$${v}`} label={{ value: 'Capex per kWh (SGD)', position: 'insideBottom', dy: 10 }} />
            <YAxis yAxisId="left" label={{ value: 'Payback (yrs)', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: 'IRR (%)', angle: -90, position: 'insideRight' }} />
            <Tooltip formatter={(value: number, name: string) => name.includes('Payback') ? `${value.toFixed(1)} yrs` : `${value.toFixed(1)} %`} />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="payback" stroke="#3b82f6" name="Payback (yrs)" />
            <Line yAxisId="right" type="monotone" dataKey="irr" stroke="#10b981" name="IRR (%)" />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Revenue Calculation Transparency */}
      <section className="bg-blue-50 rounded-lg p-6 space-y-6">
        <h3 className="font-semibold text-lg">Revenue Calculation Transparency</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left: step‑by‑step */}
          <div>
            <h4 className="font-medium text-blue-900 mb-2">Step‑by‑Step Calculation:</h4>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>1. Battery Size:</span><span className="font-mono">{bessSize} kWh</span></li>
              <li className="flex justify-between"><span>2. Power Capacity (@ {POWER_TO_ENERGY}C):</span><span className="font-mono">{calc.powerKw} kW</span></li>
              <li className="flex justify-between"><span>3. Revenue Rate ({revenueScenario}):</span><span className="font-mono">SGD {REVENUE_PER_KW[revenueScenario]}/kW‑yr</span></li>
              <li className="flex justify-between"><span>4. Discharge Efficiency:</span><span className="font-mono">96%</span></li>
              <li className="flex justify-between border-t pt-2"><span className="font-semibold">Annual Revenue:</span><span className="font-mono font-semibold">SGD {calc.grossRevenue.toLocaleString()}</span></li>
              {includeAggregatorFee && (
                <>
                  <li className="flex justify-between"><span>- Aggregator Fee ({aggregatorFeePercent}%):</span><span className="font-mono">SGD {calc.feeAnnual.toLocaleString()}</span></li>
                  <li className="flex justify-between border-t pt-2"><span className="font-semibold">Revenue After Fees:</span><span className="font-mono font-semibold">SGD {calc.netRevenue.toLocaleString()}</span></li>
                </>
              )}
            </ul>
          </div>
          {/* Right: dynamic market context */}
          <div>
            <h4 className="font-medium text-blue-900 mb-2">Singapore Market Context ({revenueScenario})</h4>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>Avg DR incentive (SGD/MWh):</span><span className="font-mono">{MARKET_CONTEXT[revenueScenario].drIncentive.toLocaleString()}</span></li>
              <li className="flex justify-between"><span>Eligible DR periods/yr:</span><span className="font-mono">{MARKET_CONTEXT[revenueScenario].eligiblePeriods}</span></li>
              <li className="flex justify-between"><span>BESS participation rate:</span><span className="font-mono">{(MARKET_CONTEXT[revenueScenario].participationRate * 100).toFixed(1)}%</span></li>
              <li className="flex justify-between"><span>Avg CONRESA price (SGD/MWh):</span><span className="font-mono">{MARKET_CONTEXT[revenueScenario].conresaPrice}</span></li>
              <li className="flex justify-between"><span>DR periods participated:</span><span className="font-mono">{MARKET_CONTEXT[revenueScenario].drPeriods}</span></li>
              <li className="flex justify-between border-b pb-1"><span>IL periods participated:</span><span className="font-mono">{MARKET_CONTEXT[revenueScenario].ilPeriods}</span></li>
              <li className="flex justify-between font-semibold pt-2"><span>Combined revenue (SGD/kW‑yr):</span><span className="font-mono">{REVENUE_PER_KW[revenueScenario]}</span></li>
            </ul>
          </div>
        </div>
        {/* ───────────────────── Contextual call-outs ───────────────────── */}
        <div className="mt-4 space-y-2 text-sm">
            {/* Yellow “Note:” bubble */}
            <div className="rounded bg-yellow-100 border-l-4 border-yellow-500 p-3 text-yellow-900">
                <span className="font-semibold">Note:&nbsp;</span>
                Your {bessSize} kWh battery only delivers{" "}
                {(bessSize * POWER_TO_ENERGY).toLocaleString()} kW of power (2-hour duration).
                Revenue is earned <em>per&nbsp;kW</em> of power, not kWh of energy.
                Additionally, 4% discharge losses are applied.
            </div>

            {/* Blue “Efficiency:” bubble */}
            <div className="rounded bg-blue-100 border-l-4 border-blue-500 p-3 text-blue-900">
                <span className="font-semibold">Efficiency:&nbsp;</span>
                92% round-trip = 8% total loss.  
                For ancillary services only discharge efficiency matters = 4% loss (96% efficiency)
            </div>
            </div>
      </section>

      {/* Key assumptions */}
      <section className="bg-gray-100 rounded-lg p-4 text-sm">
        <h3 className="font-semibold mb-2">Key Assumptions</h3>
        <ul className="space-y-1 text-gray-600">
          <li>• Power capacity: {calc.powerKw} kW (2‑hr, {POWER_TO_ENERGY}C)</li>
          <li>• Discharge efficiency: {(DISCHARGE_EFF * 100).toFixed(0)}%</li>
          <li>• O&M: {(OM_COST_RATE * 100).toFixed(1)}% of capex/yr</li>
          <li>• Degradation: {(DEGRADATION_RATE * 100).toFixed(0)}%/yr</li>
          <li>• Project life: {PROJECT_LIFE} yrs</li>
          <li>• Loan tenor: {loanTenor} yrs</li>
          {includeAggregatorFee && <li>• Aggregator fee: {aggregatorFeePercent}% of revenue</li>}
        </ul>
      </section>
    </div>
  );
};

// ----------------------------------------------------------------------------------
//  Helper presentational components ------------------------------------------------
// ----------------------------------------------------------------------------------
interface MetricCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}
const MetricCard: React.FC<MetricCardProps> = ({ title, icon, children }) => (
  <div className="bg-white rounded-lg shadow-lg p-6">
    <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-medium text-gray-600">{title}</h3>{icon}</div>
    {children}
  </div>
);

const Th: React.FC<{ children: React.ReactNode; align?: boolean }> = ({ children, align = false }) => (
  <th className={`px-4 py-2 text-${align ? 'right' : 'left'} text-xs font-medium text-gray-500 uppercase`}>{children}</th>
);
const Td: React.FC<{ children: React.ReactNode; align?: boolean; className?: string }> = ({ children, align = false, className = '' }) => (
  <td className={`px-4 py-2 ${align ? 'text-right' : 'text-left'} ${className}`}>{children}</td>
);

export default BESSCashFlowModel;