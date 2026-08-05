interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean; resolution?: string };
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
  workspaceId?: string;
}

export async function chargeAfterGenerate(_params: ChargeParams): Promise<void> {}
