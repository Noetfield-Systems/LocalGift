import {randomUUID,timingSafeEqual} from "node:crypto";
import {calculateDeal,type DealInput} from "./deal-economics";
import {ensureDealsSchema} from "../db/deals";

const attempts=new Map<string,{time:number,count:number}>();
function json(value:any,status=200){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function trim(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function validEmail(v:string){return v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function allowedCheckout(value:string){if(!value)return true;try{const x=new URL(value);return x.protocol==="https:"&&!x.username&&!x.password&&x.hostname.includes(".");}catch{return false;}}
function sameOrigin(req:Request){const origin=req.headers.get("origin");if(!origin)return true;try{return new URL(origin).host===new URL(req.url).host;}catch{return false;}}
function limited(req:Request){
 const ip=trim((req.headers.get("x-forwarded-for")||"anonymous").split(",")[0],100);
 const now=Date.now();if(attempts.size>5000)attempts.clear();
 const item=attempts.get(ip);if(!item||now-item.time>15*60*1000){attempts.set(ip,{time:now,count:1});return false;}
 item.count++;return item.count>12;
}
function operator(req:Request){
 const candidate=(req.headers.get("authorization")||"").replace(/^Bearer /i,"").trim();
 const configured=Bun.env.LOCALGIFT_ADMIN_TOKEN||"";
 return candidate.length>=32&&candidate.length===configured.length&&timingSafeEqual(Buffer.from(candidate),Buffer.from(configured));
}
async function readJson(req:Request){
 if(!(req.headers.get("content-type")||"").startsWith("application/json"))throw new SyntaxError("JSON_REQUIRED");
 if(Number(req.headers.get("content-length")||"0")>10000)throw new RangeError("TOO_LARGE");
 const text=await req.text();if(text.length>10000)throw new RangeError("TOO_LARGE");
 return JSON.parse(text||"{}");
}
function dealInput(obj:any):DealInput{
 return {
  model:obj.model,
  face_cents:obj.face_cents,
  merchant_rate_bps:obj.merchant_rate_bps,
  consumer_discount_bps:obj.consumer_discount_bps,
  cashback_bps:obj.cashback_bps,
  referral_bps:obj.referral_bps,
  processing_bps:obj.processing_bps,
  reserve_bps:obj.reserve_bps
 };
}
export async function routeDeals(req:Request,sql:any):Promise<Response|null>{
 const url=new URL(req.url),path=url.pathname;
 if(req.method==="GET"&&path==="/merchant-deals"){
  const html=await Bun.file(new URL("../pages/deals.html",import.meta.url)).text();
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=120","x-content-type-options":"nosniff"}});
 }
 if(!["/api/deals/economics","/api/deals/proposals","/api/admin/deals","/api/admin/deals/status"].includes(path))return null;
 if(!sql&&path!=="/api/deals/economics")return json({error:"Data storage unavailable"},503);
 if(!sameOrigin(req))return json({error:"Origin mismatch"},403);
 if(req.method==="POST"&&limited(req))return json({error:"Too many submissions"},429);
 try{
  if(req.method==="POST"&&path==="/api/deals/economics"){
   const data=await readJson(req);
   return json({scenario:calculateDeal(dealInput(data))});
  }
  if(path.startsWith("/api/admin/deals")&&!operator(req))return json({error:"Unauthorized"},401);
  if(path==="/api/admin/deals"&&req.method==="GET"){
   await ensureDealsSchema(sql);
   const rows=await sql.unsafe("SELECT id,business,contact,email,category,checkout_url,model,face_cents,merchant_rate_bps,consumer_discount_bps,cashback_bps,referral_bps,processing_bps,reserve_bps,projected_contribution_cents,status,agreement_reference,created_at FROM localgift_merchant_deal_proposals ORDER BY created_at DESC LIMIT 100");
   const stats=await sql.unsafe("SELECT status,COUNT(*)::INT n FROM localgift_merchant_deal_proposals GROUP BY status");
   return json({proposals:rows,stage_counts:stats,actual_collected_sales_cents:0,source:"merchant_proposal_pipeline"});
  }
  if(path==="/api/admin/deals/status"&&req.method==="POST"){
   const b=await readJson(req),id=trim(b.id,48),state=trim(b.status,30),reference=trim(b.agreement_reference,250);
   if(!/^[a-f\d-]{36}$/i.test(id)||!["negotiating","agreement_documented","rejected"].includes(state))
    return json({error:"Invalid pipeline transition"},400);
   if(state==="agreement_documented"&&reference.length<8)
    return json({error:"An agreement reference is required before documenting authorization"},400);
   await ensureDealsSchema(sql);
   const rows=await sql.unsafe("UPDATE localgift_merchant_deal_proposals SET status=$1,agreement_reference=$2 WHERE id=$3 RETURNING id,status",[state,reference||null,id]);
   return rows.length?json({updated:true,id,status:rows[0].status,offer_active:false}):json({error:"Proposal not found"},404);
  }
  if(path==="/api/deals/proposals"&&req.method==="POST"){
   const b=await readJson(req);
   if(b.trap)return json({accepted:true},202);
   const business=trim(b.business,120),contact=trim(b.contact,100),mail=trim(b.email,254).toLowerCase(),category=trim(b.category,60),checkout=trim(b.checkout_url,500);
   if(business.length<2||contact.length<2||!validEmail(mail)||!["Coffee & treats","Food & dining","Experiences","Wellness","Shopping","Other local service"].includes(category)||!allowedCheckout(checkout)||b.consent!==true)
    return json({error:"Complete the business contact, category, valid HTTPS URL if supplied, and consent"},400);
   const data=dealInput(b),calc=calculateDeal(data),id=randomUUID();
   await ensureDealsSchema(sql);
   await sql.unsafe("INSERT INTO localgift_merchant_deal_proposals(id,business,contact,email,category,checkout_url,model,face_cents,merchant_rate_bps,consumer_discount_bps,cashback_bps,referral_bps,processing_bps,reserve_bps,projected_contribution_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [id,business,contact,mail,category,checkout||null,data.model,data.face_cents,data.merchant_rate_bps,data.consumer_discount_bps,data.cashback_bps,data.referral_bps,data.processing_bps,data.reserve_bps,calc.projected_contribution_cents]);
   return json({accepted:true,proposal_id:id,status:"new",scenario:calc,notes:"Request recorded for commercial review. No gift card is issued or sold; no cashback or referral amount is owed."},201);
  }
  return json({error:"Method not allowed"},405);
 }catch(err){
  if(err instanceof RangeError)return json({error:err.message},400);
  if(err instanceof SyntaxError)return json({error:"Invalid JSON submission"},400);
  console.error("localgift_deals",String((err as Error).message||err).slice(0,180));
  return json({error:"Request could not be saved"},503);
 }
}
