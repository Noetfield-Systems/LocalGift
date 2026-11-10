/**
 * Pure underwriting math for merchant-funded gift-card distribution proposals.
 * These amounts are hypothetical; there is no sale, wallet credit or payout.
 * Every rate is a percentage of gift-card face value except processing/reserve,
 * which apply to the consumer's actual projected charge.
 */
export type DealModel = "merchant_commission" | "wholesale_resale";
export type DealInput = {
  model:DealModel;
  face_cents:number;
  merchant_rate_bps:number;
  consumer_discount_bps:number;
  cashback_bps:number;
  referral_bps:number;
  processing_bps:number;
  reserve_bps:number;
};
export type DealResult = ReturnType<typeof calculateDeal>;

function asInteger(value:unknown,name:string,min:number,max:number):number{
  if(typeof value!=="number" || !Number.isSafeInteger(value)||value<min||value>max)
    throw new RangeError(name+" must be an integer from "+min+" to "+max);
  return value;
}
function rate(value:unknown,name:string,max:number):number {
  return asInteger(value,name,0,max);
}
function percentCents(amount:number,bps:number):number{return Math.round(amount*bps/10000);}
export function calculateDeal(data:DealInput){
  if(data.model!=="merchant_commission"&&data.model!=="wholesale_resale")
    throw new RangeError("Unsupported merchant funding model");
  const face=asInteger(data.face_cents,"face_cents",2500,1000000);
  const merchantRate=rate(data.merchant_rate_bps,"merchant_rate_bps",5000);
  const discountRate=rate(data.consumer_discount_bps,"consumer_discount_bps",5000);
  const cashbackRate=rate(data.cashback_bps,"cashback_bps",3000);
  const referralRate=rate(data.referral_bps,"referral_bps",500);
  const processorRate=rate(data.processing_bps,"processing_bps",1200);
  const reserveRate=rate(data.reserve_bps,"reserve_bps",2000);
  const buyerDiscount=percentCents(face,discountRate);
  const buyerPrice=face-buyerDiscount;
  const merchantFunding=percentCents(face,merchantRate);
  const issuerProceeds=face-merchantFunding;
  // The platform's available spread is bounded by genuine issuer economics.
  const platformSpread=data.model==="merchant_commission"
    ?merchantFunding-buyerDiscount
    :buyerPrice-issuerProceeds;
  const cashback=percentCents(face,cashbackRate);
  const referral=percentCents(face,referralRate);
  const processing=percentCents(buyerPrice,processorRate);
  const reserve=percentCents(buyerPrice,reserveRate);
  const contribution=platformSpread-cashback-referral-processing-reserve;
  return {
    model:data.model,
    currency:"CAD",
    face_cents:face,
    consumer_charge_cents:buyerPrice,
    issuer_proceeds_cents:issuerProceeds,
    issuer_funded_spread_cents:merchantFunding,
    buyer_discount_cents:buyerDiscount,
    platform_spread_cents:platformSpread,
    cashback_cents:cashback,
    referral_cents:referral,
    processing_assumption_cents:processing,
    reserve_assumption_cents:reserve,
    projected_contribution_cents:contribution,
    contribution_margin_bps:Math.round(contribution/buyerPrice*10000),
    unit_economics_positive:contribution>0,
    cash_revenue_verified:false,
    payout_authorized:false,
    offer_active:false,
    disclaimer:"Scenario only. No issuer agreement, verified inventory, settled payment, user reward or redeemable balance is implied."
  };
}
