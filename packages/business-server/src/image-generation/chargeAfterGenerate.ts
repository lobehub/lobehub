import { type ModelPricingContext } from '@lobechat/model-runtime';

import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
  isError?: boolean;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  /** Opaque billing handle passed through from `asyncTask.metadata.precharge`. */
  prechargeResult?: unknown;
  pricingContext?: ModelPricingContext;
  provider: string;
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(_params: ChargeParams): Promise<void> {}
