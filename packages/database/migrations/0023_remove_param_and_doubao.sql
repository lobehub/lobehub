-- Custom SQL migration file, put your code below! --
UPDATE agents SET chat_config = jsonb_set(chat_config, '{enableReasoningEffort}', 'false') WHERE chat_config ->> 'enableReasoningEffort' = 'true';
--> statement-breakpoint
UPDATE agents SET params = params - 'reasoning_effort' WHERE params ? 'reasoning_effort';
--> statement-breakpoint
DELETE FROM ai_providers WHERE id = 'doubao';