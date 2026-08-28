import pg from 'pg';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 100;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error('--batch-size must be an integer between 1 and 1000');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

const run = async () => {
  let cursor = '';
  let processedKnowledgeBases = 0;
  let reconciledFiles = 0;
  let reconciledDocuments = 0;

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const knowledgeBaseResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM knowledge_bases
          WHERE workspace_id IS NOT NULL
            AND visibility = 'public'
            AND id > $1
          ORDER BY id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        `,
        [cursor, batchSize],
      );
      const knowledgeBaseIds = knowledgeBaseResult.rows.map((row) => row.id);

      if (knowledgeBaseIds.length === 0) {
        await client.query('COMMIT');
        break;
      }

      const fileResult = apply
        ? await client.query(
            `
              UPDATE files AS f
              SET visibility = 'public', updated_at = NOW()
              FROM knowledge_base_files AS kbf
              INNER JOIN knowledge_bases AS kb ON kb.id = kbf.knowledge_base_id
              WHERE kb.id = ANY($1::text[])
                AND kb.workspace_id IS NOT NULL
                AND kb.visibility = 'public'
                AND f.id = kbf.file_id
                AND f.user_id = kb.user_id
                AND f.workspace_id = kb.workspace_id
                AND f.visibility IS DISTINCT FROM 'public'
              RETURNING f.id
            `,
            [knowledgeBaseIds],
          )
        : await client.query(
            `
              SELECT f.id
              FROM files AS f
              INNER JOIN knowledge_base_files AS kbf ON kbf.file_id = f.id
              INNER JOIN knowledge_bases AS kb ON kb.id = kbf.knowledge_base_id
              WHERE kb.id = ANY($1::text[])
                AND kb.workspace_id IS NOT NULL
                AND kb.visibility = 'public'
                AND f.user_id = kb.user_id
                AND f.workspace_id = kb.workspace_id
                AND f.visibility IS DISTINCT FROM 'public'
            `,
            [knowledgeBaseIds],
          );

      const documentResult = apply
        ? await client.query(
            `
              UPDATE documents AS d
              SET visibility = 'public', updated_at = NOW()
              FROM knowledge_bases AS kb
              WHERE kb.id = ANY($1::text[])
                AND kb.workspace_id IS NOT NULL
                AND kb.visibility = 'public'
                AND d.user_id = kb.user_id
                AND d.workspace_id = kb.workspace_id
                AND d.visibility IS DISTINCT FROM 'public'
                AND (
                  d.knowledge_base_id = kb.id
                  OR EXISTS (
                    SELECT 1
                    FROM knowledge_base_files AS kbf
                    WHERE kbf.knowledge_base_id = kb.id
                      AND kbf.file_id = d.file_id
                  )
                )
              RETURNING d.id
            `,
            [knowledgeBaseIds],
          )
        : await client.query(
            `
              SELECT d.id
              FROM documents AS d
              INNER JOIN knowledge_bases AS kb
                ON d.knowledge_base_id = kb.id
                OR EXISTS (
                  SELECT 1
                  FROM knowledge_base_files AS kbf
                  WHERE kbf.knowledge_base_id = kb.id
                    AND kbf.file_id = d.file_id
                )
              WHERE kb.id = ANY($1::text[])
                AND kb.workspace_id IS NOT NULL
                AND kb.visibility = 'public'
                AND d.user_id = kb.user_id
                AND d.workspace_id = kb.workspace_id
                AND d.visibility IS DISTINCT FROM 'public'
            `,
            [knowledgeBaseIds],
          );

      await client.query('COMMIT');

      processedKnowledgeBases += knowledgeBaseIds.length;
      reconciledFiles += fileResult.rowCount ?? 0;
      reconciledDocuments += documentResult.rowCount ?? 0;
      cursor = knowledgeBaseIds.at(-1)!;

      console.log(
        JSON.stringify({
          apply,
          cursor,
          processedKnowledgeBases,
          reconciledDocuments,
          reconciledFiles,
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(
    JSON.stringify({
      apply,
      complete: true,
      processedKnowledgeBases,
      reconciledDocuments,
      reconciledFiles,
    }),
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
