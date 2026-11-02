// Only the latest hand-off survives in metadata.repair; earlier batches were overwritten and cannot be recovered.

export interface BackfillQueryClient {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release?: () => void;
}

export interface BackfillPool {
  connect: () => Promise<BackfillQueryClient>;
}

export interface BackfillOptions {
  apply: boolean;
  batchSize: number;
  onBatch?: (progress: BackfillProgress & { cursor: string }) => void;
}

export interface BackfillProgress {
  scanned: number;
  updated: number;
}

interface HandOff {
  comment_ids: unknown;
  id: string;
  task_id: string;
}

const SELECT_HAND_OFFS = `
  SELECT id::text AS id,
         metadata->'repair'->>'taskId' AS task_id,
         metadata->'repair'->'commentIds' AS comment_ids
  FROM acceptances
  WHERE metadata->'repair'->>'taskId' IS NOT NULL
    AND id::text > $1
  ORDER BY id::text
  LIMIT $2
`;

const SELECT_ROOTS = `
  SELECT DISTINCT COALESCE(parent_comment_id, id) AS id
  FROM acceptance_comments
  WHERE acceptance_id::text = $1 AND id = ANY($2::text[])
`;

export async function backfillAcceptanceRepairCommentIds(
  pool: BackfillPool,
  options: BackfillOptions,
): Promise<BackfillProgress> {
  const progress: BackfillProgress = { scanned: 0, updated: 0 };
  let cursor = '';
  const client = await pool.connect();
  try {
    while (true) {
      const { rows } = await client.query<HandOff>(SELECT_HAND_OFFS, [cursor, options.batchSize]);
      if (!rows.length) break;
      for (const row of rows) {
        progress.scanned += 1;
        const ids = Array.isArray(row.comment_ids)
          ? row.comment_ids.filter((id): id is string => typeof id === 'string')
          : [];
        if (!ids.length) continue;
        const [task] = (
          await client.query<{
            config: { acceptanceRepair?: { acceptanceId?: string; commentIds?: string[] } } | null;
          }>('SELECT config FROM tasks WHERE id = $1', [row.task_id])
        ).rows;
        const repair = task?.config?.acceptanceRepair;
        if (!repair || repair.acceptanceId !== row.id) continue;
        const roots = (await client.query<{ id: string }>(SELECT_ROOTS, [row.id, ids])).rows.map(
          (r) => r.id,
        );
        const existing = Array.isArray(repair.commentIds) ? repair.commentIds : [];
        const merged = [...new Set([...existing, ...roots])];
        if (merged.length === existing.length) continue;
        progress.updated += 1;
        if (options.apply)
          await client.query(
            `UPDATE tasks
             SET config = jsonb_set(config, '{acceptanceRepair,commentIds}', $2::jsonb), updated_at = NOW()
             WHERE id = $1`,
            [row.task_id, JSON.stringify(merged)],
          );
      }
      cursor = rows.at(-1)!.id;
      options.onBatch?.({ ...progress, cursor });
    }
  } finally {
    client.release?.();
  }
  return progress;
}
