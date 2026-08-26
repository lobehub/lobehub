CREATE TABLE IF NOT EXISTS "agent_share_generations" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- `DEFAULT 1` is temporary, only so this backfills any pre-existing
-- `agent_share_run_reservations` row (staked before this migration ran) with
-- the same baseline every reader without a counter row already assumes
-- (`readAgentShareGeneration`'s `?? 1`). Every future INSERT sets it
-- explicitly (`AgentShareModel.assertRunnableForVisitor`), so the default is
-- dropped right after — see `../src/schemas/agentShare.ts`.
ALTER TABLE "agent_share_run_reservations" ADD COLUMN IF NOT EXISTS "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_share_run_reservations" ALTER COLUMN "generation" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent_share_generations" DROP CONSTRAINT IF EXISTS "agent_share_generations_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_share_generations" ADD CONSTRAINT "agent_share_generations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
