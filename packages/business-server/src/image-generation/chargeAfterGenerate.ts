import { type ModelPricingContext } from '@lobechat/model-runtime';

import { type ModelPerformance, type ModelUsage } from '@/types/index';

interface ChargeParams {
  /**
   * Set when the generation was requested by an agent-share visitor: the run
   * is driven by `visitorUserId` but billed to the share owned by `agentId`,
   * not to `userId`'s ordinary balance. The OSS default charges nothing, so
   * this is only a pass-through contract for business implementations.
   */
  agentShare?: { agentId: string; visitorUserId: string } | null;
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
