-- Truncate title to 150 characters if it exceeds the limit
UPDATE agents
SET title = LEFT(title, 200)
WHERE LENGTH(title) > 200;--> statement-breakpoint

-- Truncate description to 300 characters if it exceeds the limit
UPDATE agents
SET description = LEFT(description, 300)
WHERE LENGTH(description) > 300;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agents_title_idx" ON "agents" USING btree ("title");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_description_idx" ON "agents" USING btree ("description");
