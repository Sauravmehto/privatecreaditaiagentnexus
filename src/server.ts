import "dotenv/config";
import * as http from "node:http";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger } from "./audit/logger";
import {
  get_covenant_alerts,
  get_deal_metrics,
  get_portfolio_summary,
  search_precedent_deals
} from "./tools/portfolio";
import { calculate_irr, generate_warrant_irr, run_restructure_scenario } from "./tools/irr";
import { create_irr_model, generate_restructure_memo, generate_term_sheet } from "./tools/documents";

// ── Input schemas (no token required) ─────────────────────────────────────────
const inputSchemas = {
  get_portfolio_summary: z.object({ ip_address: z.string().optional() }),
  get_deal_metrics: z.object({ deal_id: z.string(), ip_address: z.string().optional() }),
  get_covenant_alerts: z.object({ ip_address: z.string().optional() }),
  search_precedent_deals: z.object({
    sector: z.string().optional(),
    deal_size_min: z.number().optional(),
    deal_size_max: z.number().optional(),
    ip_address: z.string().optional()
  }),
  calculate_irr: z.object({
    principal: z.number(),
    rate: z.number(),
    io_months: z.number(),
    amort_months: z.number(),
    orig_fee: z.number(),
    eot_fee: z.number(),
    warrant_fmv: z.number(),
    ip_address: z.string().optional()
  }),
  run_restructure_scenario: z.object({
    deal_id: z.string(),
    scenario_type: z.enum(["maturity_extension", "rate_stepup", "covenant_waiver"]),
    params: z.record(z.string(), z.number()),
    ip_address: z.string().optional()
  }),
  generate_warrant_irr: z.object({
    coverage: z.number(),
    strike_val: z.number(),
    fd_shares: z.number(),
    scenarios: z.array(z.number()),
    probabilities: z.array(z.number()),
    ip_address: z.string().optional()
  }),
  generate_term_sheet: z.object({
    company_name: z.string(),
    principal: z.number(),
    rate: z.number(),
    io_months: z.number(),
    amort_months: z.number(),
    orig_fee: z.number(),
    eot_fee: z.number(),
    warrant_coverage: z.number(),
    ip_address: z.string().optional()
  }),
  create_irr_model: z.object({
    instrument_type: z.enum(["term_loan", "revolver", "convertible"]),
    params: z.record(z.string(), z.unknown()),
    ip_address: z.string().optional()
  }),
  generate_restructure_memo: z.object({
    deal_id: z.string(),
    ip_address: z.string().optional()
  })
};

const toolHandlers = {
  get_portfolio_summary, get_deal_metrics, get_covenant_alerts, search_precedent_deals,
  calculate_irr, run_restructure_scenario, generate_warrant_irr,
  generate_term_sheet, create_irr_model, generate_restructure_memo
};

const toolDefinitions = [
  { name: "get_portfolio_summary",     description: "Returns aggregate portfolio metrics: deal count, total AUM, avg EIR, weighted avg tenor" },
  { name: "get_deal_metrics",          description: "Returns deal metrics for a given deal_id: IRR, MOIC, covenant status, days to maturity" },
  { name: "get_covenant_alerts",       description: "Returns deals at covenant breach risk, severity-ranked" },
  { name: "search_precedent_deals",    description: "Returns statistical ranges for precedent deals by sector and size" },
  { name: "calculate_irr",             description: "Calculates EIR and cash flow sensitivity table from deal parameters" },
  { name: "run_restructure_scenario",  description: "Runs a restructure scenario on a deal and returns updated IRR" },
  { name: "generate_warrant_irr",      description: "Computes Black-Scholes warrant valuation and expected IRR" },
  { name: "generate_term_sheet",       description: "Generates a formatted term sheet from a local template" },
  { name: "create_irr_model",          description: "Builds a structured JSON Excel-model specification" },
  { name: "generate_restructure_memo", description: "Generates a full credit committee restructure memo with all scenarios" }
];

// ── Build a fresh MCP Server instance ─────────────────────────────────────────
function buildMcpServer(): Server {
  const server = new Server(
    { name: "private-credit-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((tool) => ({
      ...tool,
      inputSchema: z.toJSONSchema(inputSchemas[tool.name as keyof typeof inputSchemas])
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;
      const schema = inputSchemas[name as keyof typeof inputSchemas];
      const handler = toolHandlers[name as keyof typeof toolHandlers];
      if (!schema || !handler) {
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }
      const validatedArgs = schema.parse(args ?? {});
      const response = await handler(validatedArgs as never);
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Internal server error";
      logger.error("mcp_tool_execution_error", { error: msg });
      return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
    }
  });

  return server;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const app = express();

  app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "mcp-session-id", "Accept"] }));
  app.use(express.json());

  // ── Health check ────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "private-credit-mcp", timestamp: new Date().toISOString() });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PROTOCOL 1: SSE  (GET /sse  +  POST /messages)
  // ══════════════════════════════════════════════════════════════════════════
  const sseTransports: Record<string, SSEServerTransport> = {};

  app.get("/sse", async (req: Request, res: Response) => {
    logger.info("sse_connection_request", { ip: req.ip });
    const transport = new SSEServerTransport("/messages", res);
    sseTransports[transport.sessionId] = transport;
    res.on("close", () => {
      delete sseTransports[transport.sessionId];
    });
    const server = buildMcpServer();
    await server.connect(transport);
  });

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query["sessionId"] as string | undefined;
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
  const httpSessions = new Map<string, StreamableHTTPServerTransport>();

  const mcpHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      let transport: StreamableHTTPServerTransport;
      if (sessionId && httpSessions.has(sessionId)) {
        transport = httpSessions.get(sessionId)!;
      } else {
        const newId = randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newId,
          onsessioninitialized: (id) => { httpSessions.set(id, transport); }
        });
        transport.onclose = () => { httpSessions.delete(newId); };
        await buildMcpServer().connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("mcp_http_error", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  };

  app.post("/mcp", mcpHandler);
  app.get("/mcp", mcpHandler);
  app.delete("/mcp", mcpHandler);

  http.createServer(app).listen(port, () => {
    logger.info("mcp_server_started", { port });
    console.log(`Private Credit MCP running on port ${port}`);
    console.log(`  SSE  endpoint: /sse`);
    console.log(`  HTTP endpoint: /mcp`);
    console.log(`  Health check : /health`);
  });
}

start().catch((error: unknown) => {
  logger.error("mcp_server_fatal_error", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
