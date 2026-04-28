"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.auditLog = auditLog;
exports.__setAuditSinkForTests = __setAuditSinkForTests;
const winston_1 = require("winston");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../data/db");
const logLevel = process.env.LOG_LEVEL ?? "info";
const logsDir = node_path_1.default.resolve(process.cwd(), "logs");
(0, node_fs_1.mkdirSync)(logsDir, { recursive: true });
exports.logger = (0, winston_1.createLogger)({
    level: logLevel,
    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json()),
    defaultMeta: { service: "private-credit-mcp" },
    transports: [
        new winston_1.transports.Console(),
        new winston_1.transports.File({ filename: node_path_1.default.join(logsDir, "audit.log") })
    ]
});
let auditSink = async (record) => {
    await (0, db_1.insertAuditLog)({
        user_id: record.user_id,
        tool: record.tool,
        params: JSON.stringify(record.params),
        response_summary: record.response_summary,
        timestamp: record.timestamp,
        ip_address: record.ip_address
    });
};
async function auditLog(entry) {
    const record = {
        ...entry,
        timestamp: entry.timestamp ?? new Date().toISOString()
    };
    exports.logger.info("tool_audit_log", {
        user_id: record.user_id,
        tool: record.tool,
        params: record.params,
        response_summary: record.response_summary,
        timestamp: record.timestamp,
        ip_address: record.ip_address
    });
    try {
        await auditSink(record);
    }
    catch (error) {
        exports.logger.error("audit_log_db_write_failed", {
            error: error instanceof Error ? error.message : String(error),
            tool: record.tool,
            user_id: record.user_id
        });
    }
}
function __setAuditSinkForTests(sink) {
    auditSink = sink;
}
