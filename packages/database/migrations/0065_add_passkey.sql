CREATE TABLE IF NOT EXISTS "passkey" (
	"aaguid" text,
	"backedUp" boolean,
	"counter" integer,
	"createdAt" timestamp DEFAULT now(),
	"credentialID" text NOT NULL,
	"deviceType" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"transports" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'passkey_userId_users_id_fk') THEN
    ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint	
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credential_id_unique" ON "passkey" USING btree ("credentialID");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_user_id_idx" ON "passkey" USING btree ("userId");