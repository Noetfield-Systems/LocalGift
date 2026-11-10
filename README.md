# LocalGift

Local-first digital gifting and merchant commerce by Noetfield Systems Inc.

## Runtime

Bun + TypeScript + PostgreSQL. This repository preserves the original, working Railway Function while moving presentation into standalone documents. The existing **merchant** remains the issuer of any linked gift card; LocalGift does not issue synthetic balances or claim unverified transactions.

## Run

```bash
bun install
cp .env.example .env
bun run dev
bun test
```

Set `DATABASE_URL` for persistence; `LOCALGIFT_ADMIN_TOKEN` protects the existing operator interface. Never commit credentials. `GET /health` checks process health, `GET /api/partners` lists active authorized issuer checkouts.

## Railway migration

Do not replace or delete the live Railway Function. Create a second GitHub-backed web service in the existing `localgift-vancouver` project; set `DATABASE_URL` to the existing PostgreSQL service reference; verify a temporary domain and basic merchant signups. Only then cut over; keep the prior Function available for rollback.

## Merchant-funded Deal Studio (deployed)

- `/merchant-deals`: issuer commission / authorized wholesale proposal funnel with real merchant contact and illustrative CAD-cent economics.
- `/api/deals/economics`: pure profitability preview; it does **not** issue money, credit, cards, or payouts.
- `/api/deals/proposals`: PostgreSQL-backed merchant commercial proposals; `/api/admin/deals` and `/api/admin/deals/status`: authenticated operator negotiation queue.
- `/api/ops/summary`: includes merchant deal pipeline counts, separate from confirmed collected service sales. Existing LOCALGIFT_ADMIN_TOKEN is reused; no new authentication system.
- **Business boundary:** LocalGift sources issuer-backed merchant opportunities; Earnloop remains the separate offerwall and advertiser-reward product. Proposals are not live offers, merchant inventory, sales, issued card balances, or funded referral rewards.

## Data migrations

The existing production tables are defined in `db/migrations/001_baseline.sql` and maintained idempotently by `src/db/baseline.ts`. Do not drop existing data.
