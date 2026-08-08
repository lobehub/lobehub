-- TENANT-003: denormalize org_id onto member_budgets for tenant-safe predicates.
--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "org_id" text;--> statement-breakpoint
UPDATE "member_budgets" AS mb
SET "org_id" = om."org_id"
FROM "organization_members" AS om
WHERE mb."org_member_id" = om."id"
  AND (mb."org_id" IS NULL OR mb."org_id" = '');--> statement-breakpoint
-- Orphan budgets (no member row) cannot be tenant-scoped — drop them.
DELETE FROM "member_budgets" WHERE "org_id" IS NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "member_budgets"
    ADD CONSTRAINT "member_budgets_org_id_organizations_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_budgets_org_id_idx" ON "member_budgets" USING btree ("org_id");
