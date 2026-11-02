import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { Context } from 'hono';

import { QuickNoteModel } from '@/database/models/quickNote';
import { QuickNoteRepository } from '@/database/repositories/quickNote';
import { getServerDB } from '@/database/server';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { renderQuickNoteSourceText } from '@/server/services/quickNote/sourceText';

const PAGE_SIZE = 100;
/**
 * Candidate pages each loop may read per invocation. Skipped candidates (claimed elsewhere, no
 * pending Proposal) do not count toward `PAGE_SIZE`, so without a cap one tick could walk the whole
 * backlog; the next one-minute tick resumes from the still-due rows.
 */
export const QUICK_NOTE_SWEEP_MAX_PAGES = 10;

/**
 * Emits the debounced "did the meaning change?" checks whose edits have gone quiet.
 *
 * Each real edit pushed `content_check_due_at` back, so one check runs per edit burst and reads
 * the note as it is now. Notes without current pending Proposals are cleared without a check.
 *
 * Returns:
 * - How many checks were enqueued.
 */
const sweepContentChecks = async (
  db: Awaited<ReturnType<typeof getServerDB>>,
  now: Date,
  isEnabled: (userId: string) => Promise<boolean>,
) => {
  let after: { contentCheckDueAt: Date; id: string } | undefined;
  let enqueued = 0;

  for (let page = 0; page < QUICK_NOTE_SWEEP_MAX_PAGES && enqueued < PAGE_SIZE; page++) {
    const candidates = await QuickNoteModel.findDueContentCheckCandidates(db, {
      after,
      limit: PAGE_SIZE,
      now,
    });
    for (const candidate of candidates) {
      if (!(await isEnabled(candidate.userId))) continue;
      // Clearing the due time is the claim; a newer edit moved it forward and wins instead.
      if (!(await QuickNoteModel.claimContentCheck(db, candidate.id, now))) continue;

      const workspaceId = candidate.workspaceId ?? undefined;
      let accepted: boolean;
      try {
        const proposals = await new QuickNoteModel(
          db,
          candidate.userId,
          workspaceId,
        ).queryProposals(candidate.id);
        if (
          !proposals.some(
            ({ decisionStatus, validity }) =>
              decisionStatus === 'pending' && validity === 'current',
          )
        ) {
          continue;
        }

        const result = await enqueueAgentSignalSourceEvent(
          {
            payload: { quickNoteId: candidate.id, userId: candidate.userId },
            scopeKey: `quick-note:${candidate.id}`,
            sourceId: `${candidate.id}:content-check:${candidate.contentCheckDueAt?.getTime()}`,
            sourceType: AGENT_SIGNAL_SOURCE_TYPES.quickNoteContentChanged,
          },
          { userId: candidate.userId, workspaceId },
        );
        accepted = result.accepted;
      } catch (error) {
        // The claim cleared the due time; without it the retried sweep would never see this edit.
        if (candidate.contentCheckDueAt) {
          await QuickNoteModel.releaseContentCheck(db, candidate.id, candidate.contentCheckDueAt);
        }
        throw error;
      }
      if (accepted) enqueued += 1;
      if (enqueued === PAGE_SIZE) break;
    }
    const last = candidates.at(-1);
    if (candidates.length < PAGE_SIZE || !last?.contentCheckDueAt) break;
    after = { contentCheckDueAt: last.contentCheckDueAt, id: last.id };
  }

  return enqueued;
};

/**
 * Claims due Automatic Analyze Runs for clients that are no longer online, and runs the
 * debounced meaning-change checks of edited notes.
 *
 * Call stack:
 *
 * QStash one-minute schedule
 *   -> {@link sweepQuickNoteAnalyze}
 *     -> {@link QuickNoteModel.findDueAnalyzeCandidates}
 *       -> {@link QuickNoteRepository.claimRun}
 *         -> Agent Signal Workflow (`quick_note.analyze.requested`)
 *     -> {@link sweepContentChecks}
 *       -> {@link QuickNoteModel.claimContentCheck}
 *         -> Agent Signal Workflow (`quick_note.content.changed`)
 *
 * Use when:
 * - The deployment invokes the signed sweep route once per minute.
 *
 * Expects:
 * - Candidate selection already filters the user's effective Auto Analyze setting.
 * - Due work of users without Quick Note is retired on first sight, so it is scanned once.
 * - Agent Signal scope and Run constraints deduplicate client/sweep races.
 *
 * Returns:
 * - Claimed and enqueued Run counts, and enqueued content checks, for cron observability.
 */
export const sweepQuickNoteAnalyze = async (context: Context) => {
  try {
    const db = await getServerDB();
    const now = new Date();
    const pageSize = PAGE_SIZE;
    const enabledUsers = new Map<string, boolean>();
    const isEnabled = async (userId: string) => {
      if (!enabledUsers.has(userId)) {
        const flags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
        const enabled = flags.enableQuickNote === true;
        enabledUsers.set(userId, enabled);
        // A rollout-disabled user's due rows would otherwise be rescanned ahead of enabled users'
        // notes on every sweep. Retire them once; the user's next edit schedules work again.
        if (!enabled) await QuickNoteModel.retireDueWork(db, userId, now);
      }
      return enabledUsers.get(userId) === true;
    };
    let after: { analyzeDueAt: Date; id: string } | undefined;
    let checked = 0;
    let enqueued = 0;

    for (let page = 0; page < QUICK_NOTE_SWEEP_MAX_PAGES && enqueued < pageSize; page++) {
      const candidates = await QuickNoteModel.findDueAnalyzeCandidates(db, {
        after,
        limit: pageSize,
        now,
      });
      for (const candidate of candidates) {
        checked += 1;
        if (!(await isEnabled(candidate.userId))) continue;
        const repo = new QuickNoteRepository(
          db,
          candidate.userId,
          candidate.workspaceId ?? undefined,
        );
        const run = await repo.claimRun(candidate.id, {
          kind: 'analyze',
          renderSourceText: renderQuickNoteSourceText,
          trigger: 'automatic',
        });
        if (!run) continue;

        const result = await enqueueAgentSignalSourceEvent(
          {
            payload: {
              quickNoteId: run.quickNoteId,
              runId: run.id,
              sourceHistoryId: run.sourceHistoryId,
              trigger: 'automatic',
              userId: candidate.userId,
            },
            scopeKey: `quick-note:${run.quickNoteId}`,
            sourceId: run.id,
            sourceType: AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested,
          },
          {
            userId: candidate.userId,
            workspaceId: candidate.workspaceId ?? undefined,
          },
        );
        if (result.accepted) enqueued += 1;
        if (enqueued === pageSize) break;
      }
      const last = candidates.at(-1);
      if (candidates.length < pageSize || !last?.analyzeDueAt) break;
      after = { analyzeDueAt: last.analyzeDueAt, id: last.id };
    }

    const contentChecks = await sweepContentChecks(db, now, isEnabled);

    return context.json({ checked, contentChecks, enqueued, success: true });
  } catch (error) {
    console.error('[quick-note/sweep]', error);
    return context.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
};
