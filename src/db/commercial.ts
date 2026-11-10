export const COMMERCE_DDL = [
"CREATE TABLE IF NOT EXISTS localgift_service_orders(id UUID PRIMARY KEY, business TEXT NOT NULL, contact TEXT NOT NULL, email TEXT NOT NULL, package TEXT NOT NULL CHECK(package IN ('starter')), amount_cents INTEGER NOT NULL CHECK(amount_cents=14900), currency TEXT NOT NULL DEFAULT 'cad', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','checkout_created','paid','cancelled','refunded','payment_unavailable')), stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ)",
"CREATE TABLE IF NOT EXISTS localgift_fulfillment_tasks(id UUID PRIMARY KEY, order_id UUID NOT NULL UNIQUE REFERENCES localgift_service_orders(id), kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_payment_events(id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_corporate_inquiries(id UUID PRIMARY KEY, company TEXT NOT NULL, contact TEXT NOT NULL, email TEXT NOT NULL, recipients INTEGER NOT NULL, budget_cad INTEGER, occasion TEXT, details TEXT, status TEXT NOT NULL DEFAULT 'new', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_gift_previews(id UUID PRIMARY KEY, recipient TEXT NOT NULL, sender TEXT NOT NULL, message TEXT NOT NULL, design TEXT NOT NULL, amount INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_product_events(id UUID PRIMARY KEY, type TEXT NOT NULL, context TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_merchant_accounts(id UUID PRIMARY KEY, lead_id UUID REFERENCES localgift_merchant_leads(id), business TEXT NOT NULL, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_merchant_requests(id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES localgift_merchant_accounts(id), kind TEXT NOT NULL CHECK(kind IN ('listing','campaign')), business TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
];
let ready: Promise<void> | undefined;
export async function ensureCommerceSchema(sql:any) {
  if(!ready) ready=(async()=>{for(const ddl of COMMERCE_DDL)await sql.unsafe(ddl);})();
  try{await ready;}catch(err){ready=undefined;throw err;}
}
