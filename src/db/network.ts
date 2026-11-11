import {ensureDealsSchema} from "./deals";
let initializing:Promise<void>|undefined;
export const NETWORK_DDL=[
"CREATE TABLE IF NOT EXISTS localgift_members(id UUID PRIMARY KEY,referral_code TEXT NOT NULL UNIQUE,referred_by UUID REFERENCES localgift_members(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_member_sessions(token_hash TEXT PRIMARY KEY,member_id UUID NOT NULL REFERENCES localgift_members(id),expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE INDEX IF NOT EXISTS localgift_member_sessions_expiry ON localgift_member_sessions(expires_at)",
"CREATE TABLE IF NOT EXISTS localgift_member_quests(member_id UUID NOT NULL REFERENCES localgift_members(id),quest TEXT NOT NULL CHECK(quest IN ('explore','create','share','refer')),xp INTEGER NOT NULL CHECK(xp BETWEEN 0 AND 100),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(member_id,quest))",
"CREATE TABLE IF NOT EXISTS localgift_network_offers(id UUID PRIMARY KEY,proposal_id UUID NOT NULL UNIQUE REFERENCES localgift_merchant_deal_proposals(id),business TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,issuer TEXT NOT NULL,checkout_url TEXT NOT NULL,face_cents INTEGER NOT NULL,consumer_discount_bps INTEGER NOT NULL,cashback_bps INTEGER NOT NULL,referral_bps INTEGER NOT NULL,agreement_reference TEXT NOT NULL,verification_reference TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE INDEX IF NOT EXISTS localgift_network_offers_public ON localgift_network_offers(status,created_at DESC)",
"CREATE TABLE IF NOT EXISTS localgift_offer_clicks(id UUID PRIMARY KEY,offer_id UUID NOT NULL REFERENCES localgift_network_offers(id),member_id UUID REFERENCES localgift_members(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE TABLE IF NOT EXISTS localgift_network_conversions(id UUID PRIMARY KEY,offer_id UUID NOT NULL REFERENCES localgift_network_offers(id),member_id UUID NOT NULL REFERENCES localgift_members(id),click_id UUID NOT NULL REFERENCES localgift_offer_clicks(id),external_order_ref TEXT NOT NULL,evidence_ref TEXT NOT NULL,settlement_ref TEXT,status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','approved','funded','reversed')),funded_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(offer_id,external_order_ref))",
"CREATE INDEX IF NOT EXISTS localgift_network_conversions_member ON localgift_network_conversions(member_id,status)",
"CREATE TABLE IF NOT EXISTS localgift_rewards(id UUID PRIMARY KEY,member_id UUID NOT NULL REFERENCES localgift_members(id),conversion_id UUID NOT NULL REFERENCES localgift_network_conversions(id),type TEXT NOT NULL CHECK(type IN ('cashback','referral')),amount_cents INTEGER NOT NULL CHECK(amount_cents >0),status TEXT NOT NULL DEFAULT 'recorded_funded' CHECK(status IN ('recorded_funded','reversed')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(member_id,conversion_id,type))",
"CREATE TABLE IF NOT EXISTS localgift_resale_listings(id UUID PRIMARY KEY,member_id UUID NOT NULL REFERENCES localgift_members(id),title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,condition TEXT NOT NULL,city TEXT NOT NULL,asking_cents INTEGER NOT NULL CHECK(asking_cents BETWEEN 100 AND 100000000),seller_email TEXT,status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','active','rejected','closed')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"ALTER TABLE localgift_resale_listings ADD COLUMN IF NOT EXISTS seller_email TEXT",
"CREATE INDEX IF NOT EXISTS localgift_resale_public ON localgift_resale_listings(status,created_at DESC)",
"CREATE TABLE IF NOT EXISTS localgift_resale_inquiries(id UUID PRIMARY KEY,listing_id UUID NOT NULL REFERENCES localgift_resale_listings(id),member_id UUID NOT NULL REFERENCES localgift_members(id),message TEXT NOT NULL,buyer_email TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"ALTER TABLE localgift_resale_inquiries ADD COLUMN IF NOT EXISTS buyer_email TEXT",
"ALTER TABLE localgift_gift_previews ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES localgift_members(id)"
];
export async function ensureNetworkSchema(sql:any){
 if(!initializing)initializing=(async()=>{await ensureDealsSchema(sql);for(const ddl of NETWORK_DDL)await sql.unsafe(ddl)})();
 try{await initializing;}catch(err){initializing=undefined;throw err;}
}
