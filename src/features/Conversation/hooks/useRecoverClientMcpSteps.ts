import { useEffect } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { mcpElicitationKeys } from '@/libs/swr/keys';
import { createWorkspaceLambdaClient, lambdaClient } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../store';

/** Reopening a client conversation resumes from saved tool results, never from tools/call. */
export function useRecoverClientMcpSteps() {
  const context = useConversationStore((s) => s.context);
  const hasMcp = useConversationStore((s) =>
    s.dbMessages.some((row) => row.plugin?.type === 'mcp'),
  );
  const revision = useConversationStore((s) =>
    s.dbMessages.map((row) => `${row.id}:${row.content ? 1 : 0}`).join('|'),
  );
  const userId = useUserStore(userProfileSelectors.userId);
  const result = useClientDataSWR(
    hasMcp && context.topicId && userId
      ? mcpElicitationKeys.clientSteps(userId, context.topicId, context.threadId, revision)
      : null,
    () =>
      lambdaClient.mcpElicitation.clientSteps.query({
        topicId: context.topicId!,
        threadId: context.threadId,
      }),
    {
      refreshInterval: (steps) => (steps?.length ? 15_000 : 0),
      errorRetryCount: 3,
      refreshWhenHidden: false,
    },
  );
  useEffect(() => {
    if (!result.data?.length) return;
    let stopped = false;
    void (async () => {
      for (const step of result.data!) {
        if (stopped || Number(step.step?.leaseUntil) > Date.now()) continue;
        const store = useChatStore.getState();
        const active = Object.values(store.operations).some(
          (op) =>
            op.context.topicId === context.topicId && ['running', 'pending'].includes(op.status),
        );
        if (active) continue;
        const owner = crypto.randomUUID();
        const scopedClient = createWorkspaceLambdaClient(step.workspaceId ?? null);
        const claim = await scopedClient.mcpElicitation.leaseClientStep.mutate({
          operationId: step.operationId,
          owner,
        });
        if (stopped || !claim?.agentId || !claim.model || !claim.provider || !claim.toolMessageId)
          continue;
        const heartbeat = setInterval(() => {
          void scopedClient.mcpElicitation.leaseClientStep
            .mutate({ operationId: step.operationId, owner })
            .catch(console.error);
        }, 15_000);
        try {
          await store.refreshMessages(context);
          if (stopped) continue;
          const messages = displayMessageSelectors.getDisplayMessagesByKey(messageMapKey(context))(
            useChatStore.getState(),
          );
          const modelOverride = { model: claim.model, provider: claim.provider };
          const { state, context: initialContext } = store.internal_createAgentState({
            messages,
            parentMessageId: claim.toolMessageId,
            agentId: claim.agentId,
            topicId: claim.topicId,
            threadId: claim.threadId ?? undefined,
            modelOverride,
          });
          await store.executeClientAgent({
            context: { ...context, agentId: claim.agentId },
            messages,
            parentMessageId: claim.toolMessageId,
            parentMessageType: 'tool',
            modelOverride,
            initialState: { ...state, pendingAssistantMessageId: claim.assistantMessageId },
            initialContext: {
              ...initialContext,
              phase: 'tool_result',
              payload: { parentMessageId: claim.toolMessageId },
            },
          });
          await scopedClient.mcpElicitation.leaseClientStep.mutate({
            operationId: step.operationId,
            owner,
            finish: true,
          });
        } finally {
          clearInterval(heartbeat);
        }
      }
    })().catch(console.error);
    return () => {
      stopped = true;
    };
  }, [result.data, context, result.mutate]);
}
