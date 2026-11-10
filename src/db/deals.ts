import { ensureCommerceSchema } from "./commercial";
let ready:Promise<void>|undefined;
export const DEALS_DDL=[
 "CREATE TABLE IF NOT EXISTS localgift_merchant_deal_proposals(id UUID PRIMARY KEY,business TEXT NOT NULL,contact TEXT NOT NULL,email TEXT NOT NULL,category TEXT NOT NULL,checkout_url TEXT,model TEXT NOT NULL CHECK(model IN ('merchant_commission','wholesale_resale')),face_cents INTEGER NOT NULL CHECK(face_cents BETWEEN 2500 AND 1000000),merchant_rate_bps INTEGER NOT NULL,consumer_discount_bps INTEGER NOT NULL,cashback_bps INTEGER NOT NULL,referral_bps INTEGER NOT NULL,processing_bps INTEGER NOT NULL,reserve_bps INTEGER NOT NULL,projected_contribution_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','negotiating','agreement_documented','rejected')),agreement_reference TEXT,consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
 "CREATE INDEX IF NOT EXISTS localgift_deal_proposals_latest_idx ON localgift_merchant_deal_proposals(created_at DESC)"
];
export async function ensureDealsSchema(sql:any){
 if(!ready)ready=(async()=>{await ensureCommerceSchema(sql);for(const stmt of DEALS_DDL)await sql.unsafe(stmt)})();
 try{await ready;}catch(error){ready=undefined;throw error;}
}
