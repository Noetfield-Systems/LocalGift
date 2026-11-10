import { createHmac, createHash, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";
import { ensureCommerceSchema } from "../db/commercial";
type Sql = any;
const TYPES = new Set(["discover_opened","partner_clicked","preview_shared","quest_opened","referral_opened","corporate_opened"]);
const pending = new Map<string,{time:number,count:number}>();
function response(body:any,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function clean(v:any,max=160){return String(v??"").trim().slice(0,max);}
export function email(v:any){const s=clean(v,254).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:null;}
function originOK(req:Request){const o=req.headers.get("origin");if(!o)return true;try{return new URL(o).host===new URL(req.url).host;}catch{return false;}}
function adminOK(req:Request){const token=clean((req.headers.get("authorization")||"").replace(/^Bearer /i,""),512);const secret=Bun.env.LOCALGIFT_ADMIN_TOKEN||"";return token.length>=32&&token.length===secret.length&&timingSafeEqual(Buffer.from(token),Buffer.from(secret));}
function throttle(req:Request){const ip=clean((req.headers.get("x-forwarded-for")||"anonymous").split(",")[0],100),now=Date.now();let item=pending.get(ip);if(pending.size>5000)pending.clear();if(!item||now-item.time>600000){item={time:now,count:0};pending.set(ip,item);}return ++item.count<=35;}
async function body(req:Request){if(!(req.headers.get("content-type")||"").startsWith("application/json"))throw new Error("JSON_REQUIRED");if(Number(req.headers.get("content-length")||0)>14000)throw new Error("TOO_LARGE");const raw=await req.text();if(raw.length>14000)throw new Error("TOO_LARGE");return JSON.parse(raw||"{}");}
async function page(name:string){const html=await Bun.file(new URL("../pages/"+name+".html",import.meta.url)).text();const route=({merchant:"/for-merchants",corporate:"/corporate",quests:"/quests",discover:"/discover",create:"/create",portal:"/merchant/portal"} as Record<string,string>)[name]||"/";const canonical="https://localgift-web-production.up.railway.app"+route;return new Response(html.replace("</head>",'<link rel="canonical" href="'+canonical+'"></head>'),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=120","x-content-type-options":"nosniff"}});}
function hash(v:string){return createHash("sha256").update(v).digest("hex");}
async function account(req:Request,sql:Sql){const token=(req.headers.get("authorization")||"").replace(/^Bearer /i,"").trim();if(token.length<32||token.length>256)return null;const rows=await sql.unsafe("SELECT id,business,email FROM localgift_merchant_accounts WHERE token_hash=$1 LIMIT 1",[hash(token)]);return rows[0]||null;}
function stripeValid(raw:string,sig:string,secret:string){const parts=Object.fromEntries(sig.split(",").map(p=>p.trim().split("=")));const time=Number(parts.t),v1=parts.v1;if(!Number.isFinite(time)||Math.abs(Date.now()/1000-time)>300||!v1||!/^[a-f0-9]{64}$/i.test(v1))return false;const actual=createHmac("sha256",secret).update(String(time)+"."+raw).digest("hex");return timingSafeEqual(Buffer.from(actual),Buffer.from(v1));}
async function stripeWebhook(req:Request,sql:Sql){
 const secret=Bun.env.STRIPE_WEBHOOK_SECRET;
 if(!secret)return response({error:"Webhook is not configured"},503);
 const raw=await req.text();
 if(raw.length>1500000||!stripeValid(raw,req.headers.get("stripe-signature")||"",secret))return response({error:"Invalid signature"},400);
 const event=JSON.parse(raw);if(!event.id||!event.type)return response({error:"Malformed event"},400);
 await ensureCommerceSchema(sql);
 const type=event.type,obj=event.data?.object||{};
 if(type==="charge.refunded"){
  const pi=clean(obj.payment_intent,160);if(!pi)return response({received:true,applied:false});
  await sql.begin(async(tx:any)=>{
   const n=await tx.unsafe("INSERT INTO localgift_payment_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",[event.id,type]);if(!n.length)return;
   const found=await tx.unsafe("UPDATE localgift_service_orders SET status='refunded' WHERE stripe_payment_intent=$1 AND status='paid' RETURNING id",[pi]);
   for(const o of found)await tx.unsafe("UPDATE localgift_fulfillment_tasks SET state='review_refund' WHERE order_id=$1 AND state='open'",[o.id]);
  });return response({received:true});
 }
 if(type!=="checkout.session.completed"&&type!=="checkout.session.async_payment_succeeded"&&type!=="checkout.session.expired")return response({received:true,applied:false});
 const id=String(obj.metadata?.localgift_order_id||obj.client_reference_id||"");
 if(!/^[a-f0-9-]{36}$/i.test(id)||obj.currency!=="cad"||obj.amount_total!==14900||obj.mode!=="payment")return response({received:true,applied:false});
 const linkId=Bun.env.LOCALGIFT_STARTER_PAYMENT_LINK_ID||"";
 await sql.begin(async(tx:any)=>{
  const n=await tx.unsafe("INSERT INTO localgift_payment_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",[event.id,type]);if(!n.length)return;
  const rows=await tx.unsafe("SELECT id,status,stripe_session_id FROM localgift_service_orders WHERE id=$1 AND package='starter' AND amount_cents=14900 FOR UPDATE",[id]);
  if(!rows.length)throw Error("ORDER_NOT_FOUND");
  const o=rows[0],matchingSession=o.stripe_session_id===obj.id,matchingLink=!!linkId&&obj.payment_link===linkId&&o.status==="checkout_created"&&!o.stripe_session_id&&obj.client_reference_id===id;
  if(!matchingSession&&!matchingLink)throw Error("SESSION_ORDER_MISMATCH");
  if(type==="checkout.session.expired"){if(o.status==="checkout_created")await tx.unsafe("UPDATE localgift_service_orders SET status='cancelled' WHERE id=$1",[id]);return;}
  if(obj.payment_status!=="paid"||o.status==="refunded")return;
  await tx.unsafe("UPDATE localgift_service_orders SET status='paid',stripe_payment_intent=$1,stripe_session_id=COALESCE(stripe_session_id,$2),paid_at=COALESCE(paid_at,NOW()) WHERE id=$3",[clean(obj.payment_intent,160),obj.id,id]);
  await tx.unsafe("INSERT INTO localgift_fulfillment_tasks(id,order_id,kind) VALUES($1,$2,'merchant_launch_setup') ON CONFLICT(order_id) DO NOTHING",[randomUUID(),id]);
 });return response({received:true});
}
export async function routeCommercial(req:Request,sql:Sql|null):Promise<Response|null>{
 const path=new URL(req.url).pathname;
 if(req.method==="GET"&&path==="/assets/commercial.css")return new Response(await Bun.file(new URL("../pages/commercial.css",import.meta.url)).text(),{headers:{"content-type":"text/css; charset=utf-8","cache-control":"public, max-age=300"}});
 if(req.method==="GET"&&["/for-merchants","/corporate","/quests","/discover","/create","/merchant/portal"].includes(path))return page(({"/for-merchants":"merchant","/corporate":"corporate","/quests":"quests","/discover":"discover","/create":"create","/merchant/portal":"portal"} as Record<string,string>)[path]);
 if(req.method==="GET"&&path==="/vancouver-digital-gift-cards")return Response.redirect(new URL("/discover",req.url),302);
 if(req.method==="GET"&&path.startsWith("/gift/")){
   if(!sql)return response({error:"Gift previews unavailable"},503);
   const id=path.slice(6);if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Not found"},404);
   await ensureCommerceSchema(sql);const rows=await sql.unsafe("SELECT recipient,sender,message,design,amount FROM localgift_gift_previews WHERE id=$1",[id]);if(!rows.length)return response({error:"Not found"},404);
   const raw=await Bun.file(new URL("../pages/reveal.html",import.meta.url)).text();const safe=(v:any)=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[c]);
   let html=raw;for(const [k,v] of Object.entries(rows[0]))html=html.replaceAll("{{"+k+"}}",safe(v));return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-robots-tag":"noindex,nofollow"}});
 }
 if(req.method==="POST"&&path==="/api/stripe/webhook"){if(!sql)return response({error:"Database unavailable"},503);try{return await stripeWebhook(req,sql);}catch(err){console.error("localgift_stripe_webhook",String(err).slice(0,120));return response({error:"Webhook not processed"},500);}}
 if(!path.startsWith("/api/commercial/")&&!path.startsWith("/api/corporate/")&&!path.startsWith("/api/gift-previews")&&!path.startsWith("/api/merchant/")&&!path.startsWith("/api/admin/commercial")&&!path.startsWith("/api/ops/summary"))return null;
 if(!sql)return response({error:"Database is not configured"},503);
 if(req.method==="POST"&&(!originOK(req)||!throttle(req)))return response({error:"Request rejected"},429);
 try{
 await ensureCommerceSchema(sql);
 if(req.method==="GET"&&path==="/api/commercial/catalog"){const rows=await sql.unsafe("SELECT name,category,description,issuer,checkout_url FROM localgift_partners WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 100");return response({partners:rows});}
 if(req.method==="GET"&&path==="/api/admin/commercial/queue"){if(!adminOK(req))return response({error:"Unauthorized"},401);const [orders,corporate,tasks,requests]=await Promise.all([sql.unsafe("SELECT id,business,contact,email,status,amount_cents,created_at,paid_at FROM localgift_service_orders ORDER BY created_at DESC LIMIT 100"),sql.unsafe("SELECT id,company,contact,email,recipients,budget_cad,occasion,status,created_at FROM localgift_corporate_inquiries ORDER BY created_at DESC LIMIT 100"),sql.unsafe("SELECT t.id,t.order_id,t.kind,t.state,t.created_at,o.business,o.contact,o.email FROM localgift_fulfillment_tasks t JOIN localgift_service_orders o ON o.id=t.order_id WHERE t.state=\x27open\x27 ORDER BY t.created_at DESC LIMIT 100"),sql.unsafe("SELECT r.id,r.kind,r.details,r.status,r.created_at,a.business FROM localgift_merchant_requests r JOIN localgift_merchant_accounts a ON a.id=r.account_id ORDER BY r.created_at DESC LIMIT 100")]);return response({orders,corporate_inquiries:corporate,fulfillment_tasks:tasks,merchant_requests:requests});}
 if(req.method==="GET"&&(path==="/api/admin/commercial"||path==="/api/ops/summary")){
  if(!adminOK(req))return response({error:"Unauthorized"},401);
  const [orders,corporate,previews,events,merchants,fulfill,interest,applications]=await Promise.all([
   sql.unsafe("SELECT status,COUNT(*)::INT n,COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0)::BIGINT gross_cents FROM localgift_service_orders GROUP BY status"),
   sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_corporate_inquiries"),
   sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_gift_previews"),
   sql.unsafe("SELECT type,COUNT(*)::INT n FROM localgift_product_events GROUP BY type"),
   sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_partners WHERE is_active=TRUE"),
   sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_fulfillment_tasks WHERE state='open'"),
   sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_interest"),
   sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_merchant_leads")
  ]);
  return response({product_id:"localgift",merchant_applications:applications[0].n,active_verified_merchants:merchants[0].n,consumer_launch_interest:interest[0].n,gift_previews:previews[0].n,corporate_inquiries:corporate[0].n,service_orders:orders,product_events:events,open_fulfillment_tasks:fulfill[0].n,gross_confirmed_service_collections_cents:orders.reduce((a:number,x:any)=>a+Number(x.gross_cents||0),0),net_collected_revenue_cents:null,currency:"CAD",source:"database",next_action:"Contact qualified merchant applicants and fulfill paid setup orders"});
 }
 if(req.method==="GET"&&path==="/api/merchant/me"){const a=await account(req,sql);return a?response({merchant:a}):response({error:"Unauthorized"},401);}
 if(req.method==="GET"&&path==="/api/merchant/requests"){const a=await account(req,sql);if(!a)return response({error:"Unauthorized"},401);const rows=await sql.unsafe("SELECT id,kind,details,status,created_at FROM localgift_merchant_requests WHERE account_id=$1 ORDER BY created_at DESC LIMIT 30",[a.id]);return response({requests:rows});}
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 const b=await body(req);
 if(path==="/api/corporate/inquiries"){const company=clean(b.company,120),contact=clean(b.contact,100),em=email(b.email),recipients=Number(b.recipients),budget=Number(b.budget_cad||0);if(company.length<2||contact.length<2||!em||!Number.isInteger(recipients)||recipients<1||recipients>100000||budget<0||budget>10000000||b.consent!==true)return response({error:"Please enter your business details and consent"},400);const id=randomUUID();await sql.unsafe("INSERT INTO localgift_corporate_inquiries(id,company,contact,email,recipients,budget_cad,occasion,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[id,company,contact,em,recipients,budget||null,clean(b.occasion,80),clean(b.details,1000)]);return response({accepted:true,id,status:"inquiry_recorded"},201);}
 if(path==="/api/gift-previews"){const recipient=clean(b.recipient,80),sender=clean(b.sender,80),message=clean(b.message,300),amount=Number(b.amount),design=clean(b.design,24);if(recipient.length<1||sender.length<1||!message||![25,50,75,100].includes(amount)||!["forest","lilac","coral"].includes(design))return response({error:"Please complete the preview"},400);const id=randomUUID();await sql.unsafe("INSERT INTO localgift_gift_previews(id,recipient,sender,message,amount,design) VALUES($1,$2,$3,$4,$5,$6)",[id,recipient,sender,message,amount,design]);return response({created:true,url:"/gift/"+id,non_monetary_preview:true},201);}
 if(path==="/api/commercial/events"){const type=clean(b.type,50),context=clean(b.context,140);if(!TYPES.has(type))return response({error:"Unsupported event"},400);await sql.unsafe("INSERT INTO localgift_product_events(id,type,context) VALUES($1,$2,$3)",[randomUUID(),type,context||null]);return response({accepted:true},201);}
 if(path==="/api/commercial/checkout"){const business=clean(b.business,120),contact=clean(b.contact,120),em=email(b.email);if(business.length<2||contact.length<2||!em||b.package!=="starter"||b.consent!==true)return response({error:"Valid business, contact, email, and Starter package are required"},400);const id=randomUUID();await sql.unsafe("INSERT INTO localgift_service_orders(id,business,contact,email,package,amount_cents,currency) VALUES($1,$2,$3,$4,'starter',14900,'cad')",[id,business,contact,em]);if(!Bun.env.STRIPE_SECRET_KEY){
 const str=Bun.env.LOCALGIFT_STARTER_PAYMENT_LINK_URL||"";let link:URL|null=null;
 try{const u=new URL(str);if(u.protocol==="https:"&&u.hostname==="buy.stripe.com"&&u.pathname.length>1)link=u;}catch{}
 if(link&&Bun.env.LOCALGIFT_STARTER_PAYMENT_LINK_ID){link.searchParams.set("client_reference_id",id);await sql.unsafe("UPDATE localgift_service_orders SET status='checkout_created' WHERE id=$1",[id]);return response({order_id:id,status:"checkout_created",checkout_enabled:true,url:link.toString()},201);}
 await sql.unsafe("UPDATE localgift_service_orders SET status='payment_unavailable' WHERE id=$1",[id]);
 return response({order_id:id,status:"payment_unavailable",checkout_enabled:false,message:"Application received. Online payment is not yet configured; no charge has been made."},202);
}const base=Bun.env.LOCALGIFT_PUBLIC_URL||"https://localgift-web-production.up.railway.app";const form=new URLSearchParams({"mode":"payment","client_reference_id":id,"line_items[0][price_data][currency]":"cad","line_items[0][price_data][unit_amount]":"14900","line_items[0][price_data][product_data][name]":"LocalGift Merchant Starter Launch","line_items[0][quantity]":"1","success_url":base+"/for-merchants?checkout=return","cancel_url":base+"/for-merchants?checkout=cancel","customer_email":em,"metadata[localgift_order_id]":id,"metadata[localgift_kind]":"merchant_launch_setup"});const r=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{"authorization":"Bearer "+Bun.env.STRIPE_SECRET_KEY,"content-type":"application/x-www-form-urlencoded"},body:form});const session=await r.json();if(!r.ok||!session.id||!/^https:\/\//.test(session.url||"")){console.error("localgift_stripe_session_create_failed",r.status);return response({order_id:id,status:"payment_unavailable",checkout_enabled:false,message:"Order saved but payment is not available."},503);}await sql.unsafe("UPDATE localgift_service_orders SET status='checkout_created',stripe_session_id=$1 WHERE id=$2",[session.id,id]);return response({order_id:id,status:"checkout_created",checkout_enabled:true,url:session.url},201);}
 if(path==="/api/admin/commercial/invite"){if(!adminOK(req))return response({error:"Unauthorized"},401);const leadId=clean(b.lead_id,50);if(!/^[a-f0-9-]{36}$/i.test(leadId))return response({error:"Lead ID required"},400);const leads=await sql.unsafe("SELECT id,business,email FROM localgift_merchant_leads WHERE id=$1",[leadId]);if(!leads.length)return response({error:"Lead not found"},404);const token=randomBytes(32).toString("hex"),id=randomUUID(),lead=leads[0];await sql.unsafe("INSERT INTO localgift_merchant_accounts(id,lead_id,business,email,token_hash) VALUES($1,$2,$3,$4,$5)",[id,leadId,lead.business,lead.email,hash(token)]);return response({merchant_id:id,access_token_once:token,delivery:"operator_must_send_securely"},201);}
 if(path==="/api/merchant/requests"){const a=await account(req,sql);if(!a)return response({error:"Unauthorized"},401);const kind=clean(b.kind,20),details=clean(b.details,1200);if(!["listing","campaign"].includes(kind)||details.length<12)return response({error:"Choose a request type and provide details"},400);const id=randomUUID();await sql.unsafe("INSERT INTO localgift_merchant_requests(id,account_id,kind,business,details) VALUES($1,$2,$3,$4,$5)",[id,a.id,kind,a.business,details]);return response({created:true,id,status:"pending_review"},201);}
 return response({error:"Not found"},404);
 }catch(err){console.error("localgift_commerce",String((err as Error).message||err).slice(0,150));return response({error:(err as Error).message==="JSON_REQUIRED"?"JSON body required":(err as Error).message==="TOO_LARGE"?"Request too large":"Request could not be processed"},(err as Error).message==="JSON_REQUIRED"?415:(err as Error).message==="TOO_LARGE"?413:503);}
}
