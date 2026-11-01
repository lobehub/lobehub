-- Hard deletes can arrive through existing Agent/account/workspace cascades. Never erase
-- a physical writer lock with its owning row: the caller must stop it and confirm exit first.
CREATE OR REPLACE FUNCTION "channel_preserve_active_writer"() RETURNS trigger AS $$
BEGIN
  IF OLD.writer_held THEN
    RAISE EXCEPTION 'Stop active Channel replies before deleting their owner'
      USING ERRCODE = '55006';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "channel_preserve_active_writer" ON "channel_jobs";--> statement-breakpoint
CREATE TRIGGER "channel_preserve_active_writer"
  BEFORE DELETE ON "channel_jobs"
  FOR EACH ROW EXECUTE FUNCTION "channel_preserve_active_writer"();