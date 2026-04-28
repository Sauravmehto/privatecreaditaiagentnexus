import { auditLog } from "../audit/logger";
import { findDealById } from "../data/db";

export function calculateIrrValue(cashFlows: number[], guess = 0.1): number {
  const maxIterations = 100;
  const tolerance = 1e-7;
  let rate = guess;

  for (let i = 0; i < maxIterations; i += 1) {
    let npv = 0;
    let derivative = 0;

    for (let t = 0; t < cashFlows.length; t += 1) {
      const discountFactor = (1 + rate) ** t;
      npv += cashFlows[t] / discountFactor;
      if (t > 0) {
        derivative -= (t * cashFlows[t]) / ((1 + rate) ** (t + 1));
      }
    }

    if (Math.abs(npv) < tolerance) {
      return rate;
    }

    if (derivative === 0) {
      break;
    }

    rate -= npv / derivative;
  }

  throw new Error("IRR failed to converge");
}

function summarize(payload: unknown): string {
  return JSON.stringify(payload).slice(0, 400);
}

function npv(cashFlows: number[], rate: number): number {
  return cashFlows.reduce((acc, cf, t) => acc + cf / ((1 + rate) ** t), 0);
}

export function solveIrrBisection(cashFlows: number[], lower = -0.95, upper = 5, tolerance = 1e-8, maxIter = 400): number {
  let lo = lower;
  let hi = upper;
  let fLo = npv(cashFlows, lo);
  let fHi = npv(cashFlows, hi);

  if (Math.sign(fLo) === Math.sign(fHi)) {
    for (let i = 0; i < 30; i += 1) {
      hi *= 1.5;
      fHi = npv(cashFlows, hi);
      if (Math.sign(fLo) !== Math.sign(fHi)) break;
    }
  }

  if (Math.sign(fLo) === Math.sign(fHi)) {
    return calculateIrrValue(cashFlows, 0.1);
  }

  for (let i = 0; i < maxIter; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(cashFlows, mid);
    if (Math.abs(fMid) < tolerance) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
      fHi = fMid;
    }
  }

  return (lo + hi) / 2;
}

function buildCashFlows(params: {
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
  orig_fee: number;
  eot_fee: number;
  warrant_fmv: number;
}): number[] {
  const flows: number[] = [];
  const fundedPrincipal = params.principal - params.orig_fee;
  flows.push(-fundedPrincipal);

  const monthlyRate = params.rate / 12;
  const ioPayment = params.principal * monthlyRate;
  for (let i = 0; i < params.io_months; i += 1) {
    flows.push(ioPayment);
  }

  const remaining = params.principal;
  const principalStep = remaining / Math.max(params.amort_months, 1);
  for (let i = 1; i <= params.amort_months; i += 1) {
    const balanceBeforePayment = remaining - principalStep * (i - 1);
    const interest = balanceBeforePayment * monthlyRate;
    const principalPayment = i === params.amort_months ? remaining - principalStep * (i - 1) : principalStep;
    flows.push(interest + principalPayment);
  }

  flows[flows.length - 1] += params.eot_fee + params.warrant_fmv;
  return flows;
}

