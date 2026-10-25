import type { ExecAgentResult, UserInterventionConfig } from '@lobechat/types';
import { isAgentOperationInFlight, RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { MessageModel } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';

import type { InternalExecAgentParams } from './types';

const log = debug('lobe-server:ai-agent:background-sub-agent');

/**
 * Background sub-agents (`callSubAgent` / `callAgent` with `runInBackground`)
 * report to a parent that did not wait for them. A finished one stores its
 * answer on its placeholder (see `AgentRuntimeService.completeSubAgentBridge`);
 * this module hands those answers back to the conversation.
 *
 * Each answer lands on the conversation's main line as a user message whose
 * sender is the sub-agent (`metadata.subAgentCallback`) — the chat shows the
 * sub-agent speaking, the model reads it wrapped as `<sub_agent_result>` — and
 * the parent agent then runs off that history.
 *
 * It runs when a background sub-agent finishes and whenever a run of the topic
 * settles, so an answer that arrives mid-turn is delivered once that turn ends
 * — the parent is never interrupted, and never waits on a result it chose not
 * to wait for. Each answer is claimed before it is delivered, so the two
 * triggers racing cannot deliver it twice; a turn that fails to start hands
 * its claims back for the next settle, and the callback rows' ids are derived
 * from the call so a retry does not repeat them.
 */

export interface BackgroundSubAgentResult {
  /** The background call's placeholder tool message. */
  callId: string;
  result: string;
  sender: { agentId?: string; name: string };
  status: 'completed' | 'error';
  /** The sub-agent's isolation thread. */
  threadId: string;
}

export interface BackgroundSubAgentDeliveryDeps {
  agentOperationModel: Pick<AgentOperationModel, 'findById'>;
  /**
   * Append one callback message per result to the topic's main line, in order,
   * skipping any that already exist; returns the id of the line's last message.
   */
  appendResultMessages: (params: {
    agentId: string;
    results: BackgroundSubAgentResult[];
    topicId: string;
  }) => Promise<string | undefined>;
  execAgent: (params: InternalExecAgentParams) => Promise<ExecAgentResult>;
  messageModel: Pick<
    MessageModel,
    | 'claimBackgroundSubAgentDelivery'
    | 'listBackgroundSubAgentCalls'
    | 'releaseBackgroundSubAgentDelivery'
  >;
  /** Approval policy for the wake-up run — the user's foreground preferences. */
  resolveInterventionConfig: () => Promise<UserInterventionConfig>;
  topicModel: Pick<TopicModel, 'findById'>;
}

type PendingCall = Awaited<
  ReturnType<BackgroundSubAgentDeliveryDeps['messageModel']['listBackgroundSubAgentCalls']>
>[number];

const toResult = (call: PendingCall): BackgroundSubAgentResult => {
  const sender = call.state.sender as { agentId?: string; name?: string } | undefined;
  return {
    callId: call.id,
    result:
      typeof call.state.result === 'string' && call.state.result
        ? call.state.result
        : 'Finished without a textual answer.',
    sender: { agentId: sender?.agentId, name: sender?.name ?? '' },
    status: call.state.status === 'error' ? 'error' : 'completed',
    threadId: typeof call.state.threadId === 'string' ? call.state.threadId : '',
  };
};

/**
 * Whether another run still holds the topic. `settledOperationId` is the run
 * whose completion triggered this delivery: its mark may not be cleared yet,
 * but it is done. A mark naming a run that already ended is stale.
 */
const isTopicBusy = async (
  deps: BackgroundSubAgentDeliveryDeps,
  marker: { operationId?: string } | null | undefined,
  settledOperationId: string | undefined,
): Promise<boolean> => {
  const operationId = marker?.operationId;
  if (!operationId || operationId === settledOperationId) return false;

  const operation = await deps.agentOperationModel.findById(operationId);
  return !!operation && isAgentOperationInFlight(operation.status);
};

/**
 * Deliver the topic's finished background sub-agent results, unless another
 * run still holds the topic — its own completion calls this again. Never
 * throws: an undelivered result stays stored for the next attempt.
 */
export const deliverBackgroundSubAgentResults = async (
  deps: BackgroundSubAgentDeliveryDeps,
  params: { settledOperationId?: string; topicId: string },
): Promise<void> => {
  const { settledOperationId, topicId } = params;

  try {
    const topic = await deps.topicModel.findById(topicId);
    if (!topic?.agentId) return;
    if (await isTopicBusy(deps, topic.metadata?.runningOperation, settledOperationId)) {
      log('topic %s is busy; results wait for its run to settle', topicId);
      return;
    }

    // Background calls only start from the main line (see
    // `checkBackgroundSubAgentAllowed`), which is where they report back.
    const pending = (
      await deps.messageModel.listBackgroundSubAgentCalls({ scope: 'undelivered', topicId })
    ).filter((call) => !call.threadId);
    if (pending.length === 0) return;

    const claimed = new Set(
      await deps.messageModel.claimBackgroundSubAgentDelivery(
        pending.map((call) => call.id),
        new Date().toISOString(),
      ),
    );
    const results = pending.filter((call) => claimed.has(call.id)).map(toResult);
    if (results.length === 0) return;

    const agentId = topic.agentId;
    try {
      const parentMessageId = await deps.appendResultMessages({ agentId, results, topicId });
      const started = await deps.execAgent({
        agentId,
        appContext: { topicId },
        autoStart: true,
        parentMessageId,
        prompt: `Process ${results.length} finished background result${results.length === 1 ? '' : 's'}`,
        suppressUserMessage: true,
        trigger: RequestTrigger.Chat,
        userInterventionConfig: await deps.resolveInterventionConfig(),
      });
      if (!started.success) throw new Error(started.error ?? 'the turn did not start');

      log('woke agent %s in topic %s with %d result(s)', agentId, topicId, results.length);
    } catch (error) {
      log('waking agent %s in topic %s failed, results kept: %O', agentId, topicId, error);
      await deps.messageModel.releaseBackgroundSubAgentDelivery([...claimed]);
    }
  } catch (error) {
    log('delivering background results for topic %s failed: %O', topicId, error);
  }
};
