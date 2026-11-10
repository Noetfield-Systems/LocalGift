import { ensureBaselineSchema } from "./db/baseline";
const PAGE = await Bun.file(new URL("./pages/home.html", import.meta.url)).text();
const PRIVACY = await Bun.file(new URL("./pages/privacy.html", import.meta.url)).text();
const TERMS = await Bun.file(new URL("./pages/terms.html", import.meta.url)).text();

const ADMINPAGE = await Bun.file(new URL("./pages/operator.html", import.meta.url)).text();
import postgres from "postgres";
import { timingSafeEqual } from "node:crypto";
const sql = Bun.env.DATABASE_URL ? postgres(Bun.env.DATABASE_URL, {max:3,connect_timeout:7,idle_timeout:20}) : null;
let initPromise = null;
const ipLimits = new Map();
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"strict-origin-when-cross-origin"}});}
function safe(s,max=180){return String(s||"").trim().slice(0,max);}
function validEmail(s){return typeof s==="string"&&s.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);}
function allowedURL(v){if(!v)return true;try{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password&&u.hostname.includes(".");}catch{return false;}}
function rate(req){const ip=safe(req.headers.get("x-forwarded-for")||"unknown",90).split(",")[0];const now=Date.now();const old=ipLimits.get(ip);if(ipLimits.size>8000)ipLimits.clear();if(!old||now-old.since>900000){ipLimits.set(ip,{since:now,n:1});return true;}old.n++;return old.n<=10;}
async function db(){if(!sql)throw Error("STORE_NOT_CONFIGURED");if(!initPromise)initPromise=ensureBaselineSchema(sql);try{await initPromise;}catch(e){initPromise=null;throw e;}return sql;}
function equal(a,b){if(!a||!b||a.length!==b.length||a.length<32)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
async function readBody(req){if((req.headers.get("content-type")||"").split(";")[0]!=="application/json")throw Error("JSON_REQUIRED");if(Number(req.headers.get("content-length")||0)>7000)throw Error("TOO_LARGE");const raw=await req.text();if(raw.length>7000)throw Error("TOO_LARGE");return JSON.parse(raw||"{}");}
function crossCheck(req){const origin=req.headers.get("origin");if(!origin)return true;try{return new URL(origin).host===new URL(req.url).host;}catch{return false;}}
const PORT=Number(Bun.env.PORT||3000);
Bun.serve({port:PORT,hostname:"0.0.0.0",async fetch(req){
 const path=new URL(req.url).pathname;
 try{
 if(req.method==="GET"&&path==="/")return new Response(PAGE,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=300","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"strict-origin-when-cross-origin"}});
 if(req.method==="GET"&&path==="/admin")return new Response(ADMINPAGE,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex,nofollow"}});
 if(req.method==="GET"&&path==="/privacy")return new Response(PRIVACY,{headers:{"content-type":"text/html; charset=utf-8"}});
 if(req.method==="GET"&&path==="/terms")return new Response(TERMS,{headers:{"content-type":"text/html; charset=utf-8"}});
 if(req.method==="GET"&&path==="/robots.txt")return new Response("User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nSitemap: https://localgift-web-production.up.railway.app/sitemap.xml",{headers:{"content-type":"text/plain; charset=utf-8"}});
 if(req.method==="GET"&&path==="/sitemap.xml")return new Response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://localgift-web-production.up.railway.app/</loc></url><url><loc>https://localgift-web-production.up.railway.app/terms</loc></url><url><loc>https://localgift-web-production.up.railway.app/privacy</loc></url></urlset>',{headers:{"content-type":"application/xml; charset=utf-8"}});
 if(req.method==="GET"&&path==="/health"){await db();await sql.unsafe("SELECT 1");return json({ok:true,project:"localgift-vancouver",database:"connected",gift_cards_issued:0,card_sales_enabled:false});}
 if(req.method==="GET"&&path==="/api/partners"){await db();const rows=await sql.unsafe("SELECT name,category,description,issuer,checkout_url FROM localgift_partners WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 100");return json({partners:rows});}
 if(req.method==="GET"&&path==="/api/admin/leads"){
 const auth=safe(req.headers.get("authorization")||"",256).replace(/^Bearer /i,"");
 if(!equal(auth,Bun.env.LOCALGIFT_ADMIN_TOKEN||""))return json({error:"Unauthorized"},401);
 await db();const merchants=await sql.unsafe("SELECT business,contact,email,website,platform,city,created_at FROM localgift_merchant_leads ORDER BY created_at DESC LIMIT 100");
 return json({merchants});
 }
 if(req.method==="GET"&&path==="/api/admin/partners"){
 const auth=safe(req.headers.get("authorization")||"",256).replace(/^Bearer /i,"");
 if(!equal(auth,Bun.env.LOCALGIFT_ADMIN_TOKEN||""))return json({error:"Unauthorized"},401);
 await db();const partners=await sql.unsafe("SELECT id,name,issuer,category,checkout_url,is_active,created_at FROM localgift_partners ORDER BY created_at DESC LIMIT 100");
 return json({partners});
 }
 if(req.method==="POST"){
 if(!crossCheck(req))return json({error:"Origin mismatch"},403);
 if(!rate(req))return json({error:"Too many requests. Please try again later."},429);
 const b=await readBody(req);
 if(path==="/api/interest"){
 if(b.website)return json({accepted:true});
 const email=safe(b.email,254).toLowerCase(),category=safe(b.category,80),amount=Number(b.amount);
 if(!validEmail(email)||![25,50,75,100].includes(amount)||!["Coffee & treats","Food & dining","Experiences","Wellness"].includes(category)||b.consent!==true)return json({error:"Please provide a valid email, category and consent."},400);
 await db();await sql.unsafe("INSERT INTO localgift_interest (id,email,category,amount) VALUES ($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET category=EXCLUDED.category,amount=EXCLUDED.amount",[crypto.randomUUID(),email,category,amount]);
 return json({accepted:true,status:"launch_interest_saved"},201);
 }
 if(path==="/api/merchants"){
 if(b.trap)return json({accepted:true});
 const contact=safe(b.contact,90),business=safe(b.business,110),email=safe(b.email,254).toLowerCase(),website=safe(b.website,350),platform=safe(b.platform,20),city=safe(b.city,60);
 if(contact.length<2||business.length<2||!validEmail(email)||!allowedURL(website)||!["square","shopify","other","none"].includes(platform)||!["Vancouver","Burnaby","Richmond","North Vancouver","Surrey","Other Metro Vancouver"].includes(city)||b.consent!==true)return json({error:"Please complete the business details and consent."},400);
 await db();await sql.unsafe("INSERT INTO localgift_merchant_leads(id,contact,business,email,website,platform,city) VALUES($1,$2,$3,$4,$5,$6,$7)",[crypto.randomUUID(),contact,business,email,website||null,platform,city]);return json({accepted:true,status:"merchant_application_saved"},201);
 }
 if(path==="/api/admin/partners/deactivate"){
 const auth=safe(req.headers.get("authorization")||"",256).replace(/^Bearer /i,"");
 if(!equal(auth,Bun.env.LOCALGIFT_ADMIN_TOKEN||""))return json({error:"Unauthorized"},401);
 const id=safe(b.id,60);
 if(!/^[a-f0-9-]{36}$/.test(id))return json({error:"Invalid listing ID"},400);
 await db();const r=await sql.unsafe("UPDATE localgift_partners SET is_active=FALSE WHERE id=$1 RETURNING id",[id]);
 return json({deactivated:r.length===1});
 }
 if(path==="/api/admin/partners"){
 const auth=safe(req.headers.get("authorization")||"",256).replace(/^Bearer /i,"");
 if(!equal(auth,Bun.env.LOCALGIFT_ADMIN_TOKEN||""))return json({error:"Unauthorized"},401);
 const name=safe(b.name,120),category=safe(b.category,80),issuer=safe(b.issuer,120),description=safe(b.description,220),url=safe(b.checkout_url,500);
 if(name.length<3||issuer.length<3||!allowedURL(url)||!url.startsWith("https://")||!b.confirmed_issuer_authorized)return json({error:"Active issuer, verifiable HTTPS checkout and documented issuer authorization required."},400);
 await db();await sql.unsafe("INSERT INTO localgift_partners(id,name,category,description,issuer,checkout_url,is_active) VALUES ($1,$2,$3,$4,$5,$6,TRUE)",[crypto.randomUUID(),name,category,description,issuer,url]);return json({created:true,issuer},201);
 }
 return json({error:"Not found"},404);
 }
 if(req.method==="GET"&&path==="/api/admin/stats"){
 const auth=safe(req.headers.get("authorization")||"",256).replace(/^Bearer /i,"");
 if(!equal(auth,Bun.env.LOCALGIFT_ADMIN_TOKEN||""))return json({error:"Unauthorized"},401);
 await db();const [a,b,c]=await Promise.all([sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_interest"),sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_merchant_leads"),sql.unsafe("SELECT COUNT(*)::INT n FROM localgift_partners WHERE is_active=TRUE")]);return json({launch_interests:a[0].n,merchant_applications:b[0].n,active_partners:c[0].n,cash_revenue_verified:false});
 }
 return json({error:"Not found"},404);
 }catch(e){console.error("localgift_error",String(e?.message||e).slice(0,120));if(String(e?.message)==="TOO_LARGE")return json({error:"Request too large"},413);if(String(e?.message)==="JSON_REQUIRED")return json({error:"JSON required"},415);return json({error:"Request could not be processed."},503);}
}});


setTimeout(async()=>{
 const paths=["/","/health","/api/partners"];
 const checks=[];
 for(const path of paths){
   try {const r=await fetch("http://127.0.0.1:"+PORT+path,{signal:AbortSignal.timeout(6000)});checks.push({path,status:r.status});}
   catch(e){checks.push({path,error:String(e?.message||e).slice(0,120)});}
 }
 try {
  const r=await fetch("http://127.0.0.1:"+PORT+"/api/interest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"bad-email",category:"Coffee & treats",amount:50,consent:true})});
  checks.push({path:"/api/interest invalid-email rejection",status:r.status});
 }catch(e){checks.push({path:"invalid-input",error:String(e?.message||e).slice(0,120)});}
 console.log("LOCALGIFT_STARTUP_SELF_CHECK",JSON.stringify(checks));
},1800).unref?.();
