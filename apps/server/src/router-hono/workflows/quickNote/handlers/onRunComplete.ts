import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { quickNoteRuns, quickNotes } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { QuickNoteProcessingService } from '@/server/services/quickNote';

interface QuickNoteRunCompletePayload {
  /** Terminal runtime diagnostic, when execution failed. */
  errorMessage?: string;
  /** Terminal assistant projection emitted by Agent Runtime. */
  lastAssistantContent?: string;
  /** Runtime operation identity used to reject mismatched callbacks. */
  operationId: string;
  /** Terminal completion reason. */
  reason?: string;
  /** Domain Run receiving the projection. */
  runId: string;
  /** Owner stamped into the signed static hook body. */
  userId: string;
}

/**
 * Projects a signed Agent Runtime completion into Quick Note resources.
 *
 * Call stack:
 *
 * QStash hook delivery
 *   -> {@link onQuickNoteRunComplete}
 *     -> {@link QuickNoteProcessingService.onRunComplete}
 *
 * Use when:
 * - A queued Discovery or Dive completes outside the originating server process.
 *
 * Expects:
 * - `qstashAuth` has verified the request before this handler runs.
 * - Run, operation, and owner identities match the database row.
 *
 * Returns:
 * - A JSON success response after accepting or failing the domain Run.
 */
export const onQuickNoteRunComplete = async (context: Context) => {
  try {
    const body = (await context.req.json()) as QuickNoteRunCompletePayload;
    if (!body.runId || !body.userId || !body.operationId) {
      return context.json({ error: 'Missing required fields' }, 400);
    }

    const db = await getServerDB();
    const [run] = await db
      .select({ userId: quickNotes.userId, workspaceId: quickNotes.workspaceId })
      .from(quickNoteRuns)
      .innerJoin(quickNotes, eq(quickNotes.id, quickNoteRuns.quickNoteId))
      .where(
        and(
          eq(quickNoteRuns.id, body.runId),
          eq(quickNoteRuns.operationId, body.operationId),
          eq(quickNotes.userId, body.userId),
        ),
      )
      .limit(1);

    if (!run) return context.json({ error: 'Quick Note Run not found' }, 404);

    const service = new QuickNoteProcessingService(db, run.userId, run.workspaceId ?? undefined);
    await service.onRunComplete({
      errorMessage: body.errorMessage,
      lastAssistantContent: body.lastAssistantContent,
      reason: body.reason || 'done',
      runId: body.runId,
    });

    return context.json({ success: true });
  } catch (error) {
    console.error('[quick-note/on-run-complete]', error);
    return context.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
};
