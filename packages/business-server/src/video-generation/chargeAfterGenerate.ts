import { type SpendOrigin, type VideoGenerationRoute } from '@lobechat/types';

interface ChargeParams {
  computePriceParams?: { duration?: number; generateAudio?: boolean; resolution?: string };
  isError?: boolean;
  /** Total time from task submission to webhook callback (ms) */
  latency?: number;
  metadata: SpendOrigin & {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: Record<string, unknown>;
  provider: string;
  /** Route that created the video; attributes the completion charge to its channel. */
  route?: VideoGenerationRoute;
  usage?: { completionTokens: number; totalTokens: number };
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(_params: ChargeParams): Promise<void> {}
