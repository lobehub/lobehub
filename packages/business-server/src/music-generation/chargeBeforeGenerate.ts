import type { SpendOrigin } from '@lobechat/types';

import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import type { CreateMusicServicePayload } from '@/server/routers/lambda/music';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateMusicServicePayload['params'];
  provider: string;
  /** Songs the provider returns for this request; the pre-charge covers all of them. */
  songCount: number;
  /** Origin of the request, preserved for deferred music spend attribution. */
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

/**
 * Pre-charge a music generation before it is submitted. The open-source build does not
 * bill generations, so it never pre-charges or blocks.
 */
export async function chargeBeforeGenerate(_params: ChargeParams): Promise<ChargeBeforeResult> {
  return {};
}
