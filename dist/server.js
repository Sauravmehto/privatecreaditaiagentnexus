"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http = __importStar(require("node:http"));
const node_crypto_1 = require("node:crypto");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const logger_1 = require("./audit/logger");
const portfolio_1 = require("./tools/portfolio");
const irr_1 = require("./tools/irr");
const documents_1 = require("./tools/documents");
// ── Input schemas (no token required) ─────────────────────────────────────────
const inputSchemas = {
    get_portfolio_summary: zod_1.z.object({ ip_address: zod_1.z.string().optional() }),
    get_deal_metrics: zod_1.z.object({ deal_id: zod_1.z.string(), ip_address: zod_1.z.string().optional() }),
    get_deal_cash_flows: zod_1.z.object({ deal_id: zod_1.z.string(), months: zod_1.z.number().int().positive().optional(), ip_address: zod_1.z.string().optional() }),
    get_covenant_alerts: zod_1.z.object({ ip_address: zod_1.z.string().optional() }),
    search_precedent_deals: zod_1.z.object({
        sector: zod_1.z.string().optional(),
        deal_size_min: zod_1.z.number().optional(),
        deal_size_max: zod_1.z.number().optional(),
        ip_address: zod_1.z.string().optional()
    }),
    search_comparable_deals: zod_1.z.object({
        sector: zod_1.z.string().optional(),
        deal_size_min: zod_1.z.number().optional(),
        deal_size_max: zod_1.z.number().optional(),
        tolerance_pct: zod_1.z.number().optional(),
        ip_address: zod_1.z.string().optional()
    }),
    calculate_irr: zod_1.z.object({
        principal: zod_1.z.number(),
        rate: zod_1.z.number(),
        io_months: zod_1.z.number(),
        amort_months: zod_1.z.number(),
        orig_fee: zod_1.z.number(),
        eot_fee: zod_1.z.number(),
        warrant_fmv: zod_1.z.number(),
        ip_address: zod_1.z.string().optional()
    }),
    get_amort_schedule: zod_1.z.object({
        deal_id: zod_1.z.string(),
        ip_address: zod_1.z.string().optional()
    }),
    calculate_term_loan_irr: zod_1.z.object({
        principal: zod_1.z.number(),
        rate: zod_1.z.number(),
        io_months: zod_1.z.number().int().nonnegative(),
        amort_months: zod_1.z.number().int().positive(),
        orig_fee: zod_1.z.number(),
        eot_fee: zod_1.z.number(),
        warrant_fmv: zod_1.z.number(),
        ip_address: zod_1.z.string().optional()
    }),
    calculate_note_irr: zod_1.z.object({
        principal: zod_1.z.number(),
        annual_coupon_rate: zod_1.z.number(),
        term_months: zod_1.z.number().int().positive(),
        upfront_fee: zod_1.z.number(),
        exit_fee: zod_1.z.number(),
        ip_address: zod_1.z.string().optional()
    }),
    calculate_warrant_irr: zod_1.z.object({
        coverage: zod_1.z.number(),
        strike_val: zod_1.z.number(),
        fd_shares: zod_1.z.number(),
        scenarios: zod_1.z.array(zod_1.z.number()),
        probabilities: zod_1.z.array(zod_1.z.number()),
        ip_address: zod_1.z.string().optional()
    }),
    calculate_conv_note_irr: zod_1.z.object({
        principal: zod_1.z.number(),
        term_months: zod_1.z.number().int().positive(),
        coupon_rate: zod_1.z.number(),
        up_round_value: zod_1.z.number(),
        flat_round_value: zod_1.z.number(),
        down_round_value: zod_1.z.number(),
        p_up: zod_1.z.number(),
        p_flat: zod_1.z.number(),
        p_down: zod_1.z.number(),
        ip_address: zod_1.z.string().optional()
    }),
    run_restructure_scenario: zod_1.z.object({
        deal_id: zod_1.z.string(),
        scenario_type: zod_1.z.enum(["maturity_extension", "rate_stepup", "covenant_waiver"]),
        params: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
        ip_address: zod_1.z.string().optional()
    }),
    compare_before_after_irr: zod_1.z.object({
        deal_id: zod_1.z.string(),
        scenario_type: zod_1.z.enum(["maturity_extension", "rate_stepup", "covenant_waiver"]),
        params: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
        ip_address: zod_1.z.string().optional()
    }),
    compare_all_scenarios: zod_1.z.object({
        deal_id: zod_1.z.string(),
        ip_address: zod_1.z.string().optional()
    }),
    get_outstanding_at_breach: zod_1.z.object({
        deal_id: zod_1.z.string(),
        breach_month: zod_1.z.number().int().positive(),
        ip_address: zod_1.z.string().optional()
    }),
    calculate_dpo_breakeven: zod_1.z.object({
        deal_id: zod_1.z.string(),
        settlement_month: zod_1.z.number().int().positive(),
        ip_address: zod_1.z.string().optional()
    }),
    generate_warrant_irr: zod_1.z.object({
        coverage: zod_1.z.number(),
        strike_val: zod_1.z.number(),
        fd_shares: zod_1.z.number(),
        scenarios: zod_1.z.array(zod_1.z.number()),
        probabilities: zod_1.z.array(zod_1.z.number()),
        ip_address: zod_1.z.string().optional()
    }),
    generate_term_sheet: zod_1.z.object({
        company_name: zod_1.z.string(),
        principal: zod_1.z.number(),
        rate: zod_1.z.number(),
        io_months: zod_1.z.number(),
        amort_months: zod_1.z.number(),
        orig_fee: zod_1.z.number(),
        eot_fee: zod_1.z.number(),
        warrant_coverage: zod_1.z.number(),
        ip_address: zod_1.z.string().optional()
    }),
    create_irr_model: zod_1.z.object({
        instrument_type: zod_1.z.enum(["term_loan", "revolver", "convertible"]),
        params: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
        ip_address: zod_1.z.string().optional()
    }),
    generate_restructure_memo: zod_1.z.object({
        deal_id: zod_1.z.string(),
        ip_address: zod_1.z.string().optional()
    })
};
const toolHandlers = {
    get_portfolio_summary: portfolio_1.get_portfolio_summary, get_deal_metrics: portfolio_1.get_deal_metrics, get_deal_cash_flows: portfolio_1.get_deal_cash_flows, get_covenant_alerts: portfolio_1.get_covenant_alerts, search_precedent_deals: portfolio_1.search_precedent_deals, search_comparable_deals: portfolio_1.search_comparable_deals,
    calculate_irr: irr_1.calculate_irr, get_amort_schedule: irr_1.get_amort_schedule, calculate_term_loan_irr: irr_1.calculate_term_loan_irr, calculate_note_irr: irr_1.calculate_note_irr, calculate_warrant_irr: irr_1.calculate_warrant_irr, calculate_conv_note_irr: irr_1.calculate_conv_note_irr,
    run_restructure_scenario: irr_1.run_restructure_scenario, compare_before_after_irr: irr_1.compare_before_after_irr, compare_all_scenarios: irr_1.compare_all_scenarios, get_outstanding_at_breach: irr_1.get_outstanding_at_breach, calculate_dpo_breakeven: irr_1.calculate_dpo_breakeven, generate_warrant_irr: irr_1.generate_warrant_irr,
    generate_term_sheet: documents_1.generate_term_sheet, create_irr_model: documents_1.create_irr_model, generate_restructure_memo: documents_1.generate_restructure_memo
};
const toolDefinitions = [
    { name: "get_portfolio_summary", description: "Returns aggregate portfolio metrics: deal count, total AUM, avg EIR, weighted avg tenor" },
    { name: "get_deal_metrics", description: "Returns deal metrics for a given deal_id: IRR, MOIC, covenant status, days to maturity" },
    { name: "get_deal_cash_flows", description: "Returns projected vs actual monthly payment history for a deal" },
    { name: "get_covenant_alerts", description: "Returns deals at covenant breach risk, severity-ranked" },
    { name: "search_precedent_deals", description: "Returns statistical ranges for precedent deals by sector and size" },
    { name: "search_comparable_deals", description: "Returns anonymized statistical ranges for comparable historical deals" },
    { name: "calculate_irr", description: "Calculates EIR and cash flow sensitivity table from deal parameters" },
    { name: "get_amort_schedule", description: "Returns month-by-month principal and interest amortization schedule for a deal" },
    { name: "calculate_term_loan_irr", description: "Runs term loan IRR solver and returns schedule, MOIC and fee decomposition" },
    { name: "calculate_note_irr", description: "Calculates bullet/note structure IRR from coupon and maturity terms" },
    { name: "calculate_warrant_irr", description: "Runs Black-Scholes FMV and returns exit scenarios with payoff and IRR" },
    { name: "calculate_conv_note_irr", description: "Builds 3-scenario probability tree and returns expected IRR" },
    { name: "run_restructure_scenario", description: "Runs a restructure scenario on a deal and returns updated IRR" },
    { name: "compare_before_after_irr", description: "Compares base vs restructured IRR and returns basis-point breakdown" },
    { name: "compare_all_scenarios", description: "Runs all six restructure pathways and returns scenario comparison table" },
    { name: "get_outstanding_at_breach", description: "Computes outstanding balance and accrued interest at breach month" },
    { name: "calculate_dpo_breakeven", description: "Finds settlement percentage where lender IRR equals original EIR" },
    { name: "generate_warrant_irr", description: "Computes Black-Scholes warrant valuation and expected IRR" },
    { name: "generate_term_sheet", description: "Generates a formatted term sheet from a local template" },
    { name: "create_irr_model", description: "Builds a structured JSON Excel-model specification" },
    { name: "generate_restructure_memo", description: "Generates a full credit committee restructure memo with all scenarios" }
];
function normalizeArgs(toolName, rawArgs) {
    const args = (rawArgs ?? {});
    // Allow "calculate_irr" calls in nested model-style format:
    // { instrument_type, params: { principal, rate, ... } }
    if (toolName === "calculate_irr" && args.params && typeof args.params === "object") {
        const nested = args.params;
        return {
            ...nested,
            ip_address: typeof args.ip_address === "string" ? args.ip_address : undefined,
            warrant_fmv: typeof nested.warrant_fmv === "number" ? nested.warrant_fmv : 0
        };
    }
    return args;
}
// ── Build a fresh MCP Server instance ─────────────────────────────────────────
function buildMcpServer() {
    const server = new index_js_1.Server({ name: "private-credit-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
        tools: toolDefinitions.map((tool) => ({
            ...tool,
            inputSchema: zod_1.z.toJSONSchema(inputSchemas[tool.name])
        }))
    }));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
        try {
            const { name, arguments: args } = request.params;
            const schema = inputSchemas[name];
            const handler = toolHandlers[name];
            if (!schema || !handler) {
                return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
            }
            const normalizedArgs = normalizeArgs(name, args);
            const validatedArgs = schema.parse(normalizedArgs);
            const response = await handler(validatedArgs);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "Internal server error";
            logger_1.logger.error("mcp_tool_execution_error", { error: msg });
            return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
        }
    });
    return server;
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function start() {
    const port = Number(process.env.PORT ?? 3000);
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "mcp-session-id", "Accept"] }));
    app.use(express_1.default.json());
    // ── Health check ────────────────────────────────────────────────────────────
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "private-credit-mcp", timestamp: new Date().toISOString() });
    });
    // ══════════════════════════════════════════════════════════════════════════
    // PROTOCOL 1: SSE  (GET /sse  +  POST /messages)
    // ══════════════════════════════════════════════════════════════════════════
    const sseTransports = {};
    app.get("/sse", async (req, res) => {
        logger_1.logger.info("sse_connection_request", { ip: req.ip });
        const transport = new sse_js_1.SSEServerTransport("/messages", res);
        sseTransports[transport.sessionId] = transport;
        res.on("close", () => {
            delete sseTransports[transport.sessionId];
        });
        const server = buildMcpServer();
        await server.connect(transport);
    });
    app.post("/messages", async (req, res) => {
        const sessionId = req.query["sessionId"];
        const transport = sessionId ? sseTransports[sessionId] : undefined;
        if (!transport) {
            res.status(400).json({ error: `No active SSE session for sessionId: ${sessionId}` });
            return;
        }
        await transport.handlePostMessage(req, res);
    });
    // ══════════════════════════════════════════════════════════════════════════
    // PROTOCOL 2: Streamable HTTP  (POST/GET/DELETE /mcp)
    // ══════════════════════════════════════════════════════════════════════════
    const httpSessions = new Map();
    const mcpHandler = async (req, res) => {
        const sessionId = req.headers["mcp-session-id"];
        try {
            let transport;
            if (sessionId && httpSessions.has(sessionId)) {
                transport = httpSessions.get(sessionId);
            }
            else {
                const newId = (0, node_crypto_1.randomUUID)();
                transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
                    sessionIdGenerator: () => newId,
                    onsessioninitialized: (id) => { httpSessions.set(id, transport); }
                });
                transport.onclose = () => { httpSessions.delete(newId); };
                await buildMcpServer().connect(transport);
            }
            await transport.handleRequest(req, res, req.body);
        }
        catch (err) {
            logger_1.logger.error("mcp_http_error", { error: err instanceof Error ? err.message : String(err) });
            if (!res.headersSent)
                res.status(500).json({ error: "Internal server error" });
        }
    };
    app.post("/mcp", mcpHandler);
    app.get("/mcp", mcpHandler);
    app.delete("/mcp", mcpHandler);
    http.createServer(app).listen(port, () => {
        logger_1.logger.info("mcp_server_started", { port });
        console.log(`Private Credit MCP running on port ${port}`);
        console.log(`  SSE  endpoint: /sse`);
        console.log(`  HTTP endpoint: /mcp`);
        console.log(`  Health check : /health`);
    });
}
start().catch((error) => {
    logger_1.logger.error("mcp_server_fatal_error", {
        error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
});
