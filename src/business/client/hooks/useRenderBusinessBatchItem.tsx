import { GenerationBatch } from '@/types/generation';

// eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
export default function useRenderBusinessBatchItem(batch: GenerationBatch) {
  return {
    businessBatchItem: null,
    shouldRenderBusinessBatchItem: false,
  };
}
