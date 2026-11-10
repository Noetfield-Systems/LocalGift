export const BASELINE_DDL = [
  "CREATE TABLE IF NOT EXISTS localgift_interest(id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE, category TEXT NOT NULL, amount INT NOT NULL CHECK(amount IN (25,50,75,100)), consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS localgift_merchant_leads(id UUID PRIMARY KEY, contact TEXT NOT NULL,business TEXT NOT NULL,email TEXT NOT NULL,website TEXT,platform TEXT NOT NULL,city TEXT NOT NULL,consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
  "CREATE TABLE IF NOT EXISTS localgift_partners(id UUID PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,description TEXT,issuer TEXT NOT NULL,checkout_url TEXT NOT NULL,is_active BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
];
export async function ensureBaselineSchema(sql: any) {
  for (const statement of BASELINE_DDL) await sql.unsafe(statement);
}
