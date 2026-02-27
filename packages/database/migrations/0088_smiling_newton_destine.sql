DROP INDEX "agent_eval_benchmarks_identifier_unique";--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD CONSTRAINT "agent_eval_benchmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_eval_benchmarks_identifier_user_id_unique" ON "agent_eval_benchmarks" USING btree ("identifier","user_id");--> statement-breakpoint
CREATE INDEX "agent_eval_benchmarks_user_id_idx" ON "agent_eval_benchmarks" USING btree ("user_id");