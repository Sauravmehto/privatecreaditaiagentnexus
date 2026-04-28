import "dotenv/config";
import assert from "node:assert/strict";
import { closeConnection } from "../../src/data/db";
import {
  get_portfolio_summary,
  get_deal_metrics,
  get_covenant_alerts,
  search_precedent_deals,
  get_deal_cash_flows,
  search_comparable_deals
} from "../../src/tools/portfolio";
import {
  calculate_irr,
  calculate_term_loan_irr,
  calculate_note_irr,
  generate_warrant_irr,
  calculate_warrant_irr,
  calculate_conv_note_irr,
  get_amort_schedule,
  run_restructure_scenario,
  compare_before_after_irr,
  compare_all_scenarios,
  get_outstanding_at_breach,
  calculate_dpo_breakeven
} from "../../src/tools/irr";
import { generate_term_sheet, create_irr_model, generate_restructure_memo } from "../../src/tools/documents";

async function run(): Promise<void> {
  const dealId = "VD-2023-0101";
  const ranTools = new Set<string>();

  const summary = await get_portfolio_summary({});
  ranTools.add("get_portfolio_summary");
  assert.ok(summary.deal_count >= 1);

  const metrics = await get_deal_metrics({ deal_id: dealId });
  ranTools.add("get_deal_metrics");
  assert.equal(typeof metrics.company_name, "string");

  const alerts = await get_covenant_alerts({});
  ranTools.add("get_covenant_alerts");
  assert.ok(Array.isArray(alerts));

  const precedents = await search_precedent_deals({ sector: "Fintech", deal_size_min: 1_000_000, deal_size_max: 15_000_000 });
  ranTools.add("search_precedent_deals");
  assert.ok(precedents.deal_count >= 0);

  const cashFlows = await get_deal_cash_flows({ deal_id: dealId, months: 12 });
  ranTools.add("get_deal_cash_flows");
  assert.equal(cashFlows.monthly_cash_flows.length, 12);

  const comparable = await search_comparable_deals({ sector: "Fintech", deal_size_min: 1_000_000, deal_size_max: 15_000_000 });
  ranTools.add("search_comparable_deals");
  assert.ok(comparable.comparable_count >= 0);

  const irr = await calculate_irr({
    principal: 5_000_000,
    rate: 0.14,
    io_months: 6,
    amort_months: 36,
    orig_fee: 50_000,
    eot_fee: 25_000,
    warrant_fmv: 100_000
  });
  ranTools.add("calculate_irr");
  assert.ok(Number.isFinite(irr.eir));

  const termLoan = await calculate_term_loan_irr({
    principal: 5_000_000,
    rate: 0.14,
    io_months: 6,
    amort_months: 36,
    orig_fee: 50_000,
    eot_fee: 25_000,
    warrant_fmv: 100_000
  });
  ranTools.add("calculate_term_loan_irr");
  assert.ok(termLoan.schedule.length === 42);

  const amort = await get_amort_schedule({ deal_id: dealId });
  ranTools.add("get_amort_schedule");
  assert.ok(amort.schedule.length > 0);

  const note = await calculate_note_irr({
    principal: 2_000_000,
    annual_coupon_rate: 0.12,
    term_months: 24,
    upfront_fee: 20_000,
    exit_fee: 15_000
  });
  ranTools.add("calculate_note_irr");
  assert.ok(Number.isFinite(note.eir));

  const genWarrant = await generate_warrant_irr({
    coverage: 0.12,
    strike_val: 6_500_000,
    fd_shares: 88_000_000,
    scenarios: [50_000_000, 90_000_000, 150_000_000],
    probabilities: [0.25, 0.5, 0.25]
  });
  ranTools.add("generate_warrant_irr");
  assert.ok(Number.isFinite(genWarrant.expected_irr));

  const calcWarrant = await calculate_warrant_irr({
    coverage: 0.12,
    strike_val: 6_500_000,
    fd_shares: 88_000_000,
    scenarios: [50_000_000, 90_000_000, 150_000_000],
    probabilities: [0.25, 0.5, 0.25]
  });
  ranTools.add("calculate_warrant_irr");
  assert.equal(calcWarrant.scenarios.length, 3);

  const conv = await calculate_conv_note_irr({
    principal: 2_000_000,
    term_months: 24,
    coupon_rate: 0.1,
    up_round_value: 3_000_000,
    flat_round_value: 2_300_000,
    down_round_value: 1_700_000,
    p_up: 0.3,
    p_flat: 0.4,
    p_down: 0.3
  });
  ranTools.add("calculate_conv_note_irr");
  assert.ok(Number.isFinite(conv.expected_irr));

  const restructure = await run_restructure_scenario({
    deal_id: dealId,
    scenario_type: "rate_stepup",
    params: { rateStep: 0.02 }
  });
  ranTools.add("run_restructure_scenario");
  assert.ok(restructure.revised_schedule.length > 0);

  const beforeAfter = await compare_before_after_irr({
    deal_id: dealId,
    scenario_type: "maturity_extension",
    params: { extraMonths: 6 }
  });
  ranTools.add("compare_before_after_irr");
  assert.ok(Number.isFinite(beforeAfter.delta_bps));

  const all = await compare_all_scenarios({ deal_id: dealId });
  ranTools.add("compare_all_scenarios");
  assert.equal(all.length, 6);

  const outstanding = await get_outstanding_at_breach({ deal_id: dealId, breach_month: 6 });
  ranTools.add("get_outstanding_at_breach");
  assert.ok(outstanding.outstanding_balance >= 0);

  const dpo = await calculate_dpo_breakeven({ deal_id: dealId, settlement_month: 12 });
  ranTools.add("calculate_dpo_breakeven");
  assert.ok(dpo.breakeven_dpo_pct >= 0);

  const termSheet = await generate_term_sheet({
    company_name: "Axon Therapeutics",
    principal: 3_000_000,
    rate: 0.1215,
    io_months: 12,
    amort_months: 18,
    orig_fee: 24_900,
    eot_fee: 96_300,
    warrant_coverage: 0
  });
  ranTools.add("generate_term_sheet");
  assert.ok(termSheet.length > 20);

  const model = await create_irr_model({
    instrument_type: "term_loan",
    params: { principal: 5_000_000, rate: 0.14, tenor: 42 }
  });
  ranTools.add("create_irr_model");
  assert.ok(Array.isArray((model as { sheets: unknown[] }).sheets));

  const memo = await generate_restructure_memo({ deal_id: dealId });
  ranTools.add("generate_restructure_memo");
  assert.ok(memo.includes("Credit Committee Restructure Memo"));

  const expectedTools = [
    "calculate_conv_note_irr",
    "calculate_dpo_breakeven",
    "calculate_irr",
    "calculate_note_irr",
    "calculate_term_loan_irr",
    "calculate_warrant_irr",
    "compare_all_scenarios",
    "compare_before_after_irr",
    "create_irr_model",
    "generate_restructure_memo",
    "generate_term_sheet",
    "generate_warrant_irr",
    "get_amort_schedule",
    "get_covenant_alerts",
    "get_deal_cash_flows",
    "get_deal_metrics",
    "get_outstanding_at_breach",
    "get_portfolio_summary",
    "run_restructure_scenario",
    "search_comparable_deals",
    "search_precedent_deals"
  ] as const;

  for (const toolName of expectedTools) {
    assert.ok(ranTools.has(toolName), `Missing tool execution: ${toolName}`);
  }

  console.log(`All tool smoke tests passed (${expectedTools.length} tools).`);
}

run()
  .catch((err) => {
    console.error("Tool smoke test failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });

