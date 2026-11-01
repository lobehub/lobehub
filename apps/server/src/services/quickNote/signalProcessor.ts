import type { LobeChatDatabase } from '@/database/type';
import type { QuickNoteSignalProcessor } from '@/server/services/agentSignal/policies';

import { QuickNoteProcessingService } from './index';

/** Scope of one Agent Signal source execution. */
export interface CreateQuickNoteSignalProcessorParams {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Creates the Quick Note processor the Agent Signal Quick Note policy drives.
 *
 * Use when:
 * - An Agent Signal entry point (the workflow runner) executes Quick Note sources
 *
 * Expects:
 * - One call per source execution; the processing service is created on first use, so its
 *   decisions backend is resolved at most once and never for sources that skip Quick Note work
 *
 * Returns:
 * - A processor bound to the given user/workspace scope
 *
 * Kept out of `quickNote/index.ts` and outside `agentSignal`: Quick Note enqueues Agent Signal
 * sources, so Agent Signal must receive this processor from its composition root instead of
 * importing `quickNote`.
 */
export const createQuickNoteSignalProcessor = ({
  db,
  userId,
  workspaceId,
}: CreateQuickNoteSignalProcessorParams): QuickNoteSignalProcessor => {
  let service: QuickNoteProcessingService | undefined;
  const quickNote = () => (service ??= new QuickNoteProcessingService(db, userId, workspaceId));

  return {
    completeWithoutGeneration: async (runId) => quickNote().completeWithoutGeneration(runId),
    dispatchGeneration: async (runId) => quickNote().dispatchGeneration(runId),
    judgeContentChange: async (params) => quickNote().judgeContentChange(params),
    judgeRun: async (runId) => quickNote().judgeRun(runId),
    markProposalsStale: async (quickNoteId) => quickNote().markProposalsStale(quickNoteId),
  };
};
