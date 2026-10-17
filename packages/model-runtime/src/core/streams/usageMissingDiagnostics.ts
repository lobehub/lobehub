import type { ChatPayloadForTransformStream, StreamContext } from './protocol';

export const setOpenAIChatCompletionUsageMissingDiagnostics = (
  streamContext: StreamContext,
  payload: ChatPayloadForTransformStream | undefined,
  {
    finishReason,
    responseId,
  }: {
    finishReason?: string | null;
    responseId?: string;
  },
) => {
  streamContext.usageMissingDiagnostics = {
    apiMode: 'chat_completions',
    chunkIndex: streamContext.chunkIndex,
    finishReason,
    hasUsageMetadata: false,
    includeUsageRequested: payload?.includeUsageRequested,
    model: payload?.model,
    provider: payload?.provider,
    responseId,
    source: 'openai_chat_completions',
    terminalEventType: 'chat.completion.chunk',
  };
};
