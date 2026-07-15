import type {
  CompressionGroupCreateInput,
  CompressionGroupCreateResult,
  CompressionGroupFinalizeInput,
  CompressionGroupFinalizeResult,
  CompressionGroupRollbackInput,
  CompressionGroupRollbackResult,
  CompressionGroupUpdateInput,
  CompressionPromptInput,
  CompressionPromptResult,
  CompressionTransport,
} from '@lobechat/agent-runtime';
import { chainCompressContext } from '@lobechat/prompts';

import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);

const isAbortError = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'AbortError' ||
    error.message.includes('aborted') ||
    error.message.includes('cancelled'));

interface ActiveCompression {
  compressionOperationId: string;
  messageGroupId?: string;
  parentMessageId?: string;
  summaryOperationId?: string;
}

export class ClientCompressionTransport implements CompressionTransport {
  private activeCompression?: ActiveCompression;

  constructor(
    private readonly get: () => ChatStore,
    private readonly messageKey: string,
    private readonly rootOperationId: string,
  ) {}

  async buildPrompt(input: CompressionPromptInput): Promise<CompressionPromptResult> {
    const payload = chainCompressContext(input.messages, input.existingSummary);
    return { messages: payload.messages! };
  }

  async createGroup(input: CompressionGroupCreateInput): Promise<CompressionGroupCreateResult> {
    const store = this.get();
    const rootOperation = store.operations[this.rootOperationId];
    if (!rootOperation) throw new Error(`Operation not found: ${this.rootOperationId}`);

    const agentId = input.agentId ?? rootOperation.context.agentId;
    if (!agentId) throw new Error('Client context compression requires an agent id');

    const operationContext = {
      ...rootOperation.context,
      agentId,
      groupId: input.groupId ?? rootOperation.context.groupId,
      threadId: input.threadId ?? rootOperation.context.threadId,
      topicId: input.topicId,
    };
    const latestAssistantMessage = (store.dbMessagesMap[this.messageKey] ?? []).findLast(
      (message) => message.role === 'assistant',
    );
    const compressionOperation = store.startOperation({
      context: { ...operationContext, messageId: latestAssistantMessage?.id },
      metadata: { messageCount: input.messageIds.length, startTime: Date.now() },
      parentOperationId: this.rootOperationId,
      type: 'contextCompression',
    });

    this.activeCompression = {
      compressionOperationId: compressionOperation.operationId,
      parentMessageId: latestAssistantMessage?.id,
    };

    let result: Awaited<ReturnType<typeof messageService.createCompressionGroup>> | undefined;

    try {
      result = await messageService.createCompressionGroup({
        agentId,
        groupId: operationContext.groupId,
        messageIds: input.messageIds,
        threadId: operationContext.threadId,
        topicId: input.topicId,
      });

      this.activeCompression.messageGroupId = result.messageGroupId;
      store.replaceMessages(result.messages, { context: operationContext });

      const summaryOperation = store.startOperation({
        context: { ...operationContext, messageId: result.messageGroupId },
        parentOperationId: compressionOperation.operationId,
        type: 'generateSummary',
      });
      this.activeCompression.summaryOperationId = summaryOperation.operationId;

      if (compressionOperation.abortController.signal.aborted) {
        summaryOperation.abortController.abort(compressionOperation.abortController.signal.reason);
      }

      return {
        messageGroupId: result.messageGroupId,
        messages: result.messages,
        messagesToSummarize: result.messagesToSummarize,
        signal: summaryOperation.abortController.signal,
      };
    } catch (error) {
      if (result) {
        try {
          const rollback = await messageService.cancelCompression({
            agentId,
            groupId: operationContext.groupId,
            messageGroupId: result.messageGroupId,
            threadId: operationContext.threadId,
            topicId: input.topicId,
          });
          store.replaceMessages(rollback.messages, { context: operationContext });
        } catch (rollbackError) {
          console.error('Failed to rollback client context compression', rollbackError);
        }
      }

      this.failActiveOperations(error);
      throw error;
    }
  }

  async finalizeGroup(
    input: CompressionGroupFinalizeInput,
  ): Promise<CompressionGroupFinalizeResult> {
    const operationContext = this.getOperationContext(input);
    const result = await messageService.finalizeCompression({
      agentId: operationContext.agentId,
      content: input.content,
      groupId: operationContext.groupId,
      messageGroupId: input.messageGroupId,
      sourceGroupIds: input.sourceGroupIds,
      threadId: operationContext.threadId,
      topicId: input.topicId,
    });
    const store = this.get();

    if (result.messages) store.replaceMessages(result.messages, { context: operationContext });
    if (this.activeCompression?.summaryOperationId) {
      store.completeOperation(this.activeCompression.summaryOperationId);
    }
    if (this.activeCompression) {
      store.completeOperation(this.activeCompression.compressionOperationId, {
        groupId: input.messageGroupId,
        parentMessageId: this.activeCompression.parentMessageId,
      });
    }

    return result;
  }

  async rollbackGroup(
    input: CompressionGroupRollbackInput,
  ): Promise<CompressionGroupRollbackResult> {
    const operationContext = this.getOperationContext(input);

    try {
      const result = await messageService.cancelCompression({
        agentId: operationContext.agentId,
        groupId: operationContext.groupId,
        messageGroupId: input.messageGroupId,
        threadId: operationContext.threadId,
        topicId: input.topicId,
      });
      this.get().replaceMessages(result.messages, { context: operationContext });
      return result;
    } finally {
      this.failActiveOperations(input.error);
    }
  }

  updateGroup(input: CompressionGroupUpdateInput): void {
    const operationId =
      this.activeCompression?.summaryOperationId ??
      this.activeCompression?.compressionOperationId ??
      this.rootOperationId;

    this.get().internal_dispatchMessage(
      { id: input.messageGroupId, type: 'updateMessage', value: { content: input.content } },
      { operationId },
    );
  }

  private failActiveOperations(error: unknown) {
    if (!this.activeCompression) return;

    const store = this.get();
    const operationIds = [
      this.activeCompression.summaryOperationId,
      this.activeCompression.compressionOperationId,
    ].filter((operationId): operationId is string => Boolean(operationId));
    const aborted =
      isAbortError(error) ||
      operationIds.some((operationId) =>
        Boolean(store.operations[operationId]?.abortController.signal.aborted),
      );

    for (const operationId of operationIds) {
      const operation = store.operations[operationId];
      if (!operation || operation.status !== 'running') continue;

      if (aborted) {
        store.cancelOperation(operationId, 'Context compression cancelled');
      } else {
        store.failOperation(operationId, {
          message: getErrorMessage(error),
          type:
            operationId === this.activeCompression.summaryOperationId
              ? 'summary_generation_failed'
              : 'compression_failed',
        });
      }
    }
  }

  private getOperationContext(input: {
    agentId?: string;
    groupId?: string;
    threadId?: string;
    topicId: string;
  }) {
    const rootOperation = this.get().operations[this.rootOperationId];
    if (!rootOperation) throw new Error(`Operation not found: ${this.rootOperationId}`);

    const agentId = input.agentId ?? rootOperation.context.agentId;
    if (!agentId) throw new Error('Client context compression requires an agent id');

    return {
      ...rootOperation.context,
      agentId,
      groupId: input.groupId ?? rootOperation.context.groupId,
      threadId: input.threadId ?? rootOperation.context.threadId,
      topicId: input.topicId,
    };
  }
}
