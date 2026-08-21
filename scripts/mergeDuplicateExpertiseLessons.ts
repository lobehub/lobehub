/**
 * Folds duplicate expertise lessons back into one row.
 *
 * Before the ingestion dedup fix, an observation whose `existingLessonCode` did not resolve to a
 * lesson code always forked a new `P-nn`, so a domain accumulated several rows carrying the exact
 * same rule statement. Going forward `ExpertiseIngestionService` matches on the normalized title
 * too, but the rows already written stay split until they are merged here.
 *
 * Within one domain, active lessons whose titles normalize to the same string are the same
 * judgment. The oldest row wins; every hit moves onto it, its counters are recomputed from those
 * hits rather than incremented, and it records what it absorbed in `generalized_from_ids`. The
 * losers are retired rather than deleted, so a bad merge is one status flip away from undone.
 *
 * Dry run by default — pass `--apply` to write.
 *
 *   bun run scripts/mergeDuplicateExpertiseLessons.ts
 *   bun run scripts/mergeDuplicateExpertiseLessons.ts --apply
 *   bun run scripts/mergeDuplicateExpertiseLessons.ts --apply --domain=epd_xxx
 */
import pg from 'pg';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 50;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const domainArg = args.find((arg) => arg.startsWith('--domain='))?.slice('--domain='.length);
const batchSizeArg = args.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  throw new Error('--batch-size must be an integer between 1 and 500');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

/** Mirrors `normalizeLessonTitle` in apps/server/src/services/expertise/ingestion.ts. */
const NORMALIZED_TITLE = `lower(regexp_replace(title, '\\s', '', 'g'))`;

interface DuplicateGroup {
  domainId: string;
  loserCodes: string[];
  loserIds: string[];
  title: string;
  winnerCode: string;
  winnerId: string;
}

const findGroups = async (client: pg.PoolClient, domainIds: string[]) => {
  const { rows } = await client.query<{
    domain_id: string;
    ids: string[];
    codes: string[];
    title: string;
  }>(
    `
      SELECT domain_id,
             array_agg(id ORDER BY created_at, code) AS ids,
             array_agg(code ORDER BY created_at, code) AS codes,
             min(title) AS title
      FROM expertise_lessons
      WHERE status = 'active' AND domain_id = ANY($1::varchar[])
      GROUP BY domain_id, ${NORMALIZED_TITLE}
      HAVING count(*) > 1
    `,
    [domainIds],
  );

  return rows.map<DuplicateGroup>((row) => ({
    domainId: row.domain_id,
    loserCodes: row.codes.slice(1),
    loserIds: row.ids.slice(1),
    title: row.title,
    winnerCode: row.codes[0],
    winnerId: row.ids[0],
  }));
};

const mergeGroup = async (client: pg.PoolClient, group: DuplicateGroup) => {
  await client.query(`UPDATE expertise_hits SET lesson_id = $1 WHERE lesson_id = ANY($2::uuid[])`, [
    group.winnerId,
    group.loserIds,
  ]);

  // Counters are recomputed, not summed: the losers' own counts drifted from their hits over the
  // runs that wrote them, and hits are the only record that survives the merge intact.
  await client.query(
    `
      UPDATE expertise_lessons AS l
      SET hit_count = coalesce(h.hits, 0),
          example_count = coalesce(h.hits, 0),
          hit_run_count = coalesce(h.runs, 0),
          last_hit_at = h.last_hit_at,
          last_hit_run_id = h.last_hit_run_id,
          generalized_from_ids = (
            SELECT jsonb_agg(DISTINCT value)
            FROM jsonb_array_elements_text(
              coalesce(l.generalized_from_ids, '[]'::jsonb) || to_jsonb($2::text[])
            ) AS value
          ),
          updated_at = now()
      FROM (
        SELECT count(*)::int AS hits,
               count(DISTINCT run_id)::int AS runs,
               max(created_at) AS last_hit_at,
               (SELECT run_id FROM expertise_hits WHERE lesson_id = $1 ORDER BY created_at DESC LIMIT 1) AS last_hit_run_id
        FROM expertise_hits
        WHERE lesson_id = $1
      ) AS h
      WHERE l.id = $1
    `,
    [group.winnerId, group.loserIds],
  );

  await client.query(
    `
      UPDATE expertise_lessons
      SET status = 'retired', retired_at = now(), updated_at = now()
      WHERE id = ANY($1::uuid[])
    `,
    [group.loserIds],
  );
};

const run = async () => {
  let cursor = '';
  let scannedDomains = 0;
  let mergedGroups = 0;
  let retiredLessons = 0;

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const domainResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM expertise_domains
          WHERE id > $1 AND ($3::varchar IS NULL OR id = $3)
          ORDER BY id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        `,
        [cursor, batchSize, domainArg ?? null],
      );
      const domainIds = domainResult.rows.map((row) => row.id);

      if (domainIds.length === 0) {
        await client.query('COMMIT');
        break;
      }

      const groups = await findGroups(client, domainIds);
      for (const group of groups) {
        console.log(
          `${apply ? 'merge' : 'would merge'} ${group.domainId} ${group.loserCodes.join(', ')} → ${group.winnerCode}  ${group.title}`,
        );
        if (apply) await mergeGroup(client, group);
        mergedGroups += 1;
        retiredLessons += group.loserIds.length;
      }

      await client.query('COMMIT');
      scannedDomains += domainIds.length;
      cursor = domainIds.at(-1)!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (domainArg) break;
  }

  console.log(
    `${apply ? 'merged' : 'dry run'}: ${scannedDomains} domains scanned, ${mergedGroups} duplicate groups, ${retiredLessons} lessons retired`,
  );
  if (!apply) console.log('re-run with --apply to write');
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
