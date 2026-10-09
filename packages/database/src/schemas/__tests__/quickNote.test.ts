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
      new URL('../../../migrations/0177_quick_note_persistence.sql', import.meta.url),
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
  /** @example Explicit context deletion removes its input pin while preserving the consuming run. */
  it('allows deleting a context document pinned by another note', async () => {
    // ROOT CAUSE:
    // Document deletion cascades to histories, but an unrelated run keeps its input row alive.
    // NO ACTION on that input's history reference previously rejected the user's document delete.
    // Cascading the input reference permits explicit deletion; retention still skips pinned history.
    try {
      const fixture = `
        INSERT INTO users (id) VALUES ('quick-note-context-delete-test');
        INSERT INTO documents (id, user_id, file_type, total_char_count, total_line_count, source_type, source)
          VALUES ('qn-delete-source', 'quick-note-context-delete-test', 'text/plain', 0, 0, 'api', 'api'),
                 ('qn-delete-context', 'quick-note-context-delete-test', 'text/plain', 0, 0, 'api', 'api');
        INSERT INTO topics (id, user_id) VALUES ('qn-delete-topic', 'quick-note-context-delete-test');
        INSERT INTO document_histories (id, document_id, user_id, editor_data, save_source, saved_at)
          VALUES ('qn-delete-source-history', 'qn-delete-source', 'quick-note-context-delete-test', '{}', 'system', now()),
                 ('qn-delete-context-history', 'qn-delete-context', 'quick-note-context-delete-test', '{}', 'manual', now());
        INSERT INTO quick_notes (id, user_id, document_id, topic_id)
          VALUES ('qn_delete', 'quick-note-context-delete-test', 'qn-delete-source', 'qn-delete-topic');
        INSERT INTO quick_note_runs (id, quick_note_id, source_history_id, kind)
          VALUES ('00000000-0000-0000-0000-000000000021', 'qn_delete', 'qn-delete-source-history', 'analyze');
        INSERT INTO quick_note_run_inputs (run_id, role, user_id, document_history_id)
          VALUES ('00000000-0000-0000-0000-000000000021', 'source', 'quick-note-context-delete-test', 'qn-delete-source-history'),
                 ('00000000-0000-0000-0000-000000000021', 'resource', 'quick-note-context-delete-test', 'qn-delete-context-history');
      `;
      for (const statement of fixture.split(';').filter((value) => value.trim())) {
        await db.execute(sql.raw(statement));
      }
      await db.execute(sql`DELETE FROM documents WHERE id = 'qn-delete-context'`);
      const state = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM documents WHERE id = 'qn-delete-context') AS documents,
          (SELECT count(*)::int FROM document_histories WHERE id = 'qn-delete-context-history') AS histories,
          (SELECT count(*)::int FROM quick_note_run_inputs WHERE document_history_id = 'qn-delete-context-history') AS context_inputs,
          (SELECT count(*)::int FROM quick_note_run_inputs WHERE document_history_id = 'qn-delete-source-history') AS source_inputs,
          (SELECT count(*)::int FROM quick_note_runs WHERE quick_note_id = 'qn_delete') AS runs,
          (SELECT count(*)::int FROM quick_notes WHERE id = 'qn_delete') AS notes
      `);
      /** @example Only the deleted context and its dependent pin disappear. */
      expect(state.rows).toEqual([
        { context_inputs: 0, documents: 0, histories: 0, notes: 1, runs: 1, source_inputs: 1 },
      ]);
    } finally {
      await db.execute(sql`DELETE FROM users WHERE id = 'quick-note-context-delete-test'`);
    }
  });
  /** @example Account deletion removes every Quick Note row despite the RESTRICT history pin. */
  it('cascades user deletion through proposals that pin a current history revision', async () => {
    const fixture = `
      INSERT INTO users (id) VALUES ('quick-note-user-delete-test');
      INSERT INTO documents (id, user_id, file_type, total_char_count, total_line_count, source_type, source)
        VALUES ('qn-user-source', 'quick-note-user-delete-test', 'text/plain', 0, 0, 'api', 'api'),
               ('qn-user-proposal', 'quick-note-user-delete-test', 'text/plain', 0, 0, 'api', 'api');
      INSERT INTO topics (id, user_id) VALUES ('qn-user-topic', 'quick-note-user-delete-test');
      INSERT INTO document_histories (id, document_id, user_id, editor_data, save_source, saved_at)
        VALUES ('qn-user-source-history', 'qn-user-source', 'quick-note-user-delete-test', '{}', 'system', now()),
               ('qn-user-current-history', 'qn-user-proposal', 'quick-note-user-delete-test', '{}', 'manual', now());
      INSERT INTO quick_notes (id, user_id, document_id, topic_id)
        VALUES ('qn_user', 'quick-note-user-delete-test', 'qn-user-source', 'qn-user-topic');
      INSERT INTO quick_note_runs (id, quick_note_id, source_history_id, kind)
        VALUES ('00000000-0000-0000-0000-000000000031', 'qn_user', 'qn-user-source-history', 'analyze');
      INSERT INTO quick_note_proposals (quick_note_id, run_id, source_history_id, document_id, current_history_id, kind, user_id)
        VALUES ('qn_user', '00000000-0000-0000-0000-000000000031', 'qn-user-source-history',
          'qn-user-proposal', 'qn-user-current-history', 'task', 'quick-note-user-delete-test');
    `;
    for (const statement of fixture.split(';').filter((value) => value.trim())) {
      await db.execute(sql.raw(statement));
    }
    await db.execute(sql`DELETE FROM users WHERE id = 'quick-note-user-delete-test'`);
    const state = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM quick_notes WHERE id = 'qn_user') AS notes,
        (SELECT count(*)::int FROM quick_note_proposals WHERE quick_note_id = 'qn_user') AS proposals,
        (SELECT count(*)::int FROM document_histories WHERE user_id = 'quick-note-user-delete-test') AS histories
    `);
    /** @example The user-scoped cascade completes instead of tripping the RESTRICT check. */
    expect(state.rows).toEqual([{ histories: 0, notes: 0, proposals: 0 }]);
  });

  /** @example Pruning a single revision that a live proposal still points at is refused. */
  it('rejects deleting a history revision pinned as a proposal current revision', async () => {
    try {
      const fixture = `
        INSERT INTO users (id) VALUES ('quick-note-pin-test');
        INSERT INTO documents (id, user_id, file_type, total_char_count, total_line_count, source_type, source)
          VALUES ('qn-pin-source', 'quick-note-pin-test', 'text/plain', 0, 0, 'api', 'api'),
                 ('qn-pin-proposal', 'quick-note-pin-test', 'text/plain', 0, 0, 'api', 'api');
        INSERT INTO topics (id, user_id) VALUES ('qn-pin-topic', 'quick-note-pin-test');
        INSERT INTO document_histories (id, document_id, user_id, editor_data, save_source, saved_at)
          VALUES ('qn-pin-source-history', 'qn-pin-source', 'quick-note-pin-test', '{}', 'system', now()),
                 ('qn-pin-current-history', 'qn-pin-proposal', 'quick-note-pin-test', '{}', 'manual', now());
        INSERT INTO quick_notes (id, user_id, document_id, topic_id)
          VALUES ('qn_pin', 'quick-note-pin-test', 'qn-pin-source', 'qn-pin-topic');
        INSERT INTO quick_note_runs (id, quick_note_id, source_history_id, kind)
          VALUES ('00000000-0000-0000-0000-000000000041', 'qn_pin', 'qn-pin-source-history', 'analyze');
        INSERT INTO quick_note_proposals (quick_note_id, run_id, source_history_id, document_id, current_history_id, kind, user_id)
          VALUES ('qn_pin', '00000000-0000-0000-0000-000000000041', 'qn-pin-source-history',
            'qn-pin-proposal', 'qn-pin-current-history', 'task', 'quick-note-pin-test');
      `;
      for (const statement of fixture.split(';').filter((value) => value.trim())) {
        await db.execute(sql.raw(statement));
      }
      /** @example Retention code must skip pinned revisions; a raw delete hits the FK instead. */
      await expect(
        db.execute(sql`DELETE FROM document_histories WHERE id = 'qn-pin-current-history'`),
      ).rejects.toMatchObject({
        // PostgreSQL truncates the generated 64-character constraint name to 63 characters.
        cause: {
          code: '23503',
          constraint: expect.stringMatching(/^quick_note_proposals_current_history_id/),
        },
      });
    } finally {
      await db.execute(sql`DELETE FROM users WHERE id = 'quick-note-pin-test'`);
    }
  });
});
