import { getSubAgentChatConfigOverride, resolveSubAgentModel } from '@lobechat/const';
import type { ConversationContext, RunSubAgentResult } from '@lobechat/types';
import debug from 'debug';

import { aiAgentService } from '@/services/aiAgent';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra/store';
import { registerSubAgentBridgeFromSpawner } from '@/store/chat/agents/transports/clientSubAgentBridge';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const log = debug('lobe-store:streaming-executor');

/**
 * Spawn a sub-agent run in an isolated thread and resolve with its output —
 * the client implementation behind the `lobe-agent.callSubAgent` tool.
 *
 * Extracted from `streamingExecutor.ts` (source-layout §3: that file was
 * already over the 800-line limit and must not grow). The store action keeps
 * a thin delegating method so the public API and callers stay unchanged.
 */
export const runClientSubAgent = async (
  get: () => ChatStore,
  params: {
    agentId: string;
    description: string;
    inheritMessages?: boolean;
    instruction: string;
    parentOperationId?: string;
    toolMessageId: string;
    topicId: string;
  },
): Promise<RunSubAgentResult> => {
  const {
    agentId,
    topicId,
    instruction,
    description,
    inheritMessages,
    toolMessageId,
    parentOperationId,
  } = params;

  const logId = `runClientSubAgent:${toolMessageId}`;

  try {
    // 1. Create the isolation Thread (persists thread + initial user message)
    const threadResult = await aiAgentService.createClientTaskThread({
      agentId,
      instruction,
      parentMessageId: toolMessageId,
      title: description,
      topicId,
    });

    if (!threadResult.success) {
      log('[%s] Failed to create client task thread', logId);
      return {
        error: 'Failed to create sub-agent thread',
        result: 'Failed to create sub-agent thread',
        success: false,
        threadId: '',
      };
    }

    const { threadId, userMessageId, threadMessages } = threadResult;
    log('[%s] Created thread %s, userMessage %s', logId, threadId, userMessageId);

    // Register the freshly-created isolation thread in the client thread list
    // so the tool Render can locate it (the "View Detail" button) and it shows
    // in the sidebar without waiting for a topic switch to re-fetch threads.
    void get().refreshThreads();

    // 2. Build the sub-agent ConversationContext (threadId provides isolation)
    const workspaceSlug = parentOperationId
      ? get().operations[parentOperationId]?.context.workspaceSlug
      : undefined;
    const subContext: ConversationContext = {
      agentId,
      isSubAgent: true,
      scope: 'thread',
      threadId,
      topicId,
      ...(workspaceSlug ? { workspaceSlug } : {}),
    };

    // 3. Create a child operation chained to the parent runtime operation
    const { operationId: taskOperationId } = get().startOperation({
      context: subContext,
      metadata: { executionMode: 'client', startTime: Date.now(), taskDescription: description },
      parentOperationId,
      type: 'execClientSubAgent',
    });

    // 4. Seed the thread message map so the persisted user message renders
    get().replaceMessages(threadMessages, { context: subContext });

    // 5. Optionally inherit the parent conversation messages
    let subMessages = [...threadMessages];
    if (inheritMessages) {
      const parentMessages = (
        get().dbMessagesMap[messageMapKey({ agentId, topicId })] || []
      ).filter((m) => m.role !== 'task');
      subMessages = [...parentMessages, ...subMessages];
      get().replaceMessages(subMessages, { context: subContext });
    }

    // 6. Run the sub-agent with the current client runtime.
    //    The model is resolved here at the spawn site (mirrors the server's
    //    callSubAgent runner): an explicit `agencyConfig.subagent` override
    //    wins, otherwise the sub-agent follows the parent's *effective* model
    //    — topic-pinned model over the agent default, the same precedence
    //    internal_createAgentState applies to the parent run itself.
    const parentAgentConfig = agentSelectors.getAgentConfigById(agentId)(getAgentStoreState());
    const parentEffectiveModel =
      topicSelectors.getTopicModelById(topicId)(get()) ?? parentAgentConfig;
    const subAgentModel = resolveSubAgentModel(
      parentAgentConfig?.agencyConfig?.subagent,
      parentEffectiveModel,
    );
    // Warm the sub-agent model's user-level reasoning config before the run:
    // the ChatInput loader only fetches the parent's effective model, while
    // resolveModelExtendParams reads this cache synchronously mid-run.
    await getAiInfraStoreState().ensureModelReasoningConfig(
      subAgentModel.model,
      subAgentModel.provider,
    );
    const runtimeResult = await get().executeClientAgent({
      chatConfigOverride: getSubAgentChatConfigOverride(parentAgentConfig?.agencyConfig?.subagent),
      context: subContext,
      isSubAgent: true,
      messages: subMessages,
      modelOverride: subAgentModel,
      operationId: taskOperationId,
      parentMessageId: userMessageId,
      parentMessageType: 'user',
      parentOperationId,
      userMessageId,
    });

    // 7. Extract the sub-agent's final assistant output as the tool result
    // A parked child (client tools / human approval / async tool) never
    // reached a terminal state: the thread stays `processing` and the child
    // resumes out-of-band. Register the client completion bridge so the
    // child's eventual terminal run settles the parent's deferred tool
    // message and resumes the parent run — then report the park honestly.
    // The old behavior backfilled a false "Task completed" success, which
    // made the parent re-dispatch the same work while the child was still
    // running; the intermediate behavior returned a settled failure, which
    // made the parent treat the call as done and never consume the child's
    // real result.
    if (runtimeResult?.parked) {
      log('[%s] Parked (waiting for human / async tool), not completed', logId);

      // The bridge reads the FULL parent context from the parent operation
      // itself (threadId / scope / documentId must survive the park).
      registerSubAgentBridgeFromSpawner({
        childContext: subContext,
        childOperationId: taskOperationId,
        getParentOperation: (id) => get().operations[id],
        parentAgentId: agentId,
        parentOperationId,
        toolMessageId,
      });

      return {
        error: undefined,
        result:
          'Sub-agent is still running: it paused for human approval or an async tool and has not finished yet. Do not treat this as done. Client-side continuation via callSubAgent({ subAgentId }) is not supported in this runtime — when the sub-agent thread reaches a terminal state, the completion bridge settles this tool call and resumes the parent automatically, so check the thread later instead of re-dispatching the same work.',
        success: false,
        threadId,
      };
    }

    const subMessageKey = messageMapKey(subContext);
    const subTaskMessages = get().dbMessagesMap[subMessageKey] || [];
    const lastAssistant = subTaskMessages.findLast((m) => m.role === 'assistant');
    const resultContent = lastAssistant?.content || 'Task completed';
    const totalToolCalls = subTaskMessages.filter((m) => m.role === 'tool').length;
    const { usage, cost, model } = runtimeResult || {};
    const totalCost = cost?.total;
    const totalInputTokens = usage?.llm?.tokens?.input;
    const totalOutputTokens = usage?.llm?.tokens?.output;
    const totalTokens = usage?.llm?.tokens?.total;

    // 8. Persist final Thread status + metadata
    await aiAgentService.updateClientTaskThreadStatus({
      completionReason: 'done',
      metadata: {
        totalCost,
        totalMessages: subTaskMessages.length,
        totalTokens,
        totalToolCalls,
      },
      resultContent,
      threadId,
    });

    get().completeOperation(taskOperationId);

    log('[%s] Completed, result %d chars', logId, resultContent.length);
    // Cost + the token split ride back to the caller, not just the total: they
    // land on the tool message's pluginState, which is the only place the parent's
    // usage tray can see a sub-agent's spend (its messages are in a thread the
    // parent never loads). Returning tokens alone makes a client sub-agent read as
    // free.
    return {
      model,
      result: resultContent,
      success: true,
      threadId,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalToolCalls,
      totalTokens,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('[%s] Error: %O', logId, error);
    return {
      error: errorMessage,
      result: `Sub-agent execution failed: ${errorMessage}`,
      success: false,
      threadId: '',
    };
  }
};
