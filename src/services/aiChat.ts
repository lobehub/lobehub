import { type SendMessageServerParams, type StructureOutputParams } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';

import { lambdaClient, withLlmRelay } from '@/libs/trpc/client';
import { oneShotRelay } from '@/services/llmRelay';

export interface RecordTracingFeedbackParams {
  data?: Record<string, unknown>;
  score?: number;
  signal: 'positive' | 'negative' | 'neutral';
  source: string;
  tracingId: string;
}

class AiChatService {
  sendMessageInServer = async (
    params: SendMessageServerParams,
    abortController: AbortController,
  ) => {
    return lambdaClient.aiChat.sendMessageInServer.mutate(cleanObject(params), {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };

  /**
   * Structured output (topic / thread titles, input completion, supervisor
   * decisions, builder suggestions). A provider only this device reaches is
   * relayed back to this tab by the server (one-shot relay).
   */
  generateJSON = async (params: StructureOutputParams, abortController: AbortController) =>
    oneShotRelay.run(
      params.provider,
      (relay) =>
        lambdaClient.aiChat.outputJSON.mutate(params, {
          context: { showNotification: false, ...withLlmRelay(relay)?.context },
          signal: abortController?.signal,
        }),
      { signal: abortController?.signal },
    );

  recordTracingFeedback = async (params: RecordTracingFeedbackParams) => {
    return lambdaClient.llmGenerationTracing.recordFeedback.mutate(params, {
      context: { showNotification: false },
    });
  };
}

export const aiChatService = new AiChatService();
