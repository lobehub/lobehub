-- updated_at is the document concurrency token, including for direct SQL writers.
-- Advance from the locked row, not a client clock; keep tokens distinct in JS Dates.
CREATE OR REPLACE FUNCTION public.advance_document_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := GREATEST(
    date_trunc('milliseconds', clock_timestamp()),
    OLD.updated_at + interval '1 millisecond'
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER documents_advance_version
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.advance_document_version();
