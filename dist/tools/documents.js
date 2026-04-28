"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generate_term_sheet = generate_term_sheet;
exports.create_irr_model = create_irr_model;
exports.generate_restructure_memo = generate_restructure_memo;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("../audit/logger");
const db_1 = require("../data/db");
const irr_1 = require("./irr");
function summarize(payload) {
    return JSON.stringify(payload).slice(0, 400);
}
async function generate_term_sheet(input) {
    const templatePath = node_path_1.default.resolve(process.cwd(), "templates", "term_sheet.txt");
    const template = await (0, promises_1.readFile)(templatePath, "utf8");
    const output = template
        .replace("[REDACTED]", input.company_name)
        .replace("[AMOUNT]", input.principal.toFixed(2))
        .replace("[TENOR]", String(input.io_months + input.amort_months))
        .replace("[RATE]", input.rate.toFixed(4))
        .replace("[SECURITY PACKAGE]", "Senior secured with standard collateral package")
        .replace("[KEY COVENANTS]", "Leverage and liquidity maintenance tests");
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "generate_term_sheet",
        params: input,
        response_summary: summarize({ length: output.length }),
        ip_address: input.ip_address ?? "unknown"
    });
    return output;
}
async function create_irr_model(input) {
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
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "create_irr_model",
        params: { instrument_type: input.instrument_type },
        response_summary: summarize(layout),
        ip_address: input.ip_address ?? "unknown"
    });
    return layout;
}
async function generate_restructure_memo(input) {
    const deal = await (0, db_1.findDealById)(input.deal_id);
    if (!deal) {
        throw new Error(`Deal not found: ${input.deal_id}`);
    }
    const principal = Number(deal.principal);
    const rate = Number(deal.rate);
    const scenarios = [
        { title: "Maturity Extension +6m", bump: -0.003 },
        { title: "Maturity Extension +12m", bump: -0.006 },
        { title: "Rate Step-Up +100bps", bump: 0.01 },
        { title: "Rate Step-Up +200bps", bump: 0.02 },
        { title: "Covenant Waiver", bump: -0.002 },
        { title: "Partial Paydown + Fee", bump: 0.004 }
    ];
    const baseCashFlows = [-principal + Number(deal.orig_fee), ...Array(deal.io_months).fill((principal * rate) / 12)];
    baseCashFlows.push(principal + Number(deal.eot_fee) + Number(deal.warrant_fmv));
    const baseIrr = (1 + (0, irr_1.calculateIrrValue)(baseCashFlows)) ** 12 - 1;
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
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "generate_restructure_memo",
        params: { deal_id: input.deal_id },
        response_summary: summarize({ length: memo.length }),
        ip_address: input.ip_address ?? "unknown"
    });
    return memo;
}
