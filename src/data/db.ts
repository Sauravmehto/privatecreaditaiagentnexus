import * as dns from "dns";
import { MongoClient, type Document } from "mongodb";

// Node.js c-ares on Windows refuses SRV queries to local routers.
// Using Google's public DNS resolver fixes mongodb+srv:// connections.
dns.setServers(["8.8.8.8", "8.8.4.4"]);

export interface Deal {
  id: string;
  company_name: string;
  principal: number;
  rate: number;
  io_months: number;
  amort_months: number;
  orig_fee: number;
  eot_fee: number;
  warrant_fmv: number;
  covenant_threshold: number;
  days_to_maturity: number;
  irr: number;
  moic: number;
  outstanding_balance: number;
  covenant_status: string;
  sector?: string;
  founders?: string[];
}

export interface AuditLogRecord {
  user_id: string;
  tool: string;
  params: string;
  response_summary: string;
  timestamp: string;
  ip_address: string;
}

let client: MongoClient | null = null;
let dbName = "private_credit";

function getMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }
  return uri;
}

function resolveDbName(uri: string): string {
  try {
    const parsed = new URL(uri);
    const fromPath = parsed.pathname.replace("/", "").trim();
    return fromPath || "private_credit";
  } catch {
    return "private_credit";
  }
}

export async function connectDB(): Promise<MongoClient> {
  if (client) {
    return client;
  }

  const uri = getMongoUri();
  dbName = resolveDbName(uri);
  client = new MongoClient(uri);
  await client.connect();
  return client;
}

export async function getDB() {
  const activeClient = await connectDB();
  return activeClient.db(dbName);
}

type FindDealsExecutor = (filter?: Partial<Deal>) => Promise<Deal[]>;
type FindDealExecutor = (filter: Partial<Deal>) => Promise<Deal | null>;
type AggregateDealsExecutor = <T extends Document = Document>(pipeline: Document[]) => Promise<T[]>;
type InsertAuditExecutor = (entry: AuditLogRecord) => Promise<void>;

let findDealsExecutor: FindDealsExecutor = async (filter = {}) => {
  const db = await getDB();
  return db.collection<Deal>("deals").find(filter).toArray();
};

let findDealExecutor: FindDealExecutor = async (filter) => {
  const db = await getDB();
  return db.collection<Deal>("deals").findOne(filter);
};

let aggregateDealsExecutor: AggregateDealsExecutor = async <T extends Document = Document>(pipeline: Document[]) => {
  const db = await getDB();
  return db.collection<Deal>("deals").aggregate<T>(pipeline).toArray();
};

let insertAuditExecutor: InsertAuditExecutor = async (entry) => {
  const db = await getDB();
  await db.collection<AuditLogRecord>("audit_logs").insertOne(entry);
};

export async function findDeals(filter: Partial<Deal> = {}): Promise<Deal[]> {
  return findDealsExecutor(filter);
}

export async function findDealById(id: string): Promise<Deal | null> {
  return findDealExecutor({ id });
}

export async function aggregateDeals<T extends Document = Document>(pipeline: Document[]): Promise<T[]> {
  return aggregateDealsExecutor<T>(pipeline);
}

export async function insertAuditLog(entry: AuditLogRecord): Promise<void> {
  await insertAuditExecutor(entry);
}

export async function testConnection(): Promise<void> {
  const db = await getDB();
  await db.command({ ping: 1 });
}

export function __setMongoExecutorsForTests(executors: {
  findDeals?: FindDealsExecutor;
  findDeal?: FindDealExecutor;
  aggregateDeals?: AggregateDealsExecutor;
  insertAudit?: InsertAuditExecutor;
}): void {
  if (executors.findDeals) {
    findDealsExecutor = executors.findDeals;
  }
  if (executors.findDeal) {
    findDealExecutor = executors.findDeal;
  }
  if (executors.aggregateDeals) {
    aggregateDealsExecutor = executors.aggregateDeals;
  }
  if (executors.insertAudit) {
    insertAuditExecutor = executors.insertAudit;
  }
}

export async function closeConnection(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