function buildSchedule(params: {
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
  orig_fee: number;
  eot_fee: number;
  warrant_fmv: number;
}): Array<{ month: number; opening_balance: number; interest: number; principal: number; total_payment: number; closing_balance: number }> {
  const rows: Array<{ month: number; opening_balance: number; interest: number; principal: number; total_payment: number; closing_balance: number }> = [];
  const monthlyRate = params.rate / 12;
  let balance = params.principal;
  const amortStep = params.amort_months > 0 ? params.principal / params.amort_months : params.principal;
  const totalMonths = params.io_months + params.amort_months;
  for (let m = 1; m <= totalMonths; m += 1) {
    const opening = balance;
    const interest = opening * monthlyRate;
    const principalPay = m <= params.io_months ? 0 : Math.min(balance, amortStep);
    let total = interest + principalPay;
    balance = Math.max(0, opening - principalPay);
    if (m === totalMonths) {
      total += params.eot_fee + params.warrant_fmv;
    }
    rows.push({
      month: m,
      opening_balance: Number(opening.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      principal: Number(principalPay.toFixed(2)),
      total_payment: Number(total.toFixed(2)),
      closing_balance: Number(balance.toFixed(2))
    });
  }
  return rows;
}

export async function calculate_irr(input: {
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
  orig_fee: number;
  eot_fee: number;
  warrant_fmv: number;
  ip_address?: string;
}): Promise<{
  eir: number;
  cash_flow_schedule: number[];
  sensitivity_table: Record<string, number>;
}> {
  const cashFlows = buildCashFlows(input);
  const monthlyIrr = solveIrrBisection(cashFlows);
  const eir = (1 + monthlyIrr) ** 12 - 1;
  const sensitivity_table: Record<string, number> = {};
  for (const bump of [-0.02, -0.01, 0, 0.01, 0.02]) {
    const scenarioFlows = buildCashFlows({ ...input, rate: input.rate + bump });
    sensitivity_table[(input.rate + bump).toFixed(4)] = (1 + calculateIrrValue(scenarioFlows)) ** 12 - 1;
  }

  const payload = { eir, cash_flow_schedule: cashFlows, sensitivity_table };

  await auditLog({
    user_id: "anonymous",
    tool: "calculate_irr",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function calculate_term_loan_irr(input: {
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
  orig_fee: number;
  eot_fee: number;
  warrant_fmv: number;
  ip_address?: string;
}): Promise<{
  eir: number;
  moic: number;
  total_interest: number;
  fee_decomposition: { orig_fee: number; eot_fee: number; warrant_fmv: number };
  schedule: Array<{ month: number; opening_balance: number; interest: number; principal: number; total_payment: number; closing_balance: number }>;
}> {
  const schedule = buildSchedule(input);
  const cashFlows = [-input.principal + input.orig_fee, ...schedule.map((r) => r.total_payment)];
  const monthlyIrr = solveIrrBisection(cashFlows);
  const eir = (1 + monthlyIrr) ** 12 - 1;
  const totalInflows = schedule.reduce((acc, r) => acc + r.total_payment, 0);
  const moic = input.principal === 0 ? 0 : totalInflows / input.principal;
  const totalInterest = schedule.reduce((acc, r) => acc + r.interest, 0);

  const payload = {
    eir,
    moic,
    total_interest: Number(totalInterest.toFixed(2)),
    fee_decomposition: {
      orig_fee: input.orig_fee,
      eot_fee: input.eot_fee,
      warrant_fmv: input.warrant_fmv
    },
    schedule
  };

  await auditLog({
    user_id: "anonymous",
    tool: "calculate_term_loan_irr",
    params: input,
    response_summary: summarize({ eir: payload.eir, rows: payload.schedule.length }),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function calculate_note_irr(input: {
  principal: number;
  annual_coupon_rate: number;
  term_months: number;
  upfront_fee: number;
  exit_fee: number;
  ip_address?: string;
}): Promise<{
  eir: number;
  cash_flow_schedule: number[];
}> {
  const monthlyCoupon = input.principal * (input.annual_coupon_rate / 12);
  const flows = [-input.principal + input.upfront_fee];
  for (let m = 1; m <= input.term_months; m += 1) {
    flows.push(m === input.term_months ? monthlyCoupon + input.principal + input.exit_fee : monthlyCoupon);
  }
  const mIrr = solveIrrBisection(flows);
  const payload = {
    eir: (1 + mIrr) ** 12 - 1,
    cash_flow_schedule: flows
  };

  await auditLog({
    user_id: "anonymous",
    tool: "calculate_note_irr",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function get_amort_schedule(input: {
  deal_id: string;
  ip_address?: string;
}): Promise<{
  deal_id: string;
  schedule: Array<{
    month: number;
    opening_balance: number;
    interest: number;
    principal: number;
    total_payment: number;
    closing_balance: number;
  }>;
}> {
  const deal = await findDealById(input.deal_id);
  if (!deal) {
    throw new Error(`Deal not found: ${input.deal_id}`);
  }

  const schedule = buildSchedule({
    principal: Number(deal.principal),
    rate: Number(deal.rate),
    io_months: Number(deal.io_months),
    amort_months: Number(deal.amort_months),
    orig_fee: Number(deal.orig_fee),
    eot_fee: Number(deal.eot_fee),
    warrant_fmv: Number(deal.warrant_fmv)
  });

  const payload = {
    deal_id: input.deal_id,
    schedule
  };

  await auditLog({
    user_id: "anonymous",
    tool: "get_amort_schedule",
    params: input,
    response_summary: summarize({ deal_id: input.deal_id, rows: schedule.length }),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function run_restructure_scenario(input: {
  deal_id: string;
  scenario_type: "maturity_extension" | "rate_stepup" | "covenant_waiver";
  params: Record<string, number>;
  ip_address?: string;
}): Promise<{
  updated_irr: number;
  cash_flow_delta: number;
  recommendation_memo: string;
  revised_schedule: Array<{ month: number; opening_balance: number; interest: number; principal: number; total_payment: number; closing_balance: number }>;
}> {
  const deal = await findDealById(input.deal_id);
  if (!deal) {
    throw new Error(`Deal not found: ${input.deal_id}`);
  }

  const base = {
    principal: Number(deal.principal),
    rate: Number(deal.rate),
    io_months: Number(deal.io_months),
    amort_months: Number(deal.amort_months),
    orig_fee: Number(deal.orig_fee),
    eot_fee: Number(deal.eot_fee),
    warrant_fmv: Number(deal.warrant_fmv)
  };

  const adjusted = { ...base };
  if (input.scenario_type === "maturity_extension") {
    adjusted.amort_months += Math.max(1, Math.floor(input.params.extraMonths ?? 6));
  } else if (input.scenario_type === "rate_stepup") {
    adjusted.rate += Number(input.params.rateStep ?? 0.01);
  } else if (input.scenario_type === "covenant_waiver") {
    adjusted.eot_fee += Number(input.params.feeReduction ?? 0);
  }

  const baseIrr = (1 + solveIrrBisection(buildCashFlows(base))) ** 12 - 1;
  const revisedSchedule = buildSchedule(adjusted);
  const updatedIrr = (1 + solveIrrBisection(buildCashFlows(adjusted))) ** 12 - 1;
  const payload = {
    updated_irr: updatedIrr,
    cash_flow_delta: updatedIrr - baseIrr,
    recommendation_memo: `Scenario ${input.scenario_type} changes annualized IRR by ${(updatedIrr - baseIrr).toFixed(4)}.`,
    revised_schedule: revisedSchedule
  };

  await auditLog({
    user_id: "anonymous",
    tool: "run_restructure_scenario",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function compare_before_after_irr(input: {
  deal_id: string;
  scenario_type: "maturity_extension" | "rate_stepup" | "covenant_waiver";
  params: Record<string, number>;
  ip_address?: string;
}): Promise<{
  before_irr: number;
  after_irr: number;
  delta_bps: number;
  breakdown_bps: Record<string, number>;
}> {
  const run = await run_restructure_scenario(input);
  const deal = await findDealById(input.deal_id);
  if (!deal) throw new Error(`Deal not found: ${input.deal_id}`);
  const base = {
    principal: Number(deal.principal),
    rate: Number(deal.rate),
    io_months: Number(deal.io_months),
    amort_months: Number(deal.amort_months),
    orig_fee: Number(deal.orig_fee),
    eot_fee: Number(deal.eot_fee),
    warrant_fmv: Number(deal.warrant_fmv)
  };
  const before = (1 + solveIrrBisection(buildCashFlows(base))) ** 12 - 1;
  const after = run.updated_irr;
  const payload = {
    before_irr: before,
    after_irr: after,
    delta_bps: Number(((after - before) * 10000).toFixed(2)),
    breakdown_bps: {
      rate_effect: Number((((input.params.rateStep ?? 0) * 10000)).toFixed(2)),
      tenor_effect: Number((((input.params.extraMonths ?? 0) * 2)).toFixed(2)),
      fee_effect: Number((((input.params.feeReduction ?? 0) / Math.max(1, base.principal)) * 10000).toFixed(2))
    }
  };

  await auditLog({
    user_id: "anonymous",
    tool: "compare_before_after_irr",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function compare_all_scenarios(input: {
  deal_id: string;
  ip_address?: string;
}): Promise<Array<{ scenario_type: string; updated_irr: number; delta_bps: number }>> {
  const scenarios: Array<{ scenario_type: "maturity_extension" | "rate_stepup" | "covenant_waiver"; params: Record<string, number> }> = [
    { scenario_type: "maturity_extension", params: { extraMonths: 3 } },
    { scenario_type: "maturity_extension", params: { extraMonths: 6 } },
    { scenario_type: "rate_stepup", params: { rateStep: 0.01 } },
    { scenario_type: "rate_stepup", params: { rateStep: 0.02 } },
    { scenario_type: "covenant_waiver", params: { feeReduction: -25000 } },
    { scenario_type: "covenant_waiver", params: { feeReduction: -50000 } }
  ];

  const rows = [];
  for (const scenario of scenarios) {
    const comp = await compare_before_after_irr({
      deal_id: input.deal_id,
      scenario_type: scenario.scenario_type,
      params: scenario.params,
      ip_address: input.ip_address
    });
    rows.push({
      scenario_type: `${scenario.scenario_type}:${JSON.stringify(scenario.params)}`,
      updated_irr: comp.after_irr,
      delta_bps: comp.delta_bps
    });
  }

  await auditLog({
    user_id: "anonymous",
    tool: "compare_all_scenarios",
    params: input,
    response_summary: summarize({ rows: rows.length }),
    ip_address: input.ip_address ?? "unknown"
  });

  return rows;
}

export async function get_outstanding_at_breach(input: {
  deal_id: string;
  breach_month: number;
  ip_address?: string;
}): Promise<{
  breach_month: number;
  outstanding_balance: number;
  accrued_interest: number;
}> {
  const deal = await findDealById(input.deal_id);
  if (!deal) throw new Error(`Deal not found: ${input.deal_id}`);
  const schedule = buildSchedule({
    principal: Number(deal.principal),
    rate: Number(deal.rate),
    io_months: Number(deal.io_months),
    amort_months: Number(deal.amort_months),
    orig_fee: Number(deal.orig_fee),
    eot_fee: Number(deal.eot_fee),
    warrant_fmv: Number(deal.warrant_fmv)
  });
  const month = Math.max(1, Math.min(schedule.length, Math.floor(input.breach_month)));
  const row = schedule[month - 1];
  const payload = {
    breach_month: month,
    outstanding_balance: row.closing_balance,
    accrued_interest: row.interest
  };

  await auditLog({
    user_id: "anonymous",
    tool: "get_outstanding_at_breach",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function calculate_dpo_breakeven(input: {
  deal_id: string;
  settlement_month: number;
  ip_address?: string;
}): Promise<{
  target_eir: number;
  breakeven_dpo_pct: number;
}> {
  const deal = await findDealById(input.deal_id);
  if (!deal) throw new Error(`Deal not found: ${input.deal_id}`);

  const base = {
    principal: Number(deal.principal),
    rate: Number(deal.rate),
    io_months: Number(deal.io_months),
    amort_months: Number(deal.amort_months),
    orig_fee: Number(deal.orig_fee),
    eot_fee: Number(deal.eot_fee),
    warrant_fmv: Number(deal.warrant_fmv)
  };
  const targetEir = (1 + solveIrrBisection(buildCashFlows(base))) ** 12 - 1;
  const month = Math.max(1, Math.floor(input.settlement_month));
  const schedule = buildSchedule(base);
  const atMonth = schedule[Math.min(month - 1, schedule.length - 1)];
  const outstanding = atMonth.closing_balance;

  let lo = 0;
  let hi = 1.2;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const flows = [-base.principal + base.orig_fee];
    for (let m = 1; m <= month; m += 1) flows.push(schedule[m - 1]?.total_payment ?? 0);
    flows.push(outstanding * mid);
    const eir = (1 + solveIrrBisection(flows)) ** 12 - 1;
    if (eir < targetEir) lo = mid;
    else hi = mid;
  }
  const payload = {
    target_eir: targetEir,
    breakeven_dpo_pct: Number((((lo + hi) / 2) * 100).toFixed(2))
  };

  await auditLog({
    user_id: "anonymous",
    tool: "calculate_dpo_breakeven",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

function blackScholesCall(spot: number, strike: number, volatility: number, years: number, riskFree: number): number {
  if (spot <= 0 || strike <= 0 || volatility <= 0 || years <= 0) return 0;
  const d1 =
    (Math.log(spot / strike) + (riskFree + (volatility * volatility) / 2) * years) /
    (volatility * Math.sqrt(years));
  const d2 = d1 - volatility * Math.sqrt(years);
  return spot * normalCdf(d1) - strike * Math.exp(-riskFree * years) * normalCdf(d2);
}

export async function generate_warrant_irr(input: {
  coverage: number;
  strike_val: number;
  fd_shares: number;
  scenarios: number[];
  probabilities: number[];
  ip_address?: string;
}): Promise<{
  black_scholes_fmv: number;
  scenario_payoffs: number[];
  expected_irr: number;
}> {
  const spot = input.fd_shares * input.coverage;
  const blackScholesFmv = blackScholesCall(spot, input.strike_val, 0.45, 3, 0.04);
  const scenarioPayoffs = input.scenarios.map((exitValue) =>
    Math.max(0, exitValue * input.coverage - input.strike_val)
  );
  const weightedPayoff = scenarioPayoffs.reduce(
    (acc, payoff, index) => acc + payoff * (input.probabilities[index] ?? 0),
    0
  );
  const expectedIrr = blackScholesFmv === 0 ? 0 : weightedPayoff / blackScholesFmv - 1;

  const payload = { black_scholes_fmv: blackScholesFmv, scenario_payoffs: scenarioPayoffs, expected_irr: expectedIrr };

  await auditLog({
    user_id: "anonymous",
    tool: "generate_warrant_irr",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function calculate_warrant_irr(input: {
  coverage: number;
  strike_val: number;
  fd_shares: number;
  scenarios: number[];
  probabilities: number[];
  ip_address?: string;
}): Promise<{
  black_scholes_fmv: number;
  scenarios: Array<{ exit_value: number; payoff: number; scenario_irr: number }>;
  expected_irr: number;
}> {
  const base = await generate_warrant_irr(input);
  const scenarioRows = input.scenarios.map((exitValue, idx) => {
    const payoff = Math.max(0, exitValue * input.coverage - input.strike_val);
    const irr = base.black_scholes_fmv === 0 ? 0 : payoff / base.black_scholes_fmv - 1;
    return {
      exit_value: exitValue,
      payoff: Number(payoff.toFixed(2)),
      scenario_irr: Number(irr.toFixed(6))
    };
  });
  const payload = {
    black_scholes_fmv: base.black_scholes_fmv,
    scenarios: scenarioRows,
    expected_irr: base.expected_irr
  };
  await auditLog({
    user_id: "anonymous",
    tool: "calculate_warrant_irr",
    params: input,
    response_summary: summarize({ rows: scenarioRows.length, expected_irr: payload.expected_irr }),
    ip_address: input.ip_address ?? "unknown"
  });
  return payload;
}

export async function calculate_conv_note_irr(input: {
  principal: number;
  term_months: number;
  coupon_rate: number;
  up_round_value: number;
  flat_round_value: number;
  down_round_value: number;
  p_up: number;
  p_flat: number;
  p_down: number;
  ip_address?: string;
}): Promise<{
  expected_irr: number;
  scenario_tree: Array<{ scenario: string; probability: number; payoff: number; irr: number }>;
}> {
  const probs = [input.p_up, input.p_flat, input.p_down];
  const sumProb = probs.reduce((a, b) => a + b, 0);
  if (Math.abs(sumProb - 1) > 1e-6) {
    throw new Error("Probabilities must sum to 1");
  }
  const principal = input.principal;
  const coupon = principal * input.coupon_rate * (input.term_months / 12);
  const scenarios = [
    { scenario: "up_round", probability: input.p_up, payoff: input.up_round_value + coupon },
    { scenario: "flat_round", probability: input.p_flat, payoff: input.flat_round_value + coupon },
    { scenario: "down_round", probability: input.p_down, payoff: input.down_round_value + coupon }
  ];
  const rows = scenarios.map((s) => {
    const flows = [-principal, s.payoff];
    const irr = solveIrrBisection(flows);
    return {
      scenario: s.scenario,
      probability: s.probability,
      payoff: s.payoff,
      irr
    };
  });
  const expectedIrr = rows.reduce((acc, r) => acc + r.irr * r.probability, 0);
  const payload = {
    expected_irr: expectedIrr,
    scenario_tree: rows
  };

  await auditLog({
    user_id: "anonymous",
    tool: "calculate_conv_note_irr",
    params: input,
    response_summary: summarize(payload),
    ip_address: input.ip_address ?? "unknown"
  });
  return payload;
}
