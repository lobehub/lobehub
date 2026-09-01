import { type SpendOrigin } from '@lobechat/types';

import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';

interface ChargeParams {
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
  /**
   * Origin of the request, so an implementation that defers the charge to a
   * later async step can persist it and still attribute the final spend.
   */
  spendOrigin?: SpendOrigin;
  userId: string;
  workspaceId?: string;
}

type ChargeResult =
  | undefined
  | {
      data: {
        batch: NewGenerationBatch;
        generations: NewGeneration[];
      };
      success: true;
    }
  | {
      /**
       * Opaque per-generation billing handles, threaded back to
       * `chargeAfterGenerate` via `asyncTask.metadata.precharge` (one entry per
       * generation). Stored verbatim; the router never reads their fields.
       */
      prechargeItems?: unknown[];
    };

export async function chargeBeforeGenerate(_params: ChargeParams): Promise<ChargeResult> {
  return undefined;
}
