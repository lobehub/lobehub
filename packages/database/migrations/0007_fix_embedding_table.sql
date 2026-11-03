-- step 1: create a temporary table to store the rows we want to keep
CREATE TEMP TABLE embeddings_temp AS
SELECT DISTINCT ON (chunk_id) *
FROM embeddings
ORDER BY chunk_id, random();
--> statement-breakpoint

-- step 2: delete all rows from the original table
DELETE FROM embeddings;
--> statement-breakpoint

-- step 3: insert the rows we want to keep back into the original table
INSERT INTO embeddings
SELECT * FROM embeddings_temp;
--> statement-breakpoint

-- step 4: drop the temporary table
DROP TABLE embeddings_temp;
--> statement-breakpoint

-- step 5: now it's safe to add the unique constraint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_chunk_id_unique" UNIQUE("chunk_id");
