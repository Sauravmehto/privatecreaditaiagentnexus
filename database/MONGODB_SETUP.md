# MongoDB Setup Guide for Private Credit MCP Server

## Step 1 — Create a Free MongoDB Atlas Cluster

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Sign up for a free account
3. Click **"Build a Database"** → choose **M0 Free Tier**
4. Select your region (pick closest to you)
5. Name your cluster: `private-credit-db`
6. Click **Create**

## Step 2 — Create a Database User

1. In Atlas sidebar → **Database Access** → **Add New Database User**
2. Set username: `mcpuser`
3. Set a strong password (save it — you'll need it)
4. Role: **Read and Write to Any Database**
5. Click **Add User**

## Step 3 — Whitelist Your IP

1. In Atlas sidebar → **Network Access** → **Add IP Address**
2. Click **"Allow Access from Anywhere"** (for development)
   - For production: add only your server's IP
3. Click **Confirm**

## Step 4 — Get Your Connection String

1. In Atlas → **Database** → Click **Connect** on your cluster
2. Choose **"Drivers"** → Driver: Node.js
3. Copy the connection string. It looks like:
   ```
   mongodb+srv://mcpuser:<password>@private-credit-db.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<password>` with your actual password
5. Add database name before `?`:
   ```
   mongodb+srv://mcpuser:<password>@private-credit-db.xxxxx.mongodb.net/private_credit?retryWrites=true&w=majority
   ```
6. Paste this as `MONGODB_URI` in your `.env` file

## Step 5 — Import the Seed Data

Install MongoDB Database Tools if not already installed:
https://www.mongodb.com/try/download/database-tools

Then run these two commands (replace the URI with yours):

```bash
# Import deals collection
mongoimport \
  --uri "mongodb+srv://mcpuser:<password>@private-credit-db.xxxxx.mongodb.net/private_credit" \
  --collection deals \
  --file seed_deals.json \
  --jsonArray

# Import audit_logs collection
mongoimport \
  --uri "mongodb+srv://mcpuser:<password>@private-credit-db.xxxxx.mongodb.net/private_credit" \
  --collection audit_logs \
  --file seed_audit_logs.json \
  --jsonArray
```

You should see:
```
12 document(s) imported successfully (deals)
5 document(s) imported successfully (audit_logs)
```

## Step 6 — Verify in Atlas

1. Atlas → Browse Collections
2. You should see:
   - `private_credit.deals` — 12 documents
   - `private_credit.audit_logs` — 5 documents

---

## Collections Reference

### `deals` collection — 29 fields per document
| Field | Type | Description |
|---|---|---|
| deal_id | String | Unique deal identifier (e.g. VD-2023-0101) |
| company_name | String | Portfolio company name |
| sector | String | Industry sector |
| funding_stage | String | Series A/B/C/D |
| lead_vc | String | Lead VC firm |
| founder_name | String | Founder name |
| instrument_type | String | Term Loan / Convertible Note / Revolver |
| principal_usd | Number | Loan principal in USD |
| outstanding_balance_usd | Number | Current outstanding amount |
| interest_rate | Number | Annual interest rate (decimal) |
| io_months | Number | Interest-only period in months |
| amortization_months | Number | Amortization period in months |
| origination_fee | Number | Upfront fee (decimal) |
| end_of_term_fee | Number | Back-end fee (decimal) |
| warrant_coverage | Number | Warrant coverage % (0 if none) |
| irr | Number | Deal IRR (decimal) |
| moic | Number | Multiple on invested capital |
| covenant_status | String | Compliant / Watch / Breach Risk |
| covenant_threshold_ratio | Number | Minimum required ratio |
| covenant_actual_ratio | Number | Current actual ratio |
| days_to_maturity | Number | Days remaining to maturity |

### `audit_logs` collection — 6 fields per document
| Field | Type | Description |
|---|---|---|
| user_id | String | Who made the request |
| tool | String | Which MCP tool was called |
| params | String | JSON params passed to tool |
| response_summary | String | What was returned |
| timestamp | String | ISO 8601 datetime |
| ip_address | String | Requester IP |
