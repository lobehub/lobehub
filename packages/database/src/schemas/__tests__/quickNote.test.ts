// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';

const db = await getTestDB();

/** @example Replaying the schema preserves constraints and exposes the scheduling column. */
describe('Quick Note migration', () => {
  /** @example A second deployment can replay the additive migration without errors. */
  it('can be reapplied and creates the complete note schema', async () => {
    // Read the generated artifact so SQL and snapshot drift cannot hide behind the ORM schema.
    const migration = await readFile(
      new URL('../../../migrations/0162_configurable_quick_note_analyzer.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      await db.execute(sql.raw(statement));
    }
    const tables = await db.execute(sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND (tablename LIKE 'quick_note_%' OR tablename = 'quick_notes')
    `);
    /** @example All eight capture, run, resource, proposal, and comment tables exist. */
    expect(tables.rows).toHaveLength(8);
    const columns = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'quick_notes' AND column_name = 'analyze_due_at'
    `);
    /** @example Scheduling queries can select analyze_due_at after migration replay. */
    expect(columns.rows).toHaveLength(1);
  });

  /** @example A run input cannot omit both revision references. */
  it('rejects inputs without a revision', async () => {
    /** @example The database rejects the row with its exclusive-revision check. */
    await expect(
      db.execute(sql`
      INSERT INTO quick_note_run_inputs (run_id, role, user_id)
      VALUES ('00000000-0000-0000-0000-000000000001', 'source', 'test')
    `),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'quick_note_run_inputs_exactly_one_revision_check' },
    });
  });

  /** @example A run input cannot point to both a document revision and a comment revision. */
  it('rejects inputs with two revisions', async () => {
    /** @example The database enforces one revision source independently of application validation. */
    await expect(
      db.execute(sql`
      INSERT INTO quick_note_run_inputs
        (run_id, role, user_id, document_history_id, comment_revision_id)
      VALUES ('00000000-0000-0000-0000-000000000001', 'source', 'test', 'history',
        '00000000-0000-0000-0000-000000000002')
    `),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'quick_note_run_inputs_exactly_one_revision_check' },
    });
  });
  /** @example Removing a proposal document also removes its current revision and proposal row. */
  it('allows a proposal document and its referenced history to cascade together', async () => {
    try {
      const fixture = `
        INSERT INTO users (id) VALUES ('quick-note-cascade-test');
        INSERT INTO documents (id, user_id, file_type, total_char_count, total_line_count, source_type, source)
          VALUES ('qn-cascade-source', 'quick-note-cascade-test', 'text/plain', 0, 0, 'api', 'api'),
                 ('qn-cascade-proposal', 'quick-note-cascade-test', 'text/plain', 0, 0, 'api', 'api');
        INSERT INTO topics (id, user_id) VALUES ('qn-cascade-topic', 'quick-note-cascade-test');
        INSERT INTO document_histories (id, document_id, user_id, editor_data, save_source, saved_at)
          VALUES ('qn-cascade-source-history', 'qn-cascade-source', 'quick-note-cascade-test', '{}', 'system', now()),
                 ('qn-cascade-current-history', 'qn-cascade-proposal', 'quick-note-cascade-test', '{}', 'manual', now());
        INSERT INTO quick_notes (id, user_id, document_id, topic_id)
          VALUES ('qn_cascade', 'quick-note-cascade-test', 'qn-cascade-source', 'qn-cascade-topic');
        INSERT INTO quick_note_runs (id, quick_note_id, source_history_id, kind)
          VALUES ('00000000-0000-0000-0000-000000000011', 'qn_cascade', 'qn-cascade-source-history', 'analyze');
        INSERT INTO quick_note_proposals (quick_note_id, run_id, source_history_id, document_id, current_history_id, kind, user_id)
          VALUES ('qn_cascade', '00000000-0000-0000-0000-000000000011', 'qn-cascade-source-history',
            'qn-cascade-proposal', 'qn-cascade-current-history', 'task', 'quick-note-cascade-test');
      `;
      for (const statement of fixture.split(';').filter((value) => value.trim())) {
        await db.execute(sql.raw(statement));
      }
      await db.execute(sql`DELETE FROM documents WHERE id = 'qn-cascade-proposal'`);
      const proposals = await db.execute(
        sql`SELECT id FROM quick_note_proposals WHERE quick_note_id = 'qn_cascade'`,
      );
      const histories = await db.execute(
        sql`SELECT id FROM document_histories WHERE id = 'qn-cascade-current-history'`,
      );
      /** @example The existing RESTRICT reference permits the sibling proposal cascade. */
      expect(proposals.rows).toHaveLength(0);
      /** @example The deleted document leaves no current history row behind. */
      expect(histories.rows).toHaveLength(0);
    } finally {
      await db.execute(sql`DELETE FROM users WHERE id = 'quick-note-cascade-test'`);
    }
  });
});
