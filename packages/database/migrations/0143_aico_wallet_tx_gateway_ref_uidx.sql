-- FIN-003: unique idempotency key for wallet credit / allocate mutations.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_gateway_ref_uidx"
  ON "wallet_transactions" USING btree ("gateway_ref_id")
  WHERE "gateway_ref_id" IS NOT NULL;
