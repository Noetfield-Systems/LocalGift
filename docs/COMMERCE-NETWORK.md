# LocalGift Commerce Network

LocalGift owns issuer-backed local commerce and merchant agreements. Earnloop remains the independent offerwall product. This integration must not duplicate wallets, create unbacked gift cards, or claim third-party purchases are paid.

## Shipping experience

/market — official merchant-issued checkout links only, with user click tracking
/club — device-bound HttpOnly session, one-level organic referral, noncash XP, recorded reward accounting
/resale — moderated second-hand listings and private operator inquiry relay; no payment custody
/admin/network — private operator queue for contract-backed issuer offers, seller review, conversion evidence, reversals and margin records
/merchant-deals — merchant proposal underwriting and revenue-first deal registration

## Money and evidence boundary

Click is not a purchase. An operator-posted transaction is reported, not verified revenue. A transaction may be reviewed and marked operator-attested funded with settlement reference, but no bank-connected independent proof exists yet. Withdrawable balance remains zero and there is no cash-out API or live payout provider. Refund review must reverse any recorded cashback and referral liabilities.

Gift cards are issued and redeemed by the merchant, not LocalGift. No cash or rewards are issued for signups. Merchant-funded incentives require positive transaction economics, documented issuer authorization and confirmed money. Marketplace resale has no escrow or checkout and requires operator moderation.

## Current constraints and next revenue milestones

1. Acquire actual signed issuer permissions and activate three first merchant deals.
2. Verify real issuer sale, settlement/commission and positive contribution margin.
3. Reconcile merchant deposits with a supported payments data source.
4. Add a supported cash-out provider before allowing withdrawals.
5. Keep community UX free of operator/admin credentials. Existing LOCALGIFT_ADMIN_TOKEN is reused only on a noindex operations page.

PostgreSQL schema changes are additive; no existing production table is deleted. Guest membership is not portable across devices until an identity verification provider is available.
