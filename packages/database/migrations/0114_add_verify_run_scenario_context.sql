-- Give a verification session a `scenario` discriminator (e.g. `coding`), the
-- scenario's `context` bag (branch / commit / surfaces / …), and a generic
-- `metadata` bag reserved for future cross-scenario extension — so the report
-- viewer can render a per-scenario scope header and the verify page reads as the
-- final report. All additive + nullable.
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "scenario" text;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "context" jsonb;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
