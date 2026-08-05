import type { RuntimeStreamEvent, StreamErrorInput, StreamSink } from '@lobechat/agent-runtime';
import { ChatErrorType, type ChatMessageError } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

export interface ClientRuntimeSession {
  assistantMessageId?: string;
}

const toChatMessageError = (error: unknown): ChatMessageError => {
  if (error && typeof error === 'object') {
    const record = error as Record<string, any>;
    const type = record.errorType ?? record.type ?? ChatErrorType.UnknownChatFetchError;

    return {
      ...record,
      body: record.body,
      message: typeof record.message === 'string' ? record.message : String(error),
      type,
    };
  }

  return {
    body: error,
    message: error instanceof Error ? error.message : String(error),
    type: ChatErrorType.UnknownChatFetchError,
  };
};

export class ClientRuntimeStreamSink implements StreamSink {
  constructor(
    private readonly get: () => ChatStore,
    private readonly operationId: string,
    private readonly session: ClientRuntimeSession,
  ) {}

  async publishChunk(): Promise<void> {}

  async publishError({ error }: StreamErrorInput): Promise<void> {
    if (!this.session.assistantMessageId) return;

    this.get().internal_dispatchMessage(
      {
        id: this.session.assistantMessageId,
        type: 'updateMessage',
        value: { error: toChatMessageError(error) },
      },
      { operationId: this.operationId },
    );
  }

  async publishEvent(event: RuntimeStreamEvent): Promise<void> {
    if (event.type === 'stream_start') {
      const assistantMessage = (event.data as { assistantMessage?: { id?: string } })
        .assistantMessage;
      if (!assistantMessage?.id) return;

      this.session.assistantMessageId = assistantMessage.id;
      this.get().associateMessageWithOperation(assistantMessage.id, this.operationId);
      return;
    }

    if (event.type === 'stream_retry') {
      const data = event.data as {
        attempt?: number;
        delayMs?: number;
        errorType?: string;
        maxAttempts?: number;
      };
      this.get().updateOperationMetadata(this.operationId, {
        streamRetry: {
          attempt: data.attempt,
          delayMs: data.delayMs,
          error: data.errorType,
          maxAttempts: data.maxAttempts,
        },
      });
      return;
    }

    if (event.type === 'stream_end') {
      this.get().updateOperationMetadata(this.operationId, { streamRetry: undefined });
      return;
    }

    if (event.type === 'visible_output_end') {
      this.get().updateOperationMetadata(this.operationId, { visibleLoadingDone: true });
    }
  }
}
