import type {
  CompressionGroupCreateInput,
  CompressionGroupCreateResult,
  CompressionGroupFinalizeInput,
  CompressionGroupFinalizeResult,
  CompressionPromptInput,
  CompressionPromptResult,
  CompressionTransport,
} from '@lobechat/agent-runtime';
import { chainCompressContext } from '@lobechat/prompts';

import type { LobeChatDatabase } from '@/database/type';
import { MessageService } from '@/server/services/message';

/**
 * Server {@link CompressionTransport} adapter — owns DB-backed compression
 * group persistence and the compression prompt policy used by the server path.
 */
export class ServerCompressionTransport implements CompressionTransport {
  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string,
    private readonly defaultWorkspaceId?: string,
  ) {}

  async buildPrompt(input: CompressionPromptInput): Promise<CompressionPromptResult> {
    const payload = chainCompressContext(input.messages);
    return { messages: payload.messages! };
  }

  async createGroup(input: CompressionGroupCreateInput): Promise<CompressionGroupCreateResult> {
    const service = this.createService(input.workspaceId);
    const result = await service.createCompressionGroup(input.topicId, input.messageIds, {
      agentId: input.agentId,
      groupId: input.groupId,
      threadId: input.threadId,
      topicId: input.topicId,
    } as any);

    return {
      messageGroupId: result.messageGroupId,
      messages: result.messages,
      messagesToSummarize: result.messagesToSummarize,
    };
  }

  async finalizeGroup(
    input: CompressionGroupFinalizeInput,
  ): Promise<CompressionGroupFinalizeResult> {
    const service = this.createService(input.workspaceId);
    const result = await service.finalizeCompression(input.messageGroupId, input.content, {
      agentId: input.agentId,
      groupId: input.groupId,
      threadId: input.threadId,
      topicId: input.topicId,
    } as any);

    return {
      messages: result.messages,
    };
  }

  private createService(workspaceId?: string) {
    return new MessageService(this.serverDB, this.userId, workspaceId ?? this.defaultWorkspaceId);
  }
}
