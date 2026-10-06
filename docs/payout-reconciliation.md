# Washer payout reconciliation before enabling live payouts

Stripe automatic payouts are disabled for WashMate Connect accounts. Every bank
payout must be created by WashMate and linked to one local `payouts` row by
`stripe_payout_id` or the `washmatePayoutId` metadata on the Stripe payout.

Before live payouts are enabled:

1. Stop payout processing and list every pending local payout.
2. For each row, inspect its recorded transfer and Connect account in Stripe.
3. If `stripe_payout_id` is present, retrieve that exact payout in the recorded
   Connect account and apply its terminal status through the admin reconciliation
   endpoint.
4. If `stripe_payout_id` is absent but the transfer succeeded, inspect the
   Connect balance. Create one manual Stripe payout for the exact local amount
   with `washmatePayoutId=<local id>` metadata, then persist/reconcile that exact
   Stripe payout ID. Do not infer a match from the Connect account, amount,
   creation order, or newest pending row.
5. If the transfer outcome itself is unknown, reconcile the idempotency key
   `washmate_transfer_<local id>` with Stripe before retrying.
6. Confirm there are no unresolved pending rows and confirm each existing
   WashMate Connect account uses a manual payout schedule before enabling live
   payout requests.

Duplicate and out-of-order webhook deliveries are safe once the exact Stripe
payout ID is attached: settled local rows are not reopened, and events for
another Connect account are ignored.