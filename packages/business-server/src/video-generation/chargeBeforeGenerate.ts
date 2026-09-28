import type { SpendOrigin } from '@lobechat/types';

import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  /** Origin of the request, preserved for deferred video spend attribution. */
  spendOrigin?: SpendOrigin;
  userId: string;
  workspaceId?: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: Record<string, unknown>;
}

export async function chargeBeforeGenerate(_params: ChargeParams): Promise<ChargeBeforeResult> {
  return {};
}
