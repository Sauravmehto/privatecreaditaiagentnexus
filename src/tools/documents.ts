import { readFile as readLocalFile } from "node:fs/promises";
import path from "node:path";
import { auditLog } from "../audit/logger";
import { findDealById } from "../data/db";
import { calculateIrrValue } from "./irr";

function summarize(payload: unknown): string {
  return JSON.stringify(payload).slice(0, 400);
}

export async function generate_term_sheet(input: {
  company_name: string;
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
  orig_fee: number;
  eot_fee: number;
  warrant_coverage: number;
  ip_address?: string;
}): Promise<string> {
  const templatePath = path.resolve(process.cwd(), "templates", "term_sheet.txt");
  const template = await readLocalFile(templatePath, "utf8");
  const output = template
    .replace("[REDACTED]", input.company_name)
    .replace("[AMOUNT]", input.principal.toFixed(2))
    .replace("[TENOR]", String(input.io_months + input.amort_months))
    .replace("[RATE]", input.rate.toFixed(4))
    .replace("[SECURITY PACKAGE]", "Senior secured with standard collateral package")
    .replace("[KEY COVENANTS]", "Leverage and liquidity maintenance tests");

  await auditLog({
    user_id: "anonymous",
    tool: "generate_term_sheet",
    params: input,
    response_summary: summarize({ length: output.length }),
    ip_address: input.ip_address ?? "unknown"
  });

  return output;
}

export async function create_irr_model(input: {
  instrument_type: "term_loan" | "revolver" | "convertible";
  params: Record<string, unknown>;
  ip_address?: string;
}): Promise<Record<string, unknown>> {
  const layout = {
    sheets: [
      {
        name: "Inputs",
        columns: ["Parameter", "Value"],
        rows: Object.entries(input.params).map(([k, v]) => ({ parameter: k, value: v }))
      },
      {
        name: "CashFlows",
        columns: ["Period", "OpeningBalance", "Interest", "Principal", "TotalCashFlow"]
      },
      {
        name: "Outputs",
        columns: ["Metric", "Value"],
        formulas: ["IRR=IRR(CashFlows!E:E)", "MOIC=SUM(CashFlows!E:E)/ABS(CashFlows!E2)"]
      }
    ],
    instrument_type: input.instrument_type
  };

  await auditLog({
    user_id: "anonymous",
    tool: "create_irr_model",
    params: { instrument_type: input.instrument_type },
    response_summary: summarize(layout),
    ip_address: input.ip_address ?? "unknown"
  });

  return layout;
}

export async function generate_restructure_memo(input: {
  deal_id: string;
  ip_address?: string;
}): Promise<string> {
  const deal = await findDealById(input.deal_id);
  if (!deal) {
    throw new Error(`Deal not found: ${input.deal_id}`);
  }

  const principal = Number(deal.principal);
  const rate = Number(deal.rate);
  const scenarios = [
    { title: "Maturity Extension +6m",  bump: -0.003 },
    { title: "Maturity Extension +12m", bump: -0.006 },
    { title: "Rate Step-Up +100bps",    bump:  0.01  },
    { title: "Rate Step-Up +200bps",    bump:  0.02  },
    { title: "Covenant Waiver",         bump: -0.002 },
    { title: "Partial Paydown + Fee",   bump:  0.004 }
  ];

  const baseCashFlows = [-principal + Number(deal.orig_fee), ...Array(deal.io_months).fill((principal * rate) / 12)];
  baseCashFlows.push(principal + Number(deal.eot_fee) + Number(deal.warrant_fmv));
  const baseIrr = (1 + calculateIrrValue(baseCashFlows)) ** 12 - 1;

  const scenarioText = scenarios
    .map((scenario) => `${scenario.title}: projected IRR ${(baseIrr + scenario.bump).toFixed(4)}`)
    .join("\n");

  const memo = [
    "Credit Committee Restructure Memo",
    `Deal: ${input.deal_id}`,
    `Borrower: ${deal.company_name}`,
    `Current IRR: ${baseIrr.toFixed(4)}`,
    "",
    "Scenario Review:",
    scenarioText,
    "",
    "Recommendation:",
    "Proceed with structure balancing extension and rate support while maintaining covenant monitoring."
  ].join("\n");

  await auditLog({
    user_id: "anonymous",
    tool: "generate_restructure_memo",
    params: { deal_id: input.deal_id },
    response_summary: summarize({ length: memo.length }),
    ip_address: input.ip_address ?? "unknown"
  });

  return memo;
}
