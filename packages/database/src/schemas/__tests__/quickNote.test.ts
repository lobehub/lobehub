// @vitest-environment node
import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';

const db = await getTestDB();

/** @example Replaying the schema preserves constraints and exposes the scheduling column. */
describe('Quick Note migration', () => {
  /** @example A second deployment can replay the additive migration without errors. */
  it('can be reapplied and creates the complete note schema', async () => {
    // Read the generated artifact so SQL and snapshot drift cannot hide behind the ORM schema.
    const migration = readFileSync(
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
});
