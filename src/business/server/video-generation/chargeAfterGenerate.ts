interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  isError?: boolean;
  /** Total time from task submission to webhook callback (ms) */
  latency?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  usage?: { completionTokens: number; totalTokens: number };
  userId: string;
}

// eslint-disable-next-line unused-imports/no-unused-vars
export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {}
