/// <reference types="node" />
import "dotenv/config";
import * as dns from "dns";
import * as path from "path";
import * as fs from "fs";
import { MongoClient } from "mongodb";

// Fix Node.js c-ares SRV resolution on Windows
dns.setServers(["8.8.8.8", "8.8.4.4"]);

interface SeedDeal {
  deal_id: string;
  company_name: string;
  sector: string;
  funding_stage: string;
  lead_vc: string;
  founder_name: string;
  instrument_type: string;
  close_date: string;
  maturity_date: string;
  days_to_maturity: number;
  principal_usd: number;
  outstanding_balance_usd: number;
  interest_rate: number;
  io_months: number;
  amortization_months: number;
  origination_fee: number;
  end_of_term_fee: number;
  warrant_coverage: number;
  warrant_strike_val_usd: number;
  fully_diluted_shares: number;
  irr: number;
  moic: number;
  arr_usd: number;
  last_valuation_usd: number;
  runway_months: number;
  covenant_threshold_ratio: number;
  covenant_actual_ratio: number;
  covenant_status: string;
  notes: string;
}

async function seed(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in .env");

  const seedPath = path.resolve(__dirname, "seed_deals.json");
  const raw = fs.readFileSync(seedPath, "utf8");
  const seedDeals: SeedDeal[] = JSON.parse(raw);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas");

    const db = client.db("private_credit");
    const deals = db.collection("deals");

    // Map seed fields → DB schema fields
    const mapped = seedDeals.map((d) => ({
      id: d.deal_id,
      company_name: d.company_name,
      sector: d.sector,
      funding_stage: d.funding_stage,
      lead_vc: d.lead_vc,
      founder_name: d.founder_name,
      instrument_type: d.instrument_type,
      close_date: d.close_date,
      maturity_date: d.maturity_date,
      days_to_maturity: d.days_to_maturity,
      principal: d.principal_usd,
      outstanding_balance: d.outstanding_balance_usd,
      rate: d.interest_rate,
      io_months: d.io_months,
      amort_months: d.amortization_months,
      // origination_fee and end_of_term_fee are ratios in seed — convert to dollar amounts
      orig_fee: Math.round(d.origination_fee * d.principal_usd),
      eot_fee: Math.round(d.end_of_term_fee * d.principal_usd),
      warrant_coverage: d.warrant_coverage,
      warrant_fmv: d.warrant_strike_val_usd,
      fully_diluted_shares: d.fully_diluted_shares,
      irr: d.irr,
      moic: d.moic,
      arr_usd: d.arr_usd,
      last_valuation_usd: d.last_valuation_usd,
      runway_months: d.runway_months,
      covenant_threshold: d.covenant_threshold_ratio,
      covenant_actual: d.covenant_actual_ratio,
      covenant_status: d.covenant_status,
      notes: d.notes
    }));

    // Upsert each deal by id
    let upserted = 0;
    for (const deal of mapped) {
      await deals.updateOne({ id: deal.id }, { $set: deal }, { upsert: true });
      upserted++;
      console.log(`  Upserted: ${deal.id} — ${deal.company_name}`);
    }

    console.log(`\nSeed complete. ${upserted} deals upserted into private_credit.deals`);

    // Verify
    const count = await deals.countDocuments();
    console.log(`Total deals in collection: ${count}`);
  } finally {
    await client.close();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
