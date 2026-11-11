import {test,expect} from "bun:test";
import {routeNetwork} from "../src/features/network";
import {NETWORK_DDL} from "../src/db/network";
import {readFileSync} from "node:fs";

function dbFake(){
 const members:any[]=[],sessions:any[]=[],quests:any[]=[],sql:any={
  unsafe:async(statement:string,args:any[]=[])=>{
   if(/^(CREATE |ALTER )/.test(statement))return [];
   if(statement.startsWith("INSERT INTO localgift_members")){members.push({id:args[0],referral_code:args[1],referred_by:args[2]});return [];}
   if(statement.startsWith("INSERT INTO localgift_member_sessions")){sessions.push({hash:args[0],id:args[1]});return [];}
   if(statement.startsWith("SELECT id FROM localgift_members WHERE referral_code"))return members.filter(x=>x.referral_code===args[0]).map(x=>({id:x.id}));
   if(statement.includes("FROM localgift_member_sessions s JOIN")){const s=sessions.find(x=>x.hash===args[0]);const m=members.find(x=>x.id===s?.id);return m?[m]:[];}
   if(statement.startsWith("INSERT INTO localgift_member_quests")){if(quests.some(x=>x.member_id===args[0]&&x.quest===args[1]))return [];quests.push({member_id:args[0],quest:args[1],xp:20});return [{quest:args[1],xp:20}];}
   if(statement.startsWith("SELECT quest,xp,created_at FROM localgift_member_quests"))return quests.filter(x=>x.member_id===args[0]);
   if(statement.includes("FROM localgift_rewards WHERE member_id"))return [];
   if(statement.includes("COUNT(*)::INT n FROM localgift_members WHERE referred_by"))return [{n:members.filter(x=>x.referred_by===args[0]).length}];
   if(statement.includes("COUNT(*)::INT n FROM localgift_offer_clicks"))return [{n:0}];
   if(statement.includes("FROM localgift_resale_listings WHERE member_id"))return [];
   if(statement.includes("FROM localgift_network_offers o WHERE o.status='active'"))return [];
   if(statement.includes("FROM localgift_partners WHERE is_active"))return [];
   return [];
  }
 };
 sql.begin=async(fn:any)=>fn(sql);return sql;
}
async function post(path:string,body:any,headers:any={}){return new Request("https://example.com"+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});}
test("all premium commerce pages and static assets respond without a DB",async()=>{
 for(const path of ["/market","/club","/resale","/admin/network","/assets/network.css","/assets/network.js","/assets/network-admin.js"]){
  const r=await routeNetwork(new Request("http://localhost"+path),null);
  expect(r?.status).toBe(200);expect((await r!.text()).length).toBeGreaterThan(100);
 }
 expect((await routeNetwork(new Request("http://localhost/"),null))).toBe(null);
 const protectedPage=await routeNetwork(new Request("http://localhost/admin/network"),null);expect(protectedPage?.headers.get("x-robots-tag")).toContain("noindex");
});
test("schema keeps existing tables and separates member, offer, reward and resale ledgers",()=>{
 for(const table of ["localgift_members","localgift_member_sessions","localgift_member_quests","localgift_network_offers","localgift_offer_clicks","localgift_network_conversions","localgift_rewards","localgift_resale_listings","localgift_resale_inquiries"])
  expect(NETWORK_DDL.some(x=>x.includes(table))).toBe(true);
 expect(NETWORK_DDL.some(x=>x.includes("localgift_gift_previews ADD COLUMN IF NOT EXISTS member_id"))).toBe(true);
});
test("guest join sets a secure, HttpOnly cookie and referrals are single-level",async()=>{
 const db=dbFake();const a=await routeNetwork(await post("/api/network/join",{}),db);
 expect(a?.status).toBe(201);
 const cookie=a?.headers.get("set-cookie")||"";
 expect(cookie).toContain("HttpOnly");expect(cookie).toContain("Secure");expect(cookie).toContain("SameSite=Lax");
 const first=await a?.json();expect(first.member.referral_code.length).toBeGreaterThan(8);
 const sess=cookie.split(";")[0];
 const who=await routeNetwork(new Request("https://example.com/api/network/me",{headers:{cookie:sess}}),db);
 const mine=await who?.json();
 expect(mine.member.id).toBe(first.member.id);expect(mine.rewards.withdrawable_cents).toBe(0);
 const again=await routeNetwork(await post("/api/network/join",{}, {cookie:sess}),db);
 expect((await again?.json()).existing).toBe(true);
 const b=await routeNetwork(await post("/api/network/join",{ref:first.member.referral_code}),db);
 expect((await b?.json()).member.referred_by).toBe(first.member.id);
 const check=await routeNetwork(new Request("https://example.com/api/network/me",{headers:{cookie:sess}}),db);
 expect((await check?.json()).referrals).toBe(1);
});
test("club quests award idempotent noncash XP, not financial balances",async()=>{
 const db=dbFake(),joined=await routeNetwork(await post("/api/network/join",{}),db),cookie=joined!.headers.get("set-cookie")!.split(";")[0];
 const request=()=>post("/api/network/quests/complete",{quest:"explore"},{cookie});
 const a=await routeNetwork(await request(),db),b=await routeNetwork(await request(),db);
 expect((await a?.json()).earned_noncash_xp).toBe(20);
 expect((await b?.json()).earned_noncash_xp).toBe(0);
 const mine=await routeNetwork(new Request("https://example.com/api/network/me",{headers:{cookie}}),db);
 const data=await mine?.json();
 expect(data.xp).toBe(20);expect(data.rewards.withdrawable_cents).toBe(0);
});
test("shop offers API returns no pretend merchant if no approval exists",async()=>{
 const db=dbFake();const r=await routeNetwork(new Request("https://example.com/api/network/offers"),db);const data=await r?.json();
 expect(data.offers).toEqual([]);expect(data.real_merchant_count).toBe(0);
});
test("admin queue requires the original operator token",async()=>{
 const db=dbFake();const r=await routeNetwork(new Request("https://example.com/api/network/admin/queue"),db);
 expect(r?.status).toBe(401);
});
test("unauthenticated resale posting and cross-origin mutations are rejected",async()=>{
 const db=dbFake();
 const req=await post("/api/network/resale",{title:"Perfect chair",description:"Excellent shape no broken parts",asking_cents:2000,city:"Vancouver",category:"Home",condition:"Good",consent:true,seller_email:"a@example.ca"});
 const r=await routeNetwork(req,db);expect(r?.status).toBe(401);
 const origin=await routeNetwork(await post("/api/network/join",{},{"origin":"https://foreign.example"}),db);
 expect(origin?.status).toBe(403);
});
test("new server routing is installed ahead of legacy commerce and sitemap contains market",()=>{
 const server=readFileSync("src/server.ts","utf8");
 expect(server).toContain("const network=await routeNetwork(req,sql)");
 expect(server).toContain('"/market","/club","/resale"');
 expect(server).toContain('"/merchant-deals"');
});
