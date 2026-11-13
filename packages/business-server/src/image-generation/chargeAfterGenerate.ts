import { type ModelPricingContext, type RouteAttemptIdentity } from '@lobechat/model-runtime';
import { type ModelPerformance, type ModelUsage, type SpendOrigin } from '@lobechat/types';

interface ChargeParams {
  /** Generation params, to price fixed per-image models. */
  computePriceParams?: Record<string, unknown>;
  isError?: boolean;
  metadata: SpendOrigin & {
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
  /** Router attempt that generated the image; attributes the charge to its channel. */
  routeAttempt?: RouteAttemptIdentity;
  userId: string;
  workspaceId?: string;
}

export async function chargeAfterGenerate(_params: ChargeParams): Promise<void> {}
