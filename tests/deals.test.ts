import {test,expect} from "bun:test";
import {calculateDeal} from "../src/features/deal-economics";
import {routeDeals} from "../src/features/deals";
const base={model:"merchant_commission" as const,face_cents:10000,merchant_rate_bps:1200,consumer_discount_bps:0,cashback_bps:400,referral_bps:100,processing_bps:270,reserve_bps:50};
test("revenue-first 100 CAD commission example preserves the true 3.80 CAD contribution",()=>{
 const d=calculateDeal(base);
 expect(d.platform_spread_cents).toBe(1200);
 expect(d.cashback_cents).toBe(400);
 expect(d.referral_cents).toBe(100);
 expect(d.processing_assumption_cents).toBe(270);
 expect(d.reserve_assumption_cents).toBe(50);
 expect(d.projected_contribution_cents).toBe(380);
 expect(d.cash_revenue_verified).toBe(false);
 expect(d.payout_authorized).toBe(false);
});
test("wholesale math includes the buyer discount and processing on actual charge",()=>{
 const d=calculateDeal({...base,model:"wholesale_resale",merchant_rate_bps:1000,consumer_discount_bps:300,cashback_bps:100,referral_bps:50});
 expect(d.issuer_proceeds_cents).toBe(9000);
 expect(d.consumer_charge_cents).toBe(9700);
 expect(d.projected_contribution_cents).toBe(239);
});
test("no negative, excessive, fractional or nonnumeric face/rates",()=>{
 for(const bad of [-1,0,2499,1000001,10000.5,NaN,Infinity,"10000"])
  expect(()=>calculateDeal({...base,face_cents:bad as number})).toThrow();
 for(const bad of [-100,501,501.5,"20",Infinity])
  expect(()=>calculateDeal({...base,referral_bps:bad as number})).toThrow();
});
test("deal studio route works without a database and never makes a money claim",async()=>{
 const page=await routeDeals(new Request("http://localhost/merchant-deals"),null);
 expect(page?.status).toBe(200);
 expect(await page?.text()).toContain("Merchant Deal Studio");
 const unauthorized=await routeDeals(new Request("http://localhost/api/admin/deals"),{});
 expect(unauthorized?.status).toBe(401);
 const noDb=await routeDeals(new Request("http://localhost/api/deals/proposals",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),null);
 expect(noDb?.status).toBe(503);
});
test("economics API calculates server-side without a paid order",async()=>{
 const r=await routeDeals(new Request("http://localhost/api/deals/economics",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(base)}),null);
 expect(r?.status).toBe(200);
 expect((await r?.json()).scenario.projected_contribution_cents).toBe(380);
});

test("merchant proposal is captured with server-calculated economics, not a fictitious sale",async()=>{
 const calls:Array<{statement:string,args:any[]}>=[],sql={unsafe:async(statement:string,args:any[]=[])=>{calls.push({statement,args});return [];}};
 const proposal={
  model:"merchant_commission",face_cents:10000,merchant_rate_bps:1200,
  consumer_discount_bps:0,cashback_bps:400,referral_bps:100,processing_bps:270,reserve_bps:50,
  business:"Actual merchant example",contact:"Owner",email:"owner@example.ca",category:"Food & dining",
  checkout_url:"https://merchant.example.ca/gift",consent:true
 };
 const res=await routeDeals(new Request("http://localhost/api/deals/proposals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(proposal)}),sql);
 expect(res?.status).toBe(201);
 const data=await res?.json();
 expect(data.status).toBe("new");expect(data.scenario.projected_contribution_cents).toBe(380);
 expect(data.scenario.cash_revenue_verified).toBe(false);
 const insert=calls.find(x=>x.statement.startsWith("INSERT INTO localgift_merchant_deal_proposals"));
 expect(insert).toBeDefined();
 expect(insert!.args).toContain(380);
 expect(calls.some(x=>x.statement.startsWith("INSERT INTO localgift_merchant_deal_proposals"))).toBe(true);
});
test("seller intake rejects non-consenting, incomplete and cross-origin proposals",async()=>{
 const sql={unsafe:async()=>[]};
 const bad=await routeDeals(new Request("http://localhost/api/deals/proposals",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"x@y.ca"})}),sql);
 expect(bad?.status).toBe(400);
 const cross=await routeDeals(new Request("http://localhost/api/deals/economics",{method:"POST",headers:{"origin":"https://evil.example","content-type":"application/json"},body:"{}"}),null);
 expect(cross?.status).toBe(403);
});
