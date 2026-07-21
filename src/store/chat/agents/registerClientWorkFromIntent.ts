import type { AgentState } from '@lobechat/agent-runtime';
import { dispatchWorkRegistrationIntent } from '@lobechat/builtin-tools/workRegistration';
import type { WorkRegistrationIntent } from '@lobechat/types';
import debug from 'debug';

import { workService } from '@/services/work';
import { buildWorkVersionCumulativeUsage } from '@/utils/workCumulativeUsage';

const log = debug('lobe-store:client-work-registration');

interface RegisterClientWorkFromIntentParams {
  agentId?: string | null;
  intent: WorkRegistrationIntent;
  rootOperationId?: string;
  sourceMessageId?: string;
  sourceToolCallId?: string;
  /** Tool/plugin identifier supplied by the runtime event that produced this version. */
  sourceToolIdentifier: string;
  /** Runtime event's concrete tool name; skills/documents may carry their own. */
  sourceToolName: string;
  state: Pick<AgentState, 'cost' | 'usage'>;
  threadId?: string | null;
  topicId?: string;
}

/**
 * Client (legacy, non-gateway) mirror of the server runtime's
 * `registerWorkFromIntent`. Persists a Work version from the tool-execution
 * layer's registration intent, stamping the tool call's cumulative cost/usage
 * onto the row at insert time.
 *
 * Thin wrapper around the shared {@link dispatchWorkRegistrationIntent}: builds
 * `workService`-backed ports and per-call provenance, then delegates all branch
 * logic. Replaces the old client "register cost-less during execution, back-fill
 * cost with a follow-up `updateVersionCumulativeUsage`" two-step: the executors
 * now only stash the intent (see {@link stashWorkIntent}) and `call_tool` writes
 * it once here, after `UsageCounter.accumulateTool` has computed the cost.
 *
 * Best-effort: any failure is swallowed so Work bookkeeping never breaks the
 * tool result. `call_tool` awaits the write so its operation-end refresh cannot
 * race ahead of the persisted Work. No SWR cache is refreshed per tool.
 */
export const registerClientWorkFromIntent = async ({
  agentId,
  intent,
  rootOperationId,
  sourceMessageId,
  sourceToolCallId,
  sourceToolIdentifier,
  sourceToolName,
  state,
  threadId,
  topicId,
}: RegisterClientWorkFromIntentParams): Promise<void> => {
  const cumulative = buildWorkVersionCumulativeUsage({ cost: state.cost, usage: state.usage });

  try {
    await dispatchWorkRegistrationIntent(
      intent,
      {
        // Document deletes are NOT handled client-side — they stay a lambda-side
        // side-effect of the removeDocument mutation (a deletion carries no cost,
        // so it needs no cost-stamping defer). Omitting the port makes the
        // document-delete intent a no-op.
        deleteTaskWork: (params) => workService.deleteTaskWork(params),
        handleSkillToolResult: (params) => workService.handleSkillToolResult(params),
        registerDocument: (params) => workService.registerDocument(params),
        registerTask: (params) => workService.registerTask(params),
      },
      {
        agentId,
        ...cumulative,
        messageId: sourceMessageId,
        rootOperationId,
        threadId,
        toolCallId: sourceToolCallId,
        toolIdentifier: sourceToolIdentifier,
        toolName: sourceToolName,
        topicId,
      },
    );
  } catch (error) {
    log('registerClientWorkFromIntent failed for toolCallId=%s: %O', sourceToolCallId, error);
  }
};
