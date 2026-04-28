import { auditLog } from "../audit/logger";
import { aggregateDeals, findDealById, findDeals } from "../data/db";

interface DealRow {
  id: string;
  company_name: string;
  irr: number;
  moic: number;
  covenant_status: string;
  days_to_maturity: number;
  outstanding_balance: number;
  covenant_threshold: number;
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
}

function getSummaryText(payload: unknown): string {
  return JSON.stringify(payload).slice(0, 400);
}

export async function get_portfolio_summary(input: { ip_address?: string }): Promise<{
  deal_count: number;
  total_aum: number;
  avg_eir: number;
  weighted_avg_tenor: number;
}> {
  const result = await aggregateDeals<{
    deal_count: number;
    total_aum: number;
    avg_eir: number;
    weighted_avg_tenor: number;
  }>([
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

  await auditLog({
    user_id: "anonymous",
    tool: "get_portfolio_summary",
    params: input,
    response_summary: getSummaryText(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function get_deal_metrics(input: { deal_id: string; ip_address?: string }): Promise<{
  irr: number;
  moic: number;
  covenant_status: string;
  days_to_maturity: number;
  outstanding_balance: number;
  company_name: string;
}> {
  const deal = (await findDealById(input.deal_id)) as DealRow | null;
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

  await auditLog({
    user_id: "anonymous",
    tool: "get_deal_metrics",
    params: input,
    response_summary: getSummaryText(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function get_covenant_alerts(input: { ip_address?: string }): Promise<Array<{
  deal_id: string;
  severity_score: number;
  covenant_status: string;
  company_name: string;
}>> {
  const result = (await findDeals()) as DealRow[];

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

  await auditLog({
    user_id: "anonymous",
    tool: "get_covenant_alerts",
    params: input,
    response_summary: getSummaryText(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}

export async function search_precedent_deals(
  input: { sector?: string; deal_size_min?: number; deal_size_max?: number; ip_address?: string }
): Promise<{
  deal_count: number;
  min_eir: number;
  max_eir: number;
  avg_eir: number;
  min_tenor: number;
  max_tenor: number;
}> {
  const sizeMin = input.deal_size_min ?? 0;
  const sizeMax = input.deal_size_max ?? Number.MAX_SAFE_INTEGER;
  const matchStage: Record<string, unknown> = {
    principal: { $gte: sizeMin, $lte: sizeMax }
  };
  if (input.sector) {
    matchStage.sector = input.sector;
  }

  const result = await aggregateDeals<{
    deal_count: number;
    min_eir: number;
    max_eir: number;
    avg_eir: number;
    min_tenor: number;
    max_tenor: number;
  }>([
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

  await auditLog({
    user_id: "anonymous",
    tool: "search_precedent_deals",
    params: input,
    response_summary: getSummaryText(payload),
    ip_address: input.ip_address ?? "unknown"
  });

  return payload;
}
