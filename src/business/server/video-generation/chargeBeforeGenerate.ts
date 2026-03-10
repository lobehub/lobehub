import type { NewGeneration, NewGenerationBatch } from '@/database/schemas';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  userId: string;
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

export async function chargeBeforeGenerate(
  // eslint-disable-next-line unused-imports/no-unused-vars
  params: ChargeParams,
): Promise<ChargeBeforeResult> {
  return {};
}
