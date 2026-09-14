import type { SourceQuickNoteAnalyzeRequested } from '@lobechat/agent-signal/source';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineAgentSignalHandlers, defineSourceHandler } from '../runtime/middleware';

/** Dependencies for the Quick Note Analyze source handler. */
export interface QuickNoteAnalyzeSourceHandlerOptions {
  /** Starts the already-claimed Run and returns its Agent Operation identity. */
  dispatch: (runId: string) => Promise<{ operationId?: string | null } | undefined>;
}

/**
 * Creates the thin Agent Signal source handler for claimed Quick Note Runs.
 *
 * Use when:
 * - Default Agent Signal policies are composed for a server execution context.
 *
 * Expects:
 * - Claiming and snapshot pinning happened before source emission.
 * - Runtime source dedupe and scope locking protect duplicate delivery.
 *
 * Returns:
 * - A handler that dispatches the immutable Run without adding side effects to planning.
 */
export const createQuickNoteAnalyzeSourceHandler = (
  options: QuickNoteAnalyzeSourceHandlerOptions,
) => ({
  handle: async (source: SourceQuickNoteAnalyzeRequested) => {
    const payload = source.payload;
    if (
      source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested ||
      !payload.runId ||
      !payload.quickNoteId ||
      !payload.sourceHistoryId ||
      !payload.userId
    ) {
      return { concluded: { reason: 'invalid_payload' }, status: 'conclude' as const };
    }

    const result = await options.dispatch(payload.runId);
    return result?.operationId
      ? {
          concluded: {
            operationId: result.operationId,
            quickNoteId: payload.quickNoteId,
            runId: payload.runId,
            sourceHistoryId: payload.sourceHistoryId,
            status: 'dispatched',
            trigger: payload.trigger,
          },
          status: 'conclude' as const,
        }
      : {
          concluded: {
            quickNoteId: payload.quickNoteId,
            reason: 'run_unavailable',
            runId: payload.runId,
            sourceHistoryId: payload.sourceHistoryId,
            trigger: payload.trigger,
          },
          status: 'conclude' as const,
        };
  },
  id: 'quick-note-analyze-source',
});

/**
 * Registers Quick Note Analyze as a default Agent Signal source policy.
 *
 * Use when:
 * - A runtime should consume `quick_note.analyze.requested` events.
 *
 * Expects:
 * - Dispatch dependencies are owner/workspace scoped.
 *
 * Returns:
 * - One installable Agent Signal middleware.
 */
export const createQuickNoteAnalyzePolicy = (options: QuickNoteAnalyzeSourceHandlerOptions) => {
  const handler = createQuickNoteAnalyzeSourceHandler(options);

  return defineAgentSignalHandlers([
    defineSourceHandler(
      AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested,
      handler.id,
      handler.handle,
    ),
  ]);
};
