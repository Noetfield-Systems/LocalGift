import {test,expect} from "bun:test";
import {routeCommercial} from "../src/features/commercial";
test("Stripe webhook refuses payment events without signing secret",async()=>{
 const old=Bun.env.STRIPE_WEBHOOK_SECRET;
 Bun.env.STRIPE_WEBHOOK_SECRET="";
 const r=await routeCommercial(new Request("http://localhost/api/stripe/webhook",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:"evt_fake",type:"checkout.session.completed"})}),{});
 expect(r?.status).toBe(503);expect(await r?.json()).toMatchObject({error:"Webhook is not configured"});
 if(old)Bun.env.STRIPE_WEBHOOK_SECRET=old;else delete Bun.env.STRIPE_WEBHOOK_SECRET;
});