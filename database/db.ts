import { MongoClient, Db, Collection, Document } from 'mongodb';

// ─── Connection ────────────────────────────────────────────────────────────────

const uri = process.env.MONGODB_URI!;
if (!uri) throw new Error('MONGODB_URI is not set in .env');

let client: MongoClient;
let db: Db;

export async function connectDB(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db('private_credit');
  console.log('✅ Connected to MongoDB: private_credit');
  return db;
}

export async function getDB(): Promise<Db> {
  if (!db) await connectDB();
  return db;
}

// ─── Typed Collections ─────────────────────────────────────────────────────────

export interface Deal {
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
  covenant_status: 'Compliant' | 'Watch' | 'Breach Risk';
  notes: string;
}

export interface AuditLog {
  user_id: string;
  tool: string;
  params: string;
  response_summary: string;
  timestamp: string;
  ip_address: string;
}

export async function dealsCollection(): Promise<Collection<Deal>> {
  const database = await getDB();
  return database.collection<Deal>('deals');
}

export async function auditLogsCollection(): Promise<Collection<AuditLog>> {
  const database = await getDB();
  return database.collection<AuditLog>('audit_logs');
}

// ─── Query Helper ──────────────────────────────────────────────────────────────

export async function query<T extends Document>(
  collectionName: string,
  filter: object = {},
  projection: object = {}
): Promise<T[]> {
  const database = await getDB();
  const col = database.collection<T>(collectionName);
  return col.find(filter, { projection }).toArray();
}

// ─── Graceful Shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed.');
  }
  process.exit(0);
});
