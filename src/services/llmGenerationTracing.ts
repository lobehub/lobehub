import { lambdaClient } from '@/libs/trpc/client';

export type LLMGenerationTracingFeedbackSignal = 'positive' | 'negative' | 'neutral';

export interface RecordFeedbackParams {
  data?: Record<string, unknown>;
  score?: number;
  signal: LLMGenerationTracingFeedbackSignal;
  source: string;
  tracingId: string;
}

class LLMGenerationTracingService {
  recordFeedback = async (params: RecordFeedbackParams) => {
    return lambdaClient.llmGenerationTracing.recordFeedback.mutate(params, {
      context: { showNotification: false },
    });
  };
}

export const llmGenerationTracingService = new LLMGenerationTracingService();
