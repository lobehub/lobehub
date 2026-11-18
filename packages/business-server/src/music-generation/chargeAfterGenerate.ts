import type { SpendOrigin } from '@lobechat/types';

interface ChargeParams {
  /** Inputs of the model's `pricing.units` (`song` × songs, `second` × duration). */
  computePriceParams?: { duration?: number; songs?: number };
  isError?: boolean;
  /** Total time from task submission to the stored result (ms) */
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
  userId: string;
  workspaceId?: string;
}

/**
 * Settle a music generation's pre-charge: charge the songs actually stored, or refund on
 * error. The open-source build does not bill generations.
 */
export async function chargeAfterGenerate(_params: ChargeParams): Promise<void> {}
