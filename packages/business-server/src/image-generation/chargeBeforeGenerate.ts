import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';

interface ChargeParams {
  /**
   * Set when the generation was requested by an agent-share visitor: the run
   * is driven by `visitorUserId` but billed to the share owned by `agentId`,
   * not to `userId`'s ordinary balance. The OSS default charges nothing, so
   * this is only a pass-through contract for business implementations.
   */
  agentShare?: { agentId: string; visitorUserId: string } | null;
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
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
