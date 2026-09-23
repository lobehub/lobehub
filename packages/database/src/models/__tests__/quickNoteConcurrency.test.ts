// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { serverDBEnv } from '@/config/db';

import { getTestDB } from '../../core/getTestDB';
import { documentHistories, quickNoteRunInputs, users } from '../../schemas';
import { QuickNoteModel } from '../quickNote';

/** @example Two PostgreSQL connections serialize proposal editing and immutable input pinning. */
describe.skipIf(process.env.TEST_SERVER_DB !== '1')(
  'Quick Note concurrent proposal pinning',
  () => {
    /** @example An edit waits until claimRun has pinned the proposal version it observed. */
    it('keeps the observed proposal revision pinned before its pointer can advance', async () => {
      const db = await getTestDB();
      const userId = 'quick-note-pin-race';
      const model = new QuickNoteModel(db, userId);
      const control = new Client({ connectionString: serverDBEnv.DATABASE_TEST_URL });
      const pending: Promise<unknown>[] = [];
      await control.connect();

      try {
        await db.insert(users).values({ id: userId });
        const note = await model.create({ content: 'Capture' });
        const analyze = await model.claimRun(note.id, { kind: 'analyze' });
        const output = await model.acceptAnnotation(analyze!.id, {
          content: 'Annotation',
          proposals: [{ content: 'Original proposal', kind: 'task' }],
        });
        const proposal = output!.proposals[0];

        // ROOT CAUSE:
        // claimRun read currentHistoryId without locking the proposal before inserting its input.
        // An edit could advance the pointer and retention could delete the unpinned old revision.
        // The proposal row must remain locked until the input's foreign-key reference is committed.
        // Pause the real claimRun at the input insert so a separate real edit reaches this window.
        await db.execute(
          sql.raw(`
        CREATE FUNCTION quick_note_pin_race_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.user_id = 'quick-note-pin-race' AND NEW.role = 'proposal' THEN
            PERFORM pg_advisory_xact_lock(8823181);
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER quick_note_pin_race_barrier BEFORE INSERT ON quick_note_run_inputs
          FOR EACH ROW EXECUTE FUNCTION quick_note_pin_race_barrier();
      `),
        );
        await control.query('BEGIN');
        await control.query('SELECT pg_advisory_xact_lock(8823181)');
        const claim = model.claimRun(note.id, { kind: 'dive' });
        pending.push(claim);

        /** @example The claim pauses after reading the proposal and before committing its input. */
        await expect
          .poll(
            async () => {
              const result = await control.query<{ waiting: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=8823181 AND NOT granted) AS waiting",
              );
              return result.rows[0].waiting;
            },
            { timeout: 10_000 },
          )
          .toBe(true);

        const edit = model.updateProposal(proposal.id, {
          content: 'Edited proposal',
          editorData: { markdown: 'Edited proposal' },
        });
        pending.push(edit);
        /** @example The real editor update must block on the proposal lock held by claimRun. */
        await expect
          .poll(
            async () => {
              // NOTICE:
              // Refresh PostgreSQL's transaction-local statistics snapshot before polling activity.
              // The control transaction otherwise keeps the first activity observation cached.
              // Source: PostgreSQL monitoring-stats documentation, statistics snapshot consistency.
              // Remove when the control connection no longer polls inside its barrier transaction.
              await control.query('SELECT pg_stat_clear_snapshot()');
              const result = await control.query<{ waiting: boolean }>(
                `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE wait_event_type='Lock' AND query LIKE 'update "quick_note_proposals"%') AS waiting`,
              );
              return result.rows[0].waiting;
            },
            { timeout: 10_000 },
          )
          .toBe(true);

        await control.query('COMMIT');
        const run = await claim;
        const edited = await edit;
        const inputs = await db
          .select()
          .from(quickNoteRunInputs)
          .where(eq(quickNoteRunInputs.runId, run!.id));
        /** @example The run owns the original revision even though editing subsequently advances it. */
        expect(inputs.find((input) => input.role === 'proposal')?.documentHistoryId).toBe(
          proposal.currentHistoryId,
        );
        /** @example Editing produces a distinct current revision after pin acquisition finishes. */
        expect(edited?.history.id).not.toBe(proposal.currentHistoryId);
        /** @example The exact pinned input remains readable for later execution. */
        expect(
          await db
            .select()
            .from(documentHistories)
            .where(eq(documentHistories.id, proposal.currentHistoryId)),
        ).toHaveLength(1);
      } finally {
        await control.query('ROLLBACK');
        await Promise.allSettled(pending);
        await db.execute(
          sql.raw(`
        DROP TRIGGER IF EXISTS quick_note_pin_race_barrier ON quick_note_run_inputs;
        DROP FUNCTION IF EXISTS quick_note_pin_race_barrier();
      `),
        );
        await db.delete(users).where(eq(users.id, userId));
        await control.end();
      }
    }, 30_000);
  },
);
