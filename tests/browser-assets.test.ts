import {test,expect} from "bun:test";
import {readFileSync} from "node:fs";
test("both premium browser bundles parse in JS without syntax errors",()=>{
 for(const file of ["src/pages/network.js","src/pages/network-admin.js"]){
  const source=readFileSync(file,"utf8");
  expect(()=>new Function(source)).not.toThrow();
  expect(source).toContain("fetch(");
 }
});
test("premium paths contain usable navigation, accessibility and real forms",()=>{
 for(const page of ["market","club","resale"]){
  const html=readFileSync("src/pages/"+page+".html","utf8");
  expect(html).toContain('name="viewport"');
  expect(html).toContain('id="main"');
  expect(html).toContain("/assets/network.js");
  expect(html).toContain("/assets/network.css");
  expect(html).toContain("LocalGift");
 }
 const market=readFileSync("src/pages/market.html","utf8");
 expect(market).toContain('id="offers"');
 expect(market).toContain('id="category"');
 const club=readFileSync("src/pages/club.html","utf8");
 expect(club).toContain('id="join"');
 expect(club).toContain('id="refLink"');
 const resale=readFileSync("src/pages/resale.html","utf8");
 expect(resale).toContain('name="seller_email"');
 expect(resale).toContain('id="resaleForm"');
});
test("private ops is nonindexed and the public browser never reads credentials",()=>{
 const html=readFileSync("src/pages/network-admin.html","utf8");
 expect(html).toContain("noindex,nofollow");
 const js=readFileSync("src/pages/network.js","utf8");
 expect(js).not.toContain("LOCALGIFT_ADMIN_TOKEN");
 expect(js).not.toContain("STRIPE_SECRET_KEY");
});
