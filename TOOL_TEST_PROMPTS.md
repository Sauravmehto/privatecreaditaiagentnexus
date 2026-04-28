# MCP Tool Test Prompts

Copy-paste these directly into Claude Desktop.

## Existing 10 tools

### 1) calculate_irr
Use the `calculate_irr` tool with:
- principal: 5000000
- rate: 0.14
- io_months: 6
- amort_months: 36
- orig_fee: 50000
- eot_fee: 25000
- warrant_fmv: 100000

### 2) create_irr_model
Use the `create_irr_model` tool with:
- instrument_type: "term_loan"
- params: {"principal":5000000,"rate":0.14,"io_months":6,"amort_months":36,"orig_fee":50000,"eot_fee":25000}

### 3) generate_restructure_memo
Use the `generate_restructure_memo` tool with:
- deal_id: "VD-2023-0101"

### 4) generate_term_sheet
Use the `generate_term_sheet` tool with:
- company_name: "Axon Therapeutics"
- principal: 3000000
- rate: 0.1215
- io_months: 12
- amort_months: 18
- orig_fee: 24900
- eot_fee: 96300
- warrant_coverage: 0

### 5) generate_warrant_irr
Use the `generate_warrant_irr` tool with:
- coverage: 0.12
- strike_val: 6500000
- fd_shares: 88000000
- scenarios: [50000000,90000000,150000000]
- probabilities: [0.25,0.5,0.25]

### 6) get_covenant_alerts
Use the `get_covenant_alerts` tool.

### 7) get_deal_metrics
Use the `get_deal_metrics` tool with:
- deal_id: "VD-2024-0109"

### 8) get_portfolio_summary
Use the `get_portfolio_summary` tool.

### 9) run_restructure_scenario
Use the `run_restructure_scenario` tool with:
- deal_id: "VD-2023-0101"
- scenario_type: "rate_stepup"
- params: {"rateStep":0.02}

### 10) search_precedent_deals
Use the `search_precedent_deals` tool with:
- sector: "Fintech"
- deal_size_min: 2000000
- deal_size_max: 10000000

## New portfolio tools

### 11) get_deal_cash_flows
Use the `get_deal_cash_flows` tool with:
- deal_id: "VD-2023-0101"
- months: 12

### 12) search_comparable_deals
Use the `search_comparable_deals` tool with:
- sector: "Fintech"
- deal_size_min: 2000000
- deal_size_max: 10000000
- tolerance_pct: 0.15

## New computation tools

### 13) calculate_term_loan_irr
Use the `calculate_term_loan_irr` tool with:
- principal: 5000000
- rate: 0.14
- io_months: 6
- amort_months: 36
- orig_fee: 50000
- eot_fee: 25000
- warrant_fmv: 100000

### 14) calculate_note_irr
Use the `calculate_note_irr` tool with:
- principal: 2000000
- annual_coupon_rate: 0.12
- term_months: 24
- upfront_fee: 20000
- exit_fee: 15000

### 15) calculate_warrant_irr
Use the `calculate_warrant_irr` tool with:
- coverage: 0.12
- strike_val: 6500000
- fd_shares: 88000000
- scenarios: [50000000,90000000,150000000]
- probabilities: [0.25,0.5,0.25]

### 16) calculate_conv_note_irr
Use the `calculate_conv_note_irr` tool with:
- principal: 2000000
- term_months: 24
- coupon_rate: 0.10
- up_round_value: 3000000
- flat_round_value: 2300000
- down_round_value: 1700000
- p_up: 0.30
- p_flat: 0.40
- p_down: 0.30

## New restructure tools

### 17) compare_before_after_irr
Use the `compare_before_after_irr` tool with:
- deal_id: "VD-2023-0101"
- scenario_type: "maturity_extension"
- params: {"extraMonths":6}

### 18) compare_all_scenarios
Use the `compare_all_scenarios` tool with:
- deal_id: "VD-2023-0101"

### 19) get_outstanding_at_breach
Use the `get_outstanding_at_breach` tool with:
- deal_id: "VD-2023-0101"
- breach_month: 6

### 20) calculate_dpo_breakeven
Use the `calculate_dpo_breakeven` tool with:
- deal_id: "VD-2023-0101"
- settlement_month: 12

## Quick smoke-test order
1. `get_portfolio_summary`
2. `get_deal_metrics`
3. `get_deal_cash_flows`
4. `calculate_irr`
5. `calculate_term_loan_irr`
6. `run_restructure_scenario`
7. `compare_all_scenarios`

