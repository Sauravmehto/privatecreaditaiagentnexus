"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_portfolio_summary = get_portfolio_summary;
exports.get_deal_metrics = get_deal_metrics;
exports.get_covenant_alerts = get_covenant_alerts;
exports.search_precedent_deals = search_precedent_deals;
exports.get_deal_cash_flows = get_deal_cash_flows;
exports.search_comparable_deals = search_comparable_deals;
const logger_1 = require("../audit/logger");
const db_1 = require("../data/db");
function getSummaryText(payload) {
    return JSON.stringify(payload).slice(0, 400);
}
async function get_portfolio_summary(input) {
    const result = await (0, db_1.aggregateDeals)([
        {
            $group: {
                _id: null,
                deal_count: { $sum: 1 },
                total_aum: { $sum: { $ifNull: ["$outstanding_balance", 0] } },
                avg_eir: { $avg: { $ifNull: ["$rate", 0] } },
                weighted_avg_tenor: { $avg: { $add: [{ $ifNull: ["$io_months", 0] }, { $ifNull: ["$amort_months", 0] }] } }
            }
        }
    ]);
    const row = result[0] ?? { deal_count: 0, total_aum: 0, avg_eir: 0, weighted_avg_tenor: 0 };
    const payload = {
        deal_count: Number(row.deal_count),
        total_aum: Number(row.total_aum),
        avg_eir: Number(row.avg_eir),
        weighted_avg_tenor: Number(row.weighted_avg_tenor)
    };
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "get_portfolio_summary",
        params: input,
        response_summary: getSummaryText(payload),
        ip_address: input.ip_address ?? "unknown"
    });
    return payload;
}
async function get_deal_metrics(input) {
    const deal = (await (0, db_1.findDealById)(input.deal_id));
    if (!deal) {
        throw new Error(`Deal not found: ${input.deal_id}`);
    }
    const payload = {
        irr: Number(deal.irr),
        moic: Number(deal.moic),
        covenant_status: deal.covenant_status,
        days_to_maturity: Number(deal.days_to_maturity),
        outstanding_balance: Number(deal.outstanding_balance),
        company_name: deal.company_name
    };
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "get_deal_metrics",
        params: input,
        response_summary: getSummaryText(payload),
        ip_address: input.ip_address ?? "unknown"
    });
    return payload;
}
async function get_covenant_alerts(input) {
    const result = (await (0, db_1.findDeals)());
    const payload = result
        .map((deal) => {
        const threshold = Number(deal.covenant_threshold) * Number(deal.principal);
        const severity = threshold > 0 ? Number(deal.outstanding_balance) / threshold : 0;
        return {
            deal_id: deal.id,
            severity_score: Number(severity.toFixed(4)),
            covenant_status: deal.covenant_status,
            company_name: deal.company_name
        };
    })
        .filter((deal) => deal.severity_score >= 0.8)
        .sort((a, b) => b.severity_score - a.severity_score);
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "get_covenant_alerts",
        params: input,
        response_summary: getSummaryText(payload),
        ip_address: input.ip_address ?? "unknown"
    });
    return payload;
}
async function search_precedent_deals(input) {
    const sizeMin = input.deal_size_min ?? 0;
    const sizeMax = input.deal_size_max ?? Number.MAX_SAFE_INTEGER;
    const matchStage = {
        principal: { $gte: sizeMin, $lte: sizeMax }
    };
    if (input.sector) {
        matchStage.sector = input.sector;
    }
    const result = await (0, db_1.aggregateDeals)([
        { $match: matchStage },
        {
            $group: {
                _id: null,
                deal_count: { $sum: 1 },
                min_eir: { $min: { $ifNull: ["$rate", 0] } },
                max_eir: { $max: { $ifNull: ["$rate", 0] } },
                avg_eir: { $avg: { $ifNull: ["$rate", 0] } },
                min_tenor: { $min: { $add: [{ $ifNull: ["$io_months", 0] }, { $ifNull: ["$amort_months", 0] }] } },
                max_tenor: { $max: { $add: [{ $ifNull: ["$io_months", 0] }, { $ifNull: ["$amort_months", 0] }] } }
            }
        }
    ]);
    const row = result[0] ?? { deal_count: 0, min_eir: 0, max_eir: 0, avg_eir: 0, min_tenor: 0, max_tenor: 0 };
    const payload = {
        deal_count: Number(row.deal_count),
        min_eir: Number(row.min_eir),
        max_eir: Number(row.max_eir),
        avg_eir: Number(row.avg_eir),
        min_tenor: Number(row.min_tenor),
        max_tenor: Number(row.max_tenor)
    };
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "search_precedent_deals",
        params: input,
        response_summary: getSummaryText(payload),
        ip_address: input.ip_address ?? "unknown"
    });
    return payload;
}
async function get_deal_cash_flows(input) {
    const deal = (await (0, db_1.findDealById)(input.deal_id));
    if (!deal) {
        throw new Error(`Deal not found: ${input.deal_id}`);
    }
    const horizon = Math.max(1, Math.min(120, Number(input.months ?? (deal.io_months + deal.amort_months))));
    const monthlyRate = Number(deal.rate) / 12;
    const principal = Number(deal.principal);
    const outstanding = Number(deal.outstanding_balance);
    const amortMonths = Math.max(1, Number(deal.amort_months));
    const principalStep = outstanding / amortMonths;
    const monthly_cash_flows = Array.from({ length: horizon }, (_, i) => {
        const month = i + 1;
        const isIoPeriod = month <= Number(deal.io_months);
        const principalPayment = isIoPeriod ? 0 : Math.max(0, principalStep);
        const base = isIoPeriod ? principal * monthlyRate : (outstanding - principalStep * Math.max(0, month - Number(deal.io_months) - 1)) * monthlyRate;
        const projected = Math.max(0, base + principalPayment);
        // synthetic actuals for structured output testing
        const actual = Number((projected * (1 + ((month % 4) - 1.5) * 0.01)).toFixed(2));
        const variance = Number((actual - projected).toFixed(2));
        return {
            month,
            projected_payment: Number(projected.toFixed(2)),
            actual_payment: actual,
            variance
        };
    });
    const payload = {
        deal_id: deal.id,
        company_name: deal.company_name,
        monthly_cash_flows
    };
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "get_deal_cash_flows",
        params: input,
        response_summary: getSummaryText({ rows: monthly_cash_flows.length, deal_id: deal.id }),
        ip_address: input.ip_address ?? "unknown"
    });
    return payload;
}
async function search_comparable_deals(input) {
    const min = input.deal_size_min ?? 0;
    const max = input.deal_size_max ?? Number.MAX_SAFE_INTEGER;
    const tolerance = Math.max(0, Number(input.tolerance_pct ?? 0));
    const lower = min * (1 - tolerance);
    const upper = max * (1 + tolerance);
    const matchStage = {
        principal: { $gte: lower, $lte: upper }
    };
    if (input.sector) {
        matchStage.sector = input.sector;
    }
    const result = await (0, db_1.aggregateDeals)([
        { $match: matchStage },
        {
            $group: {
                _id: null,
                comparable_count: { $sum: 1 },
                principal_min: { $min: { $ifNull: ["$principal", 0] } },
                principal_max: { $max: { $ifNull: ["$principal", 0] } },
                principal_avg: { $avg: { $ifNull: ["$principal", 0] } },
                rate_min: { $min: { $ifNull: ["$rate", 0] } },
                rate_max: { $max: { $ifNull: ["$rate", 0] } },
                rate_avg: { $avg: { $ifNull: ["$rate", 0] } },
                tenor_min: { $min: { $add: [{ $ifNull: ["$io_months", 0] }, { $ifNull: ["$amort_months", 0] }] } },
                tenor_max: { $max: { $add: [{ $ifNull: ["$io_months", 0] }, { $ifNull: ["$amort_months", 0] }] } },
                tenor_avg: { $avg: { $add: [{ $ifNull: ["$io_months", 0] }, { $ifNull: ["$amort_months", 0] }] } },
                irr_min: { $min: { $ifNull: ["$irr", 0] } },
                irr_max: { $max: { $ifNull: ["$irr", 0] } },
                irr_avg: { $avg: { $ifNull: ["$irr", 0] } }
            }
        }
    ]);
    const row = result[0] ?? {
        comparable_count: 0,
        principal_min: 0,
        principal_max: 0,
        principal_avg: 0,
        rate_min: 0,
        rate_max: 0,
        rate_avg: 0,
        tenor_min: 0,
        tenor_max: 0,
        tenor_avg: 0,
        irr_min: 0,
        irr_max: 0,
        irr_avg: 0
    };
    const payload = {
        comparable_count: Number(row.comparable_count),
        principal_range: {
            min: Number(row.principal_min),
            max: Number(row.principal_max),
            avg: Number(row.principal_avg)
        },
        rate_range: {
            min: Number(row.rate_min),
            max: Number(row.rate_max),
            avg: Number(row.rate_avg)
        },
        tenor_range: {
            min: Number(row.tenor_min),
            max: Number(row.tenor_max),
            avg: Number(row.tenor_avg)
        },
        irr_range: {
            min: Number(row.irr_min),
            max: Number(row.irr_max),
            avg: Number(row.irr_avg)
        }
    };
    await (0, logger_1.auditLog)({
        user_id: "anonymous",
        tool: "search_comparable_deals",
        params: input,
        response_summary: getSummaryText(payload),
        ip_address: input.ip_address ?? "unknown"
    });
    return payload;
}
