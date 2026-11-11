(()=>{
 const view=document.body.dataset.view;
 const $=(id)=>document.getElementById(id);
 const money=(c)=>new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(c||0)/100);
 async function api(path,method="GET",payload){const r=await fetch(path,{method,credentials:"same-origin",headers:payload?{"content-type":"application/json"}:{},body:payload?JSON.stringify(payload):undefined});let j;try{j=await r.json();}catch{throw Error("Service temporarily unavailable");}if(!r.ok)throw Error(j.error||"Request failed");return j;}
 const elt=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=String(txt);return e;};
 function button(text,fn,cls="btn sm"){const b=elt("button",cls,text);b.type="button";b.addEventListener("click",fn);return b;}
 async function ensureMember(ref=""){const old=await api("/api/network/me");if(old.member)return old.member;const joined=await api("/api/network/join","POST",{ref});return joined.member;}
 if(view==="market"){
  let all=[];const draw=()=>{
   const q=$("query").value.trim().toLowerCase(),cat=$("category").value,box=$("offers");box.replaceChildren();
   const matching=all.filter(x=>(cat==="all"||x.category===cat)&&(!q||(x.business+" "+x.description+" "+x.category).toLowerCase().includes(q)));
   $("marketStatus").textContent=matching.length+" verified issuer-linked listing"+(matching.length===1?"":"s")+(all.length?"":" · Founding collection underway");
   if(!matching.length){const e=elt("div","empty");e.append(elt("h3","head","Our founding collection is growing."),elt("p","muted","No issuer-approved gift-card offers match your search yet. We don't display invented shops or balances."));const a=elt("a","btn","Invite a merchant ↗");a.href="/merchant-deals";e.append(a);box.append(e);return;}
   for(const x of matching){const card=elt("article","listing"),top=elt("div","grow");
    top.append(elt("span","eyebrow",x.category),elt("h3",null,x.business),elt("p","muted",x.description));
    if(x.type==="offer"){top.append(elt("p","verified","Issuer approved · Official checkout"),elt("p","meta","Gift face value: "+money(x.face_cents)));if(x.discount)top.append(elt("span","pill",x.discount+"% issuer-funded customer discount"));}
    else top.append(elt("p","verified","Issuer-linked listing"),elt("p","small muted","Issued by: "+x.issuer));
    const a=button("Open official gift-card checkout ↗",async()=>{a.disabled=true;try{let url=x.checkout_url;if(x.type==="offer"){const t=await api("/api/network/offers/click","POST",{offer_id:x.id});url=t.checkout_url;}const u=new URL(url);if(u.protocol!=="https:")throw Error("Invalid issuer checkout");location.assign(u.href);}catch(err){$("marketStatus").textContent=err.message;a.disabled=false;}});
    card.append(top,a);box.append(card);
   }
  };
  $("query").addEventListener("input",draw);$("category").addEventListener("change",draw);
  api("/api/network/offers").then(d=>{all=[...(d.offers||[]).map(x=>({...x,type:"offer",discount:Number(x.consumer_discount_bps||0)/100})),...(d.issuer_links||[]).map(x=>({...x,business:x.name,type:"issuer"}))];draw();}).catch(err=>{$("marketStatus").textContent=err.message;});
 }
 if(view==="club"){
  let current=null;
  const load=async()=>{
   const d=await api("/api/network/me");current=d.member;
   $("join").textContent=current?"Club membership active ✓":"Join the club in one click ↗";$("join").disabled=!!current;
   $("joinStatus").textContent=current?"Your member account is stored in an HttpOnly device session.":"One click creates a device-linked club member; no password or payment required.";
   $("xp").textContent=d.xp||0;$("referrals").textContent=d.referrals||0;$("visits").textContent=d.issuer_checkout_visits||0;
   $("funded").textContent=money(d.rewards?.operator_recorded_funded_cents||0);$("withdraw").textContent=money(d.rewards?.withdrawable_cents||0);
   const link=current?new URL(d.referral_url,location.origin).href:"Join to unlock your link";
   $("refLink").value=link;$("copyRef").disabled=!current;
   const complete=new Set((d.quests||[]).map(q=>q.quest));document.querySelectorAll("[data-quest]").forEach(btn=>{const done=complete.has(btn.dataset.quest);btn.disabled=!current||done;btn.textContent=done?"Completed ✓":"Complete +20 XP";});
  };
  $("join").addEventListener("click",async()=>{const b=$("join");b.disabled=true;try{await ensureMember(new URLSearchParams(location.search).get("ref")||"");await load();}catch(err){$("joinStatus").textContent=err.message;b.disabled=false;}});
  $("copyRef").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("refLink").value);$("refStatus").textContent="Invite link copied.";}catch{$("refLink").select();$("refStatus").textContent="Copy the highlighted link."; }});
  document.querySelectorAll("[data-quest]").forEach(btn=>btn.addEventListener("click",async()=>{btn.disabled=true;try{const d=await api("/api/network/quests/complete","POST",{quest:btn.dataset.quest});$("questStatus").textContent=d.already_completed?"You already earned this noncash XP.":"20 noncash XP added to your club progress.";await load();}catch(err){$("questStatus").textContent=err.message;btn.disabled=false;}}));
  load().catch(err=>$("joinStatus").textContent=err.message);
 }
 if(view==="resale"){
  let items=[];const draw=()=>{
   const q=$("resaleSearch").value.toLowerCase().trim(),cat=$("resaleCategory").value,box=$("resaleResults");box.replaceChildren();
   const filtered=items.filter(x=>(cat==="all"||cat===x.category)&&(!q||(x.title+" "+x.description+" "+x.city).toLowerCase().includes(q)));
   $("resaleStatus").textContent=filtered.length+" reviewed local listing"+(filtered.length===1?"":"s");
   if(!filtered.length){const empty=elt("div","empty");empty.append(elt("h3","head","No approved listings yet."),elt("p","muted","Be among the first to submit a genuine local item; every listing is moderated before publication."));box.append(empty);return;}
   for(const x of filtered){const card=elt("article","listing"),detail=elt("div","grow");detail.append(elt("span","eyebrow",x.category+" · "+x.condition),elt("h3",null,x.title),elt("p","muted",x.description),elt("p","meta",x.city),elt("p","value",money(x.asking_cents)));const form=elt("form","form hide"),message=elt("textarea");message.placeholder="Introduce yourself and mention how you want to arrange a viewing. Do not send payment details.";message.required=true;message.minLength=15;message.maxLength=800;const submit=elt("button","btn sm","Send inquiry to operator queue");submit.type="submit";const notice=elt("p","status");form.append(message,submit,notice);form.addEventListener("submit",async(e)=>{e.preventDefault();submit.disabled=true;try{await ensureMember();const result=await api("/api/network/resale/inquiry","POST",{listing_id:x.id,message:message.value});notice.textContent="Inquiry saved in the operator relay queue. No money was transferred.";message.value="";}catch(err){notice.textContent=err.message;}finally{submit.disabled=false;}});const open=button("Ask about this item ↗",()=>form.classList.toggle("hide"));card.append(detail,open,form);box.append(card);}
  };
  $("resaleSearch").addEventListener("input",draw);$("resaleCategory").addEventListener("change",draw);
  api("/api/network/resale").then(d=>{items=d.listings||[];draw();}).catch(err=>$("resaleStatus").textContent=err.message);
  $("resaleForm").addEventListener("submit",async(e)=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector("button"),s=$("resaleFormStatus");b.disabled=true;s.textContent="Submitting…";try{await ensureMember();const d=Object.fromEntries(new FormData(f).entries());const price=Number(d.asking);d.asking_cents=Math.round(price*100);d.consent=f.elements.consent.checked;const response=await api("/api/network/resale","POST",d);s.textContent="Listing submitted for operator review. It is not public yet. Ref "+response.listing_id.slice(0,8)+".";f.reset();}catch(err){s.textContent=err.message;}finally{b.disabled=false;}});
 }
})();