import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import type { Context } from 'hono';

import { QuickNoteModel } from '@/database/models/quickNote';
import { getServerDB } from '@/database/server';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';

/**
 * Claims due Automatic Analyze Runs for clients that are no longer online.
 *
 * Call stack:
 *
 * QStash one-minute schedule
 *   -> {@link sweepQuickNoteAnalyze}
 *     -> {@link QuickNoteModel.findDueAnalyzeCandidates}
 *       -> {@link QuickNoteModel.claimRun}
 *         -> Agent Signal Workflow
 *
 * Use when:
 * - The deployment invokes the signed sweep route once per minute.
 *
 * Expects:
 * - Candidate selection already filters the user's effective Auto Analyze setting.
 * - Agent Signal scope and Run constraints deduplicate client/sweep races.
 *
 * Returns:
 * - Claimed and enqueued Run counts for cron observability.
 */
export const sweepQuickNoteAnalyze = async (context: Context) => {
  try {
    const db = await getServerDB();
    // Keyset traversal skips rollout-disabled prefixes without changing their scheduled work.
    const now = new Date();
    const pageSize = 100;
    const enabledUsers = new Map<string, boolean>();
    let after: { analyzeDueAt: Date; id: string } | undefined;
    let checked = 0;
    let enqueued = 0;

    while (enqueued < pageSize) {
      const candidates = await QuickNoteModel.findDueAnalyzeCandidates(db, {
        after,
        limit: pageSize,
        now,
      });
      for (const candidate of candidates) {
        checked += 1;
        if (!enabledUsers.has(candidate.userId)) {
          const flags = await getServerFeatureFlagsStateFromRuntimeConfig(candidate.userId);
          enabledUsers.set(candidate.userId, flags.enableQuickNote === true);
        }
        if (!enabledUsers.get(candidate.userId)) continue;
        const model = new QuickNoteModel(db, candidate.userId, candidate.workspaceId ?? undefined);
        const run = await model.claimRun(candidate.id, { kind: 'analyze', trigger: 'automatic' });
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

    return context.json({ checked, enqueued, success: true });
  } catch (error) {
    console.error('[quick-note/sweep]', error);
    return context.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
};
