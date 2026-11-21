import type { ConversationContext } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { shareChatService } from '@/services/shareChat';

interface RemoteHeteroResolution {
  actionType: 'submit' | 'skip' | 'cancel';
  operationId: string;
  payload?: Record<string, unknown>;
  resolutionRequestId: string;
  toolCallId: string;
}

/**
 * Publish a question answer to a remote (gateway / device) Claude Code or
 * Codex run. A share visitor's run executes on the creator's account, so the
 * owner-scoped endpoint rejects them; the share endpoint authorizes the
 * visitor's own topic and running operation instead.
 */
export const submitRemoteHeteroIntervention = (
  context: Pick<ConversationContext, 'agentShareId' | 'topicId'>,
  { actionType, operationId, payload, resolutionRequestId, toolCallId }: RemoteHeteroResolution,
) => {
  const resolution =
    actionType === 'submit'
      ? { operationId, resolutionRequestId, result: payload ?? {}, toolCallId }
      : {
          cancelReason: 'user_cancelled' as const,
          cancelled: true,
          operationId,
          resolutionRequestId,
          toolCallId,
        };

  const { agentShareId, topicId } = context;
  return agentShareId && topicId
    ? shareChatService.submitHeteroIntervention(agentShareId, topicId, resolution)
    : lambdaClient.aiAgent.submitHeteroIntervention.mutate(resolution);
};
