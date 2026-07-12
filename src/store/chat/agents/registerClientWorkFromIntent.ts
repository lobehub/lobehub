import type { AgentState } from '@lobechat/agent-runtime';
import type { WorkRegistrationIntent } from '@lobechat/types';
import debug from 'debug';

import { workService } from '@/services/work';
import { buildWorkVersionCumulativeUsage } from '@/utils/workCumulativeUsage';

const log = debug('lobe-store:client-work-registration');

interface RegisterClientWorkFromIntentParams {
  actorAgentId?: string | null;
  intent: WorkRegistrationIntent;
  rootOperationId?: string;
  sourceMessageId?: string;
  sourceToolCallId?: string;
  /** Fallback `source` for task Works (the API name); skills/documents carry their own. */
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
 * Replaces the old client "register cost-less during execution, back-fill cost
 * with a follow-up `updateVersionCumulativeUsage`" two-step: the executors now
 * only stash the intent (see {@link stashWorkIntent}) and `call_tool` writes it
 * once here, after `UsageCounter.accumulateTool` has computed the cost.
 *
 * Best-effort: any failure is swallowed so Work bookkeeping never breaks the
 * tool result. `call_tool` awaits the write so its operation-end refresh cannot
 * race ahead of the persisted Work. No SWR cache is refreshed per tool.
 * Document deletes are NOT handled here — they stay a server-side side-effect
 * of the removeDocument tool mutation (a deletion carries no cost, so it needs
 * no cost-stamping defer).
 */
export const registerClientWorkFromIntent = async ({
  actorAgentId,
  intent,
  rootOperationId,
  sourceMessageId,
  sourceToolCallId,
  sourceToolName,
  state,
  threadId,
  topicId,
}: RegisterClientWorkFromIntentParams): Promise<void> => {
  const cumulative = buildWorkVersionCumulativeUsage({ cost: state.cost, usage: state.usage });

  try {
    if (intent.type === 'task') {
      const { action, role, targets } = intent;

      if (action === 'delete') {
        await Promise.all(
          targets.map((target) =>
            target.taskId
              ? workService.deleteTaskWork({ taskId: target.taskId }).catch((error) => {
                  log('deleteTaskWork failed for task %s: %O', target.taskId, error);
                })
              : undefined,
          ),
        );
        // Message-backed chips settle once per operation; avoid a full
        // `message:list` revalidate on every tool.
        return;
      }

      if (!role) return;

      await Promise.all(
        targets.map((target) =>
          workService
            .registerTask({
              actorAgentId,
              role,
              rootOperationId,
              source: sourceToolName,
              sourceMessageId,
              sourceToolCallId,
              taskId: target.taskId,
              taskIdentifier: target.taskIdentifier,
              threadId,
              topicId,
              ...cumulative,
            })
            .catch((error) => {
              log(
                'registerTask failed for task %s (%s): %O',
                target.taskId,
                target.taskIdentifier,
                error,
              );
              return undefined;
            }),
        ),
      );

      return;
    }

    if (intent.type === 'document') {
      // Only the `register` variant is stashed on the client; deletes stay a
      // lambda-side side-effect of the removeDocument mutation.
      if (intent.action !== 'register') return;

      await workService.registerDocument({
        ...intent.document,
        ...cumulative,
        actorAgentId,
        rootOperationId,
        sourceMessageId,
        sourceToolCallId,
        threadId,
        topicId,
      });

      return;
    }

    // skill (linear / github): normalize the untruncated payload into a Work.
    // Cache refresh is operation-scoped in `call_tool`.
    await workService.handleSkillToolResult({
      actorAgentId,
      args: intent.args,
      data: intent.data,
      provider: intent.provider,
      rootOperationId,
      sourceMessageId,
      sourceToolCallId,
      threadId,
      toolName: intent.toolName,
      topicId,
      ...cumulative,
    });
  } catch (error) {
    log('registerClientWorkFromIntent failed for toolCallId=%s: %O', sourceToolCallId, error);
  }
};
