// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';

const db = await getTestDB();

/** Runs a `;`-separated SQL fixture one statement at a time. */
const runFixture = async (fixture: string) => {
  for (const statement of fixture.split(';').filter((value) => value.trim())) {
    await db.execute(sql.raw(statement));
  }
};

/** Inserts one user with a Quick Note, its source revision, and one Analyze Run. */
const seedNote = (prefix: string, runId: string) => `
  INSERT INTO users (id) VALUES ('${prefix}-user');
  INSERT INTO documents (id, user_id, file_type, total_char_count, total_line_count, source_type, source)
    VALUES ('${prefix}-source', '${prefix}-user', 'text/plain', 0, 0, 'api', 'api');
  INSERT INTO document_histories (id, document_id, user_id, editor_data, save_source, saved_at)
    VALUES ('${prefix}-history', '${prefix}-source', '${prefix}-user', '{}', 'system', now());
  INSERT INTO quick_notes (id, user_id, document_id)
    VALUES ('qn_${prefix}', '${prefix}-user', '${prefix}-source');
  INSERT INTO quick_note_runs (id, quick_note_id, source_history_id, kind)
    VALUES ('${runId}', 'qn_${prefix}', '${prefix}-history', 'analyze');
`;

/** @example Replaying the schema preserves constraints and exposes the simplified columns. */
describe('Quick Note migration', () => {
  /** @example A second deployment can replay the migration without errors. */
  it('can be reapplied and creates exactly the simplified note schema', async () => {
    // Read the generated artifact so SQL and snapshot drift cannot hide behind the ORM schema.
    const migration = await readFile(
      new URL('../../../migrations/0199_quick_note_persistence.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      await db.execute(sql.raw(statement));
    }
    const tables = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND (tablename LIKE 'quick_note_%' OR tablename = 'quick_notes')
      ORDER BY tablename
    `);
    /** @example Only capture, run, resource, proposal, and comment tables exist. */
    expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
      'quick_note_comments',
      'quick_note_proposals',
      'quick_note_resources',
      'quick_note_runs',
      'quick_notes',
    ]);
    const columns = await db.execute<{ column_name: string; table_name: string }>(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_name IN ('quick_notes', 'quick_note_runs', 'quick_note_resources', 'quick_note_proposals')
    `);
    const has = (table: string, column: string) =>
      columns.rows.some((row) => row.table_name === table && row.column_name === column);

    /** @example Scheduling, Run snapshot, and Proposal payload columns are present. */
    expect(
      [
        ['quick_notes', 'analyze_due_at'],
        ['quick_note_runs', 'topic_id'],
        ['quick_note_runs', 'input_snapshot'],
        ['quick_note_runs', 'decision'],
        ['quick_note_runs', 'summary'],
        ['quick_note_resources', 'run_id'],
        ['quick_note_proposals', 'payload'],
        ['quick_note_proposals', 'original_payload'],
        ['quick_note_proposals', 'decided_at'],
        ['quick_note_proposals', 'dismiss_reason'],
        ['quick_note_proposals', 'result_type'],
        ['quick_note_proposals', 'result_id'],
        ['quick_note_proposals', 'preset'],
      ].every(([table, column]) => has(table, column)),
    ).toBe(true);
    /** @example Dropped pointer columns are gone. */
    expect(
      [
        ['quick_notes', 'topic_id'],
        ['quick_note_runs', 'thread_id'],
        ['quick_note_proposals', 'document_id'],
        ['quick_note_proposals', 'current_history_id'],
        ['quick_note_proposals', 'accepted_history_id'],
      ].some(([table, column]) => has(table, column)),
    ).toBe(false);
  });

  /** @example A Proposal cannot be stored without its action payload. */
  it('requires a Proposal payload and original payload', async () => {
    try {
      await runFixture(seedNote('qn-payload', '00000000-0000-0000-0000-000000000011'));

      await expect(
        db.execute(sql`
          INSERT INTO quick_note_proposals (quick_note_id, run_id, source_history_id, kind, user_id, original_payload)
          VALUES ('qn_qn-payload', '00000000-0000-0000-0000-000000000011', 'qn-payload-history',
            'task', 'qn-payload-user', '{}')
        `),
      ).rejects.toMatchObject({ cause: { code: '23502' } });
    } finally {
      await db.execute(sql`DELETE FROM users WHERE id = 'qn-payload-user'`);
    }
  });

  /** @example Deleting a Run's Topic or the Run keeps the Run and the resource link auditable. */
  it('sets Run topic and resource run references to null on delete', async () => {
    try {
      await runFixture(`
        ${seedNote('qn-setnull', '00000000-0000-0000-0000-000000000021')}
        INSERT INTO topics (id, user_id) VALUES ('qn-setnull-topic', 'qn-setnull-user');
        UPDATE quick_note_runs SET topic_id = 'qn-setnull-topic'
          WHERE id = '00000000-0000-0000-0000-000000000021';
        INSERT INTO quick_note_resources (quick_note_id, user_id, source_history_id, run_id, resource_id, resource_type, role)
          VALUES ('qn_qn-setnull', 'qn-setnull-user', 'qn-setnull-history',
            '00000000-0000-0000-0000-000000000021', 'qn-setnull-topic', 'topic', 'context');
      `);

      await db.execute(sql`DELETE FROM topics WHERE id = 'qn-setnull-topic'`);
      const afterTopic = await db.execute(sql`
        SELECT topic_id FROM quick_note_runs WHERE id = '00000000-0000-0000-0000-000000000021'
      `);
      await db.execute(
        sql`DELETE FROM quick_note_runs WHERE id = '00000000-0000-0000-0000-000000000021'`,
      );
      const afterRun = await db.execute(sql`
        SELECT run_id FROM quick_note_resources WHERE quick_note_id = 'qn_qn-setnull'
      `);

      /** @example The Run survives its Topic. */
      expect(afterTopic.rows).toEqual([{ topic_id: null }]);
      /** @example The resource link survives its Run. */
      expect(afterRun.rows).toEqual([{ run_id: null }]);
    } finally {
      await db.execute(sql`DELETE FROM users WHERE id = 'qn-setnull-user'`);
    }
  });

  /** @example Account deletion removes every Quick Note row. */
  it('cascades user deletion through runs, proposals, comments, and resources', async () => {
    await runFixture(`
      ${seedNote('qn-user-delete', '00000000-0000-0000-0000-000000000031')}
      INSERT INTO quick_note_proposals (quick_note_id, run_id, source_history_id, kind, user_id, payload, original_payload)
        VALUES ('qn_qn-user-delete', '00000000-0000-0000-0000-000000000031', 'qn-user-delete-history',
          'task', 'qn-user-delete-user', '{"instruction":"x"}', '{"instruction":"x"}');
      INSERT INTO quick_note_comments (quick_note_id, user_id, content)
        VALUES ('qn_qn-user-delete', 'qn-user-delete-user', 'feedback');
      INSERT INTO quick_note_resources (quick_note_id, user_id, source_history_id, resource_id, resource_type, role)
        VALUES ('qn_qn-user-delete', 'qn-user-delete-user', 'qn-user-delete-history', 'tpc_x', 'topic', 'context');
    `);

    await db.execute(sql`DELETE FROM users WHERE id = 'qn-user-delete-user'`);
    const state = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM quick_notes WHERE id = 'qn_qn-user-delete') AS notes,
        (SELECT count(*)::int FROM quick_note_runs WHERE quick_note_id = 'qn_qn-user-delete') AS runs,
        (SELECT count(*)::int FROM quick_note_proposals WHERE quick_note_id = 'qn_qn-user-delete') AS proposals,
        (SELECT count(*)::int FROM quick_note_comments WHERE quick_note_id = 'qn_qn-user-delete') AS comments,
        (SELECT count(*)::int FROM quick_note_resources WHERE quick_note_id = 'qn_qn-user-delete') AS resources
    `);

    expect(state.rows).toEqual([{ comments: 0, notes: 0, proposals: 0, resources: 0, runs: 0 }]);
  });
});
