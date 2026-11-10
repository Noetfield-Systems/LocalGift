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

## Data migrations

The existing production tables are defined in `db/migrations/001_baseline.sql` and maintained idempotently by `src/db/baseline.ts`. Do not drop existing data.
