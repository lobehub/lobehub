import type { ExecAgentResult, UIChatMessage } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export interface ShareChatExecParams {
  /** Client-minted ids for the rows this run creates (fresh sends only). */
  clientIds?: { assistantMessageId?: string; topicId?: string; userMessageId?: string };
  /**
   * Files the visitor uploaded through {@link ShareChatService.createFile} to
   * attach to this turn. The server re-checks each id's share provenance, so
   * ids of anyone else's files are rejected rather than leaked.
   */
  fileIds?: string[];
  prompt: string;
  shareId: string;
  /** The prompt was queued behind a running turn and renders as its continuation. */
  steer?: boolean;
  /** Absent → the server creates a new visitor topic (counted against the topic cap). */
  topicId?: string | null;
}

/**
 * Visitor-facing chat APIs for shared agents. Mirrors the slice of
 * `aiAgentService` the gateway transport needs (exec + token refresh) plus the
 * visitor-scoped topic/message reads — all keyed by shareId, authorized
 * server-side against `topics.senderId`.
 */
export interface ShareUploadMetadata {
  codec?: string;
  durationMs?: number;
  height?: number;
  mimeType?: string;
  ratio?: number;
  width?: number;
}

export interface ShareCreateFileParams {
  fileType: string;
  metadata?: ShareUploadMetadata;
  name: string;
  pathname: string;
  shareId: string;
  size: number;
}

class ShareChatService {
  /**
   * Release an abandoned share upload reservation (PUT failed / cancelled).
   * Best-effort: the server sweeps expired reservations anyway.
   */
  async abortUpload(shareId: string, pathname: string) {
    try {
      await lambdaClient.shareChat.abortUpload.mutate({ pathname, shareId });
    } catch (error) {
      console.error('Failed to release share upload:', error);
    }
  }

  /** Settle a PUT-completed share upload into a file the visitor can attach. */
  async createFile(params: ShareCreateFileParams): Promise<{ id: string; url: string }> {
    return await lambdaClient.shareChat.createFile.mutate(params);
  }

  /**
   * Reserve storage (on the CREATOR's quota) and get a pre-signed PUT URL for
   * one visitor attachment. Rejects with the creator's `storage_block:*`
   * reason when their quota cannot admit the bytes.
   */
  async createUploadUrl(
    shareId: string,
    file: { name: string; size: number },
  ): Promise<{ pathname: string; url: string }> {
    return await lambdaClient.shareChat.createUploadUrl.mutate({
      name: file.name,
      shareId,
      size: file.size,
    });
  }

  /** Drop a not-yet-sent share upload the visitor removed from their draft. */
  async removeFile(shareId: string, fileId: string) {
    await lambdaClient.shareChat.removeFile.mutate({ fileId, shareId });
  }

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
    // Mirrors the owner path's `includeFileWorks` opt-in (see messageService).
    const data = await lambdaClient.shareChat.getMessages.query({
      includeFileWorks: true,
      shareId,
      topicId,
    });
    return data as unknown as UIChatMessage[];
  }

  /**
   * A document the visitor's own share run produced — the open target of a
   * `document` Work card on the visitor surface. Resolved server-side under
   * the visitor's share scope, so any other document 404s.
   */
  async getDocument(shareId: string, topicId: string, documentId: string) {
    return await lambdaClient.shareChat.getDocument.query({ documentId, shareId, topicId });
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

  /**
   * The visitor counterpart of `aiAgentService.setQueuedMessages`.
   */
  async setQueuedMessages(shareId: string, topicId: string, operationId: string, pending: boolean) {
    return await lambdaClient.shareChat.setQueuedMessages.mutate({
      operationId,
      pending,
      shareId,
      topicId,
    });
  }

  async refreshGatewayToken(shareId: string, topicId: string): Promise<{ token: string }> {
    return await lambdaClient.shareChat.refreshGatewayToken.query({ shareId, topicId });
  }

  /**
   * Mint the visitor's per-user JWT for the multiplexed Gateway WebSocket —
   * the visitor counterpart of `aiAgentService.issueGatewayUserToken`. Keyed by
   * shareId only (no topic / running operation required).
   */
  async issueGatewayUserToken(shareId: string): Promise<{ token: string }> {
    return await lambdaClient.shareChat.issueGatewayUserToken.query({ shareId });
  }
}

export const shareChatService = new ShareChatService();
