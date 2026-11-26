import { aiAgentService } from '@/services/aiAgent';
import type { ChatStore } from '@/store/chat/store';

type SubmitRequest = Parameters<typeof aiAgentService.submitWorktreeTurn>[0];
type TopicListScope = Pick<
  Parameters<ChatStore['internal_replaceTopicId']>[0],
  'agentId' | 'groupId'
>;

interface SubmitFirstSendWorktreeParams {
  abandon: (error: unknown) => void;
  accepted: () => boolean;
  complete: () => void;
  mintedTopicId?: string;
  onMessagePersisted: () => void;
  onTopicCreated?: (topicId: string) => void | Promise<void>;
  operationId: string;
  request: () => SubmitRequest;
  scope: TopicListScope;
  workspaceId: string | null;
}

/** Finish the client send when the server takes ownership of the pending worktree turn. */
export const submitFirstSendWorktree = async (
  get: () => ChatStore,
  {
    abandon,
    accepted,
    complete,
    mintedTopicId,
    onMessagePersisted,
    onTopicCreated,
    operationId,
    request,
    scope,
    workspaceId,
  }: SubmitFirstSendWorktreeParams,
) => {
  try {
    const input = request();
    const { topic } = await aiAgentService.submitWorktreeTurn(input, workspaceId);
    onMessagePersisted();
    get().internal_replaceTopicId({
      ...scope,
      nextId: topic.id,
      previousId: mintedTopicId ?? topic.id,
      value: {
        metadata: topic.metadata ?? undefined,
        status: topic.status,
        title: topic.title ?? undefined,
      },
    });
    complete();
    get().completeOperation(operationId);
    if (onTopicCreated) await onTopicCreated(topic.id);
    return {
      assistantMessageId: input.assistantMessageId,
      createdTopicId: topic.id,
      userMessageId: input.userMessageId,
    };
  } catch (error) {
    if (accepted()) throw error;
    get().failOperation(operationId, {
      message: error instanceof Error ? error.message : String(error),
      type: 'GatewayError',
    });
    abandon(error);
  }
};
