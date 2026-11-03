CREATE TABLE IF NOT EXISTS "oauth_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"client" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
