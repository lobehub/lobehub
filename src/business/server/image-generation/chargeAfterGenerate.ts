import { type ModelUsage } from '@/types/index';

interface ChargeParams {
  latency?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  modelUsage?: ModelUsage;
  provider: string;
  userId: string;
}

// eslint-disable-next-line unused-imports/no-unused-vars
export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {}
