import {randomBytes,randomUUID,createHash,timingSafeEqual} from "node:crypto";
import {ensureNetworkSchema} from "../db/network";
import {calculateDeal} from "./deal-economics";

type DB=any;
const categories=["Coffee & treats","Food & dining","Experiences","Wellness","Shopping","Other local service"];
const resaleCategories=["Electronics","Home","Fashion","Sports","Books","Other"];
const conditions=["New","Like new","Good","Fair"];
const cities=["Vancouver","Burnaby","Richmond","North Vancouver","Surrey","Other Metro Vancouver"];
const attempts=new Map<string,{since:number,n:number}>();
function json(payload:any,status=200,headers?:HeadersInit){return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...(headers||{})}});}
function clean(x:unknown,max=180){return String(x??"").trim().slice(0,max);}
function sameOrigin(req:Request){const origin=req.headers.get("origin");if(!origin)return true;try{return new URL(origin).host===new URL(req.url).host;}catch{return false;}}
function rate(req:Request){const ip=clean((req.headers.get("x-forwarded-for")||"unknown").split(",")[0],100),now=Date.now();let a=attempts.get(ip);if(attempts.size>6000)attempts.clear();if(!a||now-a.since>900000){a={since:now,n:0};attempts.set(ip,a);}return ++a.n<=32;}
async function parse(req:Request){if(!(req.headers.get("content-type")||"").startsWith("application/json"))throw new RangeError("JSON_REQUIRED");if(Number(req.headers.get("content-length")||0)>10000)throw new RangeError("TOO_LARGE");const raw=await req.text();if(raw.length>10000)throw new RangeError("TOO_LARGE");let value:any;try{value=JSON.parse(raw||"{}");}catch{throw new RangeError("INVALID_JSON");}if(!value||typeof value!=="object"||Array.isArray(value))throw new RangeError("JSON_OBJECT_REQUIRED");return value;}
function tokenHash(token:string){return createHash("sha256").update(token).digest("hex");}
function operator(req:Request){const value=(req.headers.get("authorization")||"").replace(/^Bearer /i,"").trim(),key=Bun.env.LOCALGIFT_ADMIN_TOKEN||"";return value.length>=32&&value.length===key.length&&timingSafeEqual(Buffer.from(value),Buffer.from(key));}
function email(x:unknown){const v=clean(x,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new RangeError("Valid contact email required");return v;}
function uuid(x:unknown){return typeof x==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);}
function amount(x:any,min=1,max=100000000){if(!Number.isSafeInteger(x)||x<min||x>max)throw new RangeError("Invalid amount in CAD cents");return x;}
function secureUrl(v:any){const s=clean(v,900);try{const u=new URL(s);if(u.protocol!=="https:"||u.username||u.password||!u.hostname.includes("."))throw Error();return u.toString();}catch{throw new RangeError("Official HTTPS issuer checkout required");}}
function cookie(req:Request){const pair=(req.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("lg_session="));return pair?.slice("lg_session=".length)||"";}
export async function networkMember(req:Request,sql:DB){const token=cookie(req);if(!/^[a-f0-9]{64}$/.test(token))return null;const rows=await sql.unsafe("SELECT m.id,m.referral_code,m.referred_by,m.created_at FROM localgift_member_sessions s JOIN localgift_members m ON m.id=s.member_id WHERE s.token_hash=$1 AND s.expires_at > NOW() LIMIT 1",[tokenHash(token)]);return rows[0]||null;}
function referCode(){return randomBytes(7).toString("hex").toUpperCase();}
async function join(req:Request,sql:DB){const existing=await networkMember(req,sql);if(existing)return json({member:existing,existing:true});const b=await parse(req),ref=clean(b.ref,32).toUpperCase();const token=randomBytes(32).toString("hex"),id=randomUUID(),code=referCode();
 const invite=ref?await sql.unsafe("SELECT id FROM localgift_members WHERE referral_code=$1 LIMIT 1",[ref]):[];
 await sql.begin(async(tx:any)=>{
  await tx.unsafe("INSERT INTO localgift_members(id,referral_code,referred_by) VALUES($1,$2,$3)",[id,code,invite[0]?.id||null]);
  await tx.unsafe("INSERT INTO localgift_member_sessions(token_hash,member_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '60 days')",[tokenHash(token),id]);
 });
 return json({member:{id,referral_code:code,referred_by:invite[0]?.id||null},joined:true,anonymous_device:true},201,{"set-cookie":"lg_session="+token+"; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=5184000"});
}
async function me(req:Request,sql:DB){const m=await networkMember(req,sql);if(!m)return json({member:null,requires_join:true});
 const [quests,rewards,referrals,clicks,listings]=await Promise.all([
  sql.unsafe("SELECT quest,xp,created_at FROM localgift_member_quests WHERE member_id=$1 ORDER BY created_at",[m.id]),
  sql.unsafe("SELECT type,status,COALESCE(SUM(amount_cents),0)::BIGINT AS amount_cents FROM localgift_rewards WHERE member_id=$1 GROUP BY type,status",[m.id]),
  sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_members WHERE referred_by=$1",[m.id]),
  sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_offer_clicks WHERE member_id=$1",[m.id]),
  sql.unsafe("SELECT status,COUNT(*)::INT n FROM localgift_resale_listings WHERE member_id=$1 GROUP BY status",[m.id])
 ]);
 const funded=rewards.filter((r:any)=>r.status==="recorded_funded").reduce((n:number,r:any)=>n+Number(r.amount_cents),0);
 return json({member:{id:m.id,referral_code:m.referral_code,created_at:m.created_at},quests,xp:quests.reduce((a:number,q:any)=>a+q.xp,0),rewards:{entries:rewards,operator_recorded_funded_cents:funded,withdrawable_cents:0,cashout_enabled:false,explanation:"Funds and eligibility must be independently reconciled and a supported payout provider connected before withdrawals."},referrals:referrals[0].n,issuer_checkout_visits:clicks[0].n,resale:listings,referral_url:"/club?ref="+encodeURIComponent(m.referral_code)});
}
async function quests(req:Request,sql:DB){const m=await networkMember(req,sql);if(!m)return json({error:"Join the club first"},401);const b=await parse(req),q=clean(b.quest,20);
 if(!["explore","create","share"].includes(q))return json({error:"Unsupported noncash quest"},400);
 if(q==="create"){const count=await sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_gift_previews WHERE member_id=$1 AND created_at > NOW()-INTERVAL '30 days'",[m.id]);if(!count[0]?.n)return json({error:"Create a gift preview first"},409);}
 const rows=await sql.unsafe("INSERT INTO localgift_member_quests(member_id,quest,xp) VALUES($1,$2,20) ON CONFLICT DO NOTHING RETURNING quest,xp",[m.id,q]);
 return json({completed:!!rows.length,already_completed:!rows.length,earned_noncash_xp:rows.length?20:0});
}
async function offers(sql:DB){const rows=await sql.unsafe("SELECT o.id,o.business,o.title,o.description,o.category,o.issuer,o.checkout_url,o.face_cents,o.consumer_discount_bps,o.cashback_bps,o.referral_bps,o.created_at FROM localgift_network_offers o WHERE o.status='active' ORDER BY o.created_at DESC LIMIT 100");const partner=await sql.unsafe("SELECT name,category,description,issuer,checkout_url FROM localgift_partners WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 100");return json({offers:rows.map((o:any)=>({...o,cashback_status:"not_enabled_until_funding_verification",referral_status:"not_enabled_until_funding_verification"})),issuer_links:partner,real_merchant_count:rows.length+partner.length,source:"verified operator-approved issuer entries; no synthetic gift cards"});}
async function track(req:Request,sql:DB){const b=await parse(req),id=clean(b.offer_id,50);if(!uuid(id))return json({error:"Offer id required"},400);const offer=await sql.unsafe("SELECT id,checkout_url,status FROM localgift_network_offers WHERE id=$1 LIMIT 1",[id]);if(!offer.length||offer[0].status!=="active")return json({error:"Offer no longer available"},404);const m=await networkMember(req,sql),clickId=randomUUID();await sql.unsafe("INSERT INTO localgift_offer_clicks(id,offer_id,member_id) VALUES($1,$2,$3)",[clickId,id,m?.id||null]);return json({checkout_url:offer[0].checkout_url,click_id:clickId,transaction_verified:false,reward_earned:false});}
async function resale(req:Request,sql:DB){if(req.method==="GET"){const rows=await sql.unsafe("SELECT id,title,description,category,condition,city,asking_cents,created_at FROM localgift_resale_listings WHERE status='active' ORDER BY created_at DESC LIMIT 100");return json({listings:rows,marketplace_mode:"buyer-seller introductions; no escrow or platform funds"});}
 const m=await networkMember(req,sql);if(!m)return json({error:"Join the club first"},401);const b=await parse(req);
 const title=clean(b.title,110),description=clean(b.description,1100),category=clean(b.category,80),condition=clean(b.condition,30),city=clean(b.city,60);
 if(title.length<6||description.length<20||!resaleCategories.includes(category)||!conditions.includes(condition)||!cities.includes(city)||b.consent!==true)return json({error:"Complete item details, city and consent"},400);
 const asking=amount(b.asking_cents,100,100000000),sellerMail=email(b.seller_email),id=randomUUID();
 await sql.unsafe("INSERT INTO localgift_resale_listings(id,member_id,title,description,category,condition,city,asking_cents,seller_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,m.id,title,description,category,condition,city,asking,sellerMail]);
 return json({listing_id:id,status:"pending_review",payment_processed:false},201);
}
async function inquiry(req:Request,sql:DB){const m=await networkMember(req,sql);if(!m)return json({error:"Join the club first"},401);const b=await parse(req),id=clean(b.listing_id,50),message=clean(b.message,800),buyerMail=email(b.buyer_email);if(!uuid(id)||message.length<15)return json({error:"Listing id and detailed message required"},400);
 const rows=await sql.unsafe("SELECT id,member_id FROM localgift_resale_listings WHERE id=$1 AND status='active' LIMIT 1",[id]);
 if(!rows.length)return json({error:"Listing unavailable"},404);if(rows[0].member_id===m.id)return json({error:"You own this listing"},400);
 const msgId=randomUUID();await sql.unsafe("INSERT INTO localgift_resale_inquiries(id,listing_id,member_id,message,buyer_email) VALUES($1,$2,$3,$4,$5)",[msgId,id,m.id,message,buyerMail]);return json({received:true,id:msgId,delivery:"operator_relay_queue",payment_processed:false},201);
}
async function admin(req:Request,sql:DB,path:string){
 if(!operator(req))return json({error:"Unauthorized"},401);
 if(path==="/api/network/admin/queue"&&req.method==="GET"){
  const [proposals,offers,listings,conversions,interests]=await Promise.all([
   sql.unsafe("SELECT id,business,contact,email,status,model,face_cents,projected_contribution_cents,agreement_reference FROM localgift_merchant_deal_proposals ORDER BY created_at DESC LIMIT 100"),
   sql.unsafe("SELECT id,business,title,status,created_at FROM localgift_network_offers ORDER BY created_at DESC LIMIT 100"),
   sql.unsafe("SELECT id,title,category,city,asking_cents,seller_email,status,created_at FROM localgift_resale_listings ORDER BY created_at DESC LIMIT 100"),
   sql.unsafe("SELECT c.id,o.business,c.status,c.external_order_ref,c.evidence_ref,c.settlement_ref,c.created_at FROM localgift_network_conversions c JOIN localgift_network_offers o ON o.id=c.offer_id ORDER BY c.created_at DESC LIMIT 100"),
   sql.unsafe("SELECT i.id,l.title,i.message,i.buyer_email,l.seller_email,i.created_at FROM localgift_resale_inquiries i JOIN localgift_resale_listings l ON i.listing_id=l.id ORDER BY i.created_at DESC LIMIT 100")
  ]);return json({proposals,offers,resale_listings:listings,conversions,resale_inquiries:interests});
 }
 if(path==="/api/network/admin/summary"&&req.method==="GET"){
 const [members,offerCount,clicks,resaleCount,conversionCounts,rewardTotals]=await Promise.all([
  sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_members"),
  sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_network_offers WHERE status='active'"),
  sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_offer_clicks"),
  sql.unsafe("SELECT status,COUNT(*)::INT n FROM localgift_resale_listings GROUP BY status"),
  sql.unsafe("SELECT status,COUNT(*)::INT n FROM localgift_network_conversions GROUP BY status"),
  sql.unsafe("SELECT status,COALESCE(SUM(amount_cents),0)::BIGINT amount_cents FROM localgift_rewards GROUP BY status")
 ]);return json({product_id:"localgift",members:members[0].n,active_offers:offerCount[0].n,outbound_clicks:clicks[0].n,resale_by_status:resaleCount,conversions_by_status:conversionCounts,rewards_by_status:rewardTotals,net_collected_revenue_cents:null,withdrawable_cents:0,cashout_available:false,source:"localgift_postgres"});
 }
 const b=await parse(req);
 if(path==="/api/network/admin/offer/publish"){
  const id=clean(b.proposal_id,50),title=clean(b.title,100),description=clean(b.description,500),issuer=clean(b.issuer,120),checkout=secureUrl(b.checkout_url),proof=clean(b.verification_reference,240);
  if(!uuid(id)||title.length<6||description.length<20||issuer.length<2||proof.length<12||b.issuer_authorized!==true||b.checkout_verified!==true)return json({error:"Issuer permission, verified checkout, proof reference and offer details required"},400);
  const rows=await sql.unsafe("SELECT id,business,category,face_cents,consumer_discount_bps,cashback_bps,referral_bps,agreement_reference,status FROM localgift_merchant_deal_proposals WHERE id=$1",[id]);
  const d=rows[0];if(!d||d.status!=="agreement_documented"||!d.agreement_reference)return json({error:"Documented merchant issuer agreement required"},409);
  const offerId=randomUUID();
  await sql.unsafe("INSERT INTO localgift_network_offers(id,proposal_id,business,title,description,category,issuer,checkout_url,face_cents,consumer_discount_bps,cashback_bps,referral_bps,agreement_reference,verification_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(proposal_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,issuer=EXCLUDED.issuer,checkout_url=EXCLUDED.checkout_url,verification_reference=EXCLUDED.verification_reference,status='active'",[offerId,d.id,d.business,title,description,d.category,issuer,checkout,d.face_cents,d.consumer_discount_bps,d.cashback_bps,d.referral_bps,d.agreement_reference,proof]);
  return json({published:true,offer_active:true,external_issuer_checkout:true,cashback_payout_enabled:false},201);
 }
 if(path==="/api/network/admin/offer/pause"){
  const id=clean(b.offer_id,50);if(!uuid(id))return json({error:"Offer id required"},400);
  const rows=await sql.unsafe("UPDATE localgift_network_offers SET status='paused' WHERE id=$1 AND status='active' RETURNING id",[id]);return json({paused:!!rows.length});
 }
 if(path==="/api/network/admin/resale/review"){
  const id=clean(b.listing_id,50),status=clean(b.status,20);if(!uuid(id)||!["active","rejected","closed"].includes(status))return json({error:"Invalid moderation decision"},400);
  const rows=await sql.unsafe("UPDATE localgift_resale_listings SET status=$1 WHERE id=$2 RETURNING id",[status,id]);return json({updated:!!rows.length,status});
 }
 if(path==="/api/network/admin/conversion/report"){
  const offerId=clean(b.offer_id,50),clickId=clean(b.click_id,50),order=clean(b.external_order_ref,130),proof=clean(b.evidence_ref,240);
  if(!uuid(offerId)||!uuid(clickId)||order.length<6||proof.length<12)return json({error:"Valid click, issuer order and purchase evidence reference required"},400);
  const rows=await sql.unsafe("SELECT o.id,o.status,c.member_id FROM localgift_offer_clicks c JOIN localgift_network_offers o ON o.id=c.offer_id WHERE c.id=$1 AND o.id=$2 LIMIT 1",[clickId,offerId]);
  if(!rows.length||!rows[0].member_id)return json({error:"No eligible member-linked checkout click"},409);
  const id=randomUUID();
  const created=await sql.unsafe("INSERT INTO localgift_network_conversions(id,offer_id,member_id,click_id,external_order_ref,evidence_ref) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(offer_id,external_order_ref) DO NOTHING RETURNING id",[id,offerId,rows[0].member_id,clickId,order,proof]);
  return json({reported:!!created.length,duplicate:!created.length,status:"reported",funded:false,reward_issued:false},created.length?201:200);
 }
 if(path==="/api/network/admin/conversion/review"){
  const id=clean(b.conversion_id,50),status=clean(b.status,20);if(!uuid(id)||!["approved","reversed"].includes(status))return json({error:"Invalid conversion review"},400);
  const rows=await sql.unsafe("UPDATE localgift_network_conversions SET status=$1 WHERE id=$2 AND status IN ('reported','approved') RETURNING id",[status,id]);
  return json({reviewed:!!rows.length,status,funded:false,member_rewards_issued:false});
 }
 if(path==="/api/network/admin/conversion/fund"){
  const id=clean(b.conversion_id,50),settle=clean(b.settlement_ref,240),ack=b.settlement_confirmed===true;
  if(!uuid(id)||settle.length<12||!ack)return json({error:"Valid conversion id, settlement evidence, and explicit funding attestation required"},400);
  const result=await sql.begin(async(tx:any)=>{
   const rows=await tx.unsafe("SELECT c.id,c.member_id,c.status,o.face_cents,o.cashback_bps,o.referral_bps,d.merchant_rate_bps,d.consumer_discount_bps,d.processing_bps,d.reserve_bps,d.model,m.referred_by FROM localgift_network_conversions c JOIN localgift_network_offers o ON o.id=c.offer_id JOIN localgift_merchant_deal_proposals d ON d.id=o.proposal_id JOIN localgift_members m ON m.id=c.member_id WHERE c.id=$1 FOR UPDATE OF c",[id]);
   const d=rows[0];if(!d||d.status!=="approved")return {funded:false,error:"Conversion must be approved first"};
   const economics=calculateDeal({model:d.model,face_cents:d.face_cents,merchant_rate_bps:d.merchant_rate_bps,consumer_discount_bps:d.consumer_discount_bps,cashback_bps:d.cashback_bps,referral_bps:d.referral_bps,processing_bps:d.processing_bps,reserve_bps:d.reserve_bps});
   if(economics.projected_contribution_cents<=0)return {funded:false,error:"Non-positive unit economics; rewards cannot be allocated"};
   await tx.unsafe("UPDATE localgift_network_conversions SET status='funded',settlement_ref=$1,funded_at=NOW() WHERE id=$2",[settle,id]);
   const cashback=economics.cashback_cents,referral=economics.referral_cents;
   if(cashback>0)await tx.unsafe("INSERT INTO localgift_rewards(id,member_id,conversion_id,type,amount_cents) VALUES($1,$2,$3,'cashback',$4) ON CONFLICT DO NOTHING",[randomUUID(),d.member_id,id,cashback]);
   if(d.referred_by&&referral>0)await tx.unsafe("INSERT INTO localgift_rewards(id,member_id,conversion_id,type,amount_cents) VALUES($1,$2,$3,'referral',$4) ON CONFLICT DO NOTHING",[randomUUID(),d.referred_by,id,referral]);
   return {funded:true,member_reward_recorded_cents:cashback,referral_reward_recorded_cents:d.referred_by?referral:0,withdrawals_enabled:false,verification:"operator-attested merchant settlement; not independently bank-reconciled"};
  });return json(result,result.error?409:200);
 }
 return json({error:"Unknown operator action"},404);
}
export async function routeNetwork(req:Request,sql:DB|null):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(req.method==="GET"&&(path==="/assets/network.css"||path==="/assets/network.js")){const asset=path.endsWith(".css")?"network.css":"network.js";return new Response(await Bun.file(new URL("../pages/"+asset,import.meta.url)).text(),{headers:{"content-type":asset.endsWith(".css")?"text/css; charset=utf-8":"text/javascript; charset=utf-8","cache-control":"public, max-age=300","x-content-type-options":"nosniff"}});}
 if(req.method==="GET"&&path==="/admin/network"){const html=await Bun.file(new URL("../pages/network-admin.html",import.meta.url)).text();return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex,nofollow","x-content-type-options":"nosniff"}});}
 if(req.method==="GET"&&["/market","/club","/resale"].includes(path)){
  const page=path.slice(1),html=await Bun.file(new URL("../pages/"+page+".html",import.meta.url)).text();
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=120","x-content-type-options":"nosniff"}});
 }
 if(!path.startsWith("/api/network/"))return null;
 if(!sql)return json({error:"Database unavailable"},503);
 if(req.method==="POST"&&!sameOrigin(req))return json({error:"Origin mismatch"},403);
 if(req.method==="POST"&&!rate(req))return json({error:"Too many requests"},429);
 try{
  await ensureNetworkSchema(sql);
  if(path.startsWith("/api/network/admin/"))return await admin(req,sql,path);
  if(req.method==="GET"){
   if(path==="/api/network/offers")return offers(sql);
   if(path==="/api/network/me")return me(req,sql);
   if(path==="/api/network/resale")return resale(req,sql);
   return json({error:"Not found"},404);
  }
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  if(path==="/api/network/join")return join(req,sql);
  if(path==="/api/network/quests/complete")return quests(req,sql);
  if(path==="/api/network/offers/click")return track(req,sql);
  if(path==="/api/network/resale")return resale(req,sql);
  if(path==="/api/network/resale/inquiry")return inquiry(req,sql);
  return json({error:"Not found"},404);
 }catch(err){
  if(err instanceof RangeError)return json({error:err.message},400);
  console.error("localgift_network",String((err as Error).message||err).slice(0,170));
  return json({error:"Request could not be completed"},503);
 }
}
