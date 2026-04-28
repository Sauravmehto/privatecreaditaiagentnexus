import { createLogger, format, transports } from "winston";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { insertAuditLog } from "../data/db";

const logLevel = process.env.LOG_LEVEL ?? "info";
const logsDir = path.resolve(process.cwd(), "logs");
mkdirSync(logsDir, { recursive: true });

export const logger = createLogger({
  level: logLevel,
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "private-credit-mcp" },
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(logsDir, "audit.log") })
  ]
});

export interface AuditLogEntry {
  user_id: string;
  tool: string;
  params: unknown;
  response_summary: string;
  timestamp?: string;
  ip_address: string;
}

type AuditSink = (entry: AuditLogEntry & { timestamp: string }) => Promise<void>;

let auditSink: AuditSink = async (record) => {
  await insertAuditLog({
    user_id: record.user_id,
    tool: record.tool,
    params: JSON.stringify(record.params),
    response_summary: record.response_summary,
    timestamp: record.timestamp,
    ip_address: record.ip_address
  });
};

export async function auditLog(entry: AuditLogEntry): Promise<void> {
  const record = {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString()
  };

  logger.info("tool_audit_log", {
    user_id: record.user_id,
    tool: record.tool,
    params: record.params,
    response_summary: record.response_summary,
    timestamp: record.timestamp,
    ip_address: record.ip_address
  });

  try {
    await auditSink(record);
  } catch (error) {
    logger.error("audit_log_db_write_failed", {
      error: error instanceof Error ? error.message : String(error),
      tool: record.tool,
      user_id: record.user_id
    });
  }
}

export function __setAuditSinkForTests(sink: AuditSink): void {
  auditSink = sink;
}
