CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  principal NUMERIC(18, 2) NOT NULL,
  rate NUMERIC(10, 6) NOT NULL,
  io_months INTEGER NOT NULL,
  amort_months INTEGER NOT NULL,
  orig_fee NUMERIC(18, 2) NOT NULL DEFAULT 0,
  eot_fee NUMERIC(18, 2) NOT NULL DEFAULT 0,
  warrant_fmv NUMERIC(18, 2) NOT NULL DEFAULT 0,
  covenant_threshold NUMERIC(10, 6) NOT NULL,
  days_to_maturity INTEGER NOT NULL,
  irr NUMERIC(10, 6) NOT NULL DEFAULT 0,
  moic NUMERIC(10, 6) NOT NULL DEFAULT 0,
  outstanding_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  covenant_status TEXT NOT NULL DEFAULT 'healthy'
);
