import type { ExecAgentResult, UIChatMessage } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface ShareChatExecParams {
  /** Client-minted ids for the rows this run creates (fresh sends only). */
  clientIds?: { assistantMessageId?: string; topicId?: string; userMessageId?: string };
  prompt: string;
  shareId: string;
  /** Absent → the server creates a new visitor topic (counted against the topic cap). */
  topicId?: string | null;
}

/**
 * Visitor-facing chat APIs for shared agents. Mirrors the slice of
 * `aiAgentService` the gateway transport needs (exec + token refresh) plus the
 * visitor-scoped topic/message reads — all keyed by shareId, authorized
 * server-side against `topics.senderId`.
 */
class ShareChatService {
  async execAgentTask(
    params: ShareChatExecParams,
    options?: { signal?: AbortSignal },
  ): Promise<ExecAgentResult> {
    return await lambdaClient.shareChat.execAgent.mutate(params, options);
  }

  async getTopics(shareId: string) {
    return await lambdaClient.shareChat.getTopics.query({ shareId });
  }

  async getMessages(shareId: string, topicId: string): Promise<UIChatMessage[]> {
    const data = await lambdaClient.shareChat.getMessages.query({ shareId, topicId });
    return data as unknown as UIChatMessage[];
  }

  /**
   * Interrupt a running share operation — the visitor counterpart of
   * `aiAgentService.interruptTask`. Visitors have no access to the owner-scoped
   * endpoint, so Stop / tab-close must go through this share-authorized one or
   * the server keeps generating (and billing the creator's share budget) after
   * the visitor walks away.
   */
  async interruptTask(shareId: string, topicId: string, operationId: string) {
    return await lambdaClient.shareChat.interruptTask.mutate({ operationId, shareId, topicId });
  }

  async refreshGatewayToken(shareId: string, topicId: string): Promise<{ token: string }> {
    return await lambdaClient.shareChat.refreshGatewayToken.query({ shareId, topicId });
  }
}

export const shareChatService = new ShareChatService();
