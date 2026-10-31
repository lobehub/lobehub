import type { EvalCaseEnvironment, EvalMemoryReference, EvalMemorySnapshot } from '@lobechat/types';

import { AgentEvalMemoryService } from '@/server/services/agentEvalMemory';

import type { EvalRunDeps } from './types';

/**
 * Memory of each eval attempt.
 *
 * Before an attempt runs, its own Memory entries are seeded from the case
 * fixture (`environment.memory`, empty when absent); a pass@k thread is its
 * own attempt. The Memory tool and persona injection of the attempt read and
 * write only those entries, so attempts never see each other's writes and
 * never touch the caller's memories. When the attempt completes, what its
 * Memory holds is recorded on the result as a snapshot; the entries stay as
 * evidence until the run is deleted.
 */

export interface TrialMemoryTarget {
  environment?: EvalCaseEnvironment;
  runId: string;
  testCaseId: string;
  threadId?: string;
  topicId: string;
}

export const prepareTrialMemory = (
  deps: EvalRunDeps,
  target: TrialMemoryTarget,
): Promise<EvalMemoryReference> =>
  new AgentEvalMemoryService(deps.db, deps.userId, deps.workspaceId).prepare({
    fixture: target.environment?.memory ?? {},
    runId: target.runId,
    testCaseId: target.testCaseId,
    threadId: target.threadId,
    topicId: target.topicId,
  });

/**
 * What a completed attempt's Memory holds. A snapshot failure must not fail
 * the attempt's grading; the entries themselves are still in the table.
 */
export const snapshotTrialMemory = async (
  deps: EvalRunDeps,
  target: Omit<TrialMemoryTarget, 'environment'>,
): Promise<EvalMemorySnapshot | undefined> => {
  try {
    return await new AgentEvalMemoryService(deps.db, deps.userId, deps.workspaceId).snapshot(
      target,
    );
  } catch (error) {
    console.error('[agent-eval] failed to snapshot trial Memory', target, error);
    return undefined;
  }
};
