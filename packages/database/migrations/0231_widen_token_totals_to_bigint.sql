-- Token running totals (per topic, per agent run, and the snapshots copied from them) can pass
-- the int4 limit of 2,147,483,647, which makes the roll-up UPDATE fail. Widen them to bigint.
-- Each table is altered in one statement so it is rewritten once, and only while a column is
-- still integer: a database whose columns were already widened online skips the table lock.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'topics'
      AND column_name IN ('total_input_tokens', 'total_output_tokens', 'total_tokens')
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "topics"
      ALTER COLUMN "total_input_tokens" SET DATA TYPE bigint,
      ALTER COLUMN "total_output_tokens" SET DATA TYPE bigint,
      ALTER COLUMN "total_tokens" SET DATA TYPE bigint;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_operations'
      AND column_name IN ('total_input_tokens', 'total_output_tokens', 'total_tokens')
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "agent_operations"
      ALTER COLUMN "total_input_tokens" SET DATA TYPE bigint,
      ALTER COLUMN "total_output_tokens" SET DATA TYPE bigint,
      ALTER COLUMN "total_tokens" SET DATA TYPE bigint;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'topic_analyses'
      AND column_name IN ('total_tokens', 'total_input_tokens', 'total_output_tokens')
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "topic_analyses"
      ALTER COLUMN "total_tokens" SET DATA TYPE bigint,
      ALTER COLUMN "total_input_tokens" SET DATA TYPE bigint,
      ALTER COLUMN "total_output_tokens" SET DATA TYPE bigint;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'agent_deliveries'
      AND column_name IN ('total_tokens')
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "agent_deliveries"
      ALTER COLUMN "total_tokens" SET DATA TYPE bigint;
  END IF;
END $$;
