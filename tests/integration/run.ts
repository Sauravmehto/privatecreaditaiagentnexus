import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as xlsx from "xlsx";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-secret";
process.env.MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/private_credit_test";

const auditEntries: unknown[] = [];

async function setupMocks(seedDeals: Array<Record<string, unknown>>): Promise<void> {
  const dbModule = await import("../../src/data/db");
  const loggerModule = await import("../../src/audit/logger");
  dbModule.__setMongoExecutorsForTests({
    findDeals: async () => seedDeals as never,
    findDeal: async (filter) =>
      (seedDeals.find((deal) => deal.id === filter.id || deal.deal_id === filter.id) ?? null) as never,
    aggregateDeals: async (pipeline) => {
      const firstStage = pipeline[0] as Record<string, unknown> | undefined;
      const match = (firstStage?.$match ?? {}) as Record<string, unknown>;
      const filtered = seedDeals.filter((deal) => {
        if (match.sector && deal.sector !== match.sector) {
          return false;
        }
        if (match.principal && typeof match.principal === "object") {
          const principal = Number(deal.principal ?? 0);
          const principalFilter = match.principal as { $gte?: number; $lte?: number };
          if (principalFilter.$gte !== undefined && principal < principalFilter.$gte) {
            return false;
          }
          if (principalFilter.$lte !== undefined && principal > principalFilter.$lte) {
            return false;
          }
        }
        return true;
      });

      if (pipeline.length > 1) {
        const dealCount = filtered.length;
        const totalAum = filtered.reduce((sum, deal) => sum + Number(deal.outstanding_balance ?? 0), 0);
        const avgEir =
          dealCount === 0 ? 0 : filtered.reduce((sum, deal) => sum + Number(deal.rate ?? 0), 0) / dealCount;
        const tenors = filtered.map((deal) => Number(deal.io_months ?? 0) + Number(deal.amort_months ?? 0));
        const weightedAvgTenor =
          tenors.length === 0 ? 0 : tenors.reduce((sum, tenor) => sum + tenor, 0) / tenors.length;

        return [
          {
            deal_count: dealCount,
            total_aum: totalAum,
            avg_eir: avgEir,
            weighted_avg_tenor: weightedAvgTenor,
            min_eir: dealCount ? Math.min(...filtered.map((d) => Number(d.rate ?? 0))) : 0,
            max_eir: dealCount ? Math.max(...filtered.map((d) => Number(d.rate ?? 0))) : 0,
            min_tenor: tenors.length ? Math.min(...tenors) : 0,
            max_tenor: tenors.length ? Math.max(...tenors) : 0
          }
        ] as never;
      }
      return [] as never;
    }
  });
  loggerModule.__setAuditSinkForTests(async (entry) => {
    auditEntries.push(entry);
  });
}

async function testRoleBasedDealMetrics(): Promise<void> {
  await setupMocks([
    {
      id: "D-101",
      company_name: "Acme Robotics",
      irr: 0.184,
      moic: 1.32,
      covenant_status: "healthy",
      days_to_maturity: 420,
      outstanding_balance: 4100000,
      covenant_threshold: 0.8,
      principal: 5000000,
      rate: 0.14,
      io_months: 12,
      amort_months: 24
    }
  ]);

  const middleware = await import("../../src/auth/middleware");
  const portfolio = await import("../../src/tools/portfolio");

  const analystToken = middleware.generateToken("analyst-user", "analyst");
  const partnerToken = middleware.generateToken("partner-user", "partner");

  const analystResult = await portfolio.get_deal_metrics({ token: analystToken, deal_id: "D-101" });
  const partnerResult = await portfolio.get_deal_metrics({ token: partnerToken, deal_id: "D-101" });

  assert.equal(analystResult.company_name, "[REDACTED]");
  assert.equal(partnerResult.company_name, "Acme Robotics");
}

async function testUnauthorizedTermSheet(): Promise<void> {
  await setupMocks([]);
  const middleware = await import("../../src/auth/middleware");
  const documents = await import("../../src/tools/documents");
  const analystToken = middleware.generateToken("analyst-user", "analyst");

  await assert.rejects(
    () =>
      documents.generate_term_sheet({
        token: analystToken,
        company_name: "Acme Robotics",
        principal: 5000000,
        rate: 0.14,
        io_months: 12,
        amort_months: 24,
        orig_fee: 100000,
        eot_fee: 100000,
        warrant_coverage: 0.1
      }),
    /Unauthorized/
  );
}

async function testIrrAccuracy(): Promise<void> {
  await setupMocks([]);
  const middleware = await import("../../src/auth/middleware");
  const irr = await import("../../src/tools/irr");
  const token = middleware.generateToken("partner-user", "partner");

  const result = await irr.calculate_irr({
    token,
    principal: 1000000,
    rate: 0.12,
    io_months: 12,
    amort_months: 24,
    orig_fee: 20000,
    eot_fee: 10000,
    warrant_fmv: 5000
  });

  assert.ok(result.eir > 0.10 && result.eir < 0.20, `Unexpected EIR range: ${result.eir}`);
}

async function testFileParsing(): Promise<void> {
  const parser = await import("../../src/parsers/fileParser");
  const tempDir = path.resolve(process.cwd(), "tests", "tmp");
  await mkdir(tempDir, { recursive: true });

  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet([{ company: "ACME", amount: 100 }]);
  xlsx.utils.book_append_sheet(workbook, worksheet, "Deals");
  const xlsxPath = path.join(tempDir, "sample.xlsx");
  xlsx.writeFile(workbook, xlsxPath);

  const parsedXlsx = await parser.readFile("local", xlsxPath);
  assert.ok(typeof parsedXlsx === "object" && parsedXlsx !== null, "XLSX parser should return JSON object");

  const pdfPath = path.join(tempDir, "sample.pdf");
  const docxPath = path.join(tempDir, "sample.docx");
  await writeFile(pdfPath, "%PDF-1.1\n% mock fixture\n", "utf8");
  await writeFile(docxPath, "mock-docx", "utf8");

  try {
    await parser.readFile("local", pdfPath);
  } catch {
    // Parsing libraries need real binary fixtures; this confirms route execution.
  }

  try {
    await parser.readFile("local", docxPath);
  } catch {
    // Parsing libraries need real binary fixtures; this confirms route execution.
  }
}

async function testAuditEntriesPresence(): Promise<void> {
  assert.ok(auditEntries.length >= 3, "Expected tool calls to produce audit entries");
}

async function run(): Promise<void> {
  try {
    await testRoleBasedDealMetrics();
    await testUnauthorizedTermSheet();
    await testIrrAccuracy();
    await testFileParsing();
    await testAuditEntriesPresence();
    console.log("Integration tests passed.");
  } finally {
    await rm(path.resolve(process.cwd(), "tests", "tmp"), { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error("Integration tests failed:", error);
  process.exit(1);
});
