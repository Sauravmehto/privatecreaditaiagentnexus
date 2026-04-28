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
  const monthlyIrr = calculateIrrValue(cashFlows);
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

export async function run_restructure_scenario(input: {
  deal_id: string;
  scenario_type: "maturity_extension" | "rate_stepup" | "covenant_waiver";
  params: Record<string, number>;
  ip_address?: string;
}): Promise<{
  updated_irr: number;
  cash_flow_delta: number;
  recommendation_memo: string;
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

  const baseIrr = (1 + calculateIrrValue(buildCashFlows(base))) ** 12 - 1;
  const updatedIrr = (1 + calculateIrrValue(buildCashFlows(adjusted))) ** 12 - 1;
  const payload = {
    updated_irr: updatedIrr,
    cash_flow_delta: updatedIrr - baseIrr,
    recommendation_memo: `Scenario ${input.scenario_type} changes annualized IRR by ${(updatedIrr - baseIrr).toFixed(4)}.`
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
