import { type GenerationBatch } from '@/types/generation';

// eslint-disable-next-line unused-imports/no-unused-vars
export default function useRenderBusinessVideoBatchItem(batch: GenerationBatch) {
  return {
    businessBatchItem: null,
    shouldRenderBusinessBatchItem: false,
  };
}
