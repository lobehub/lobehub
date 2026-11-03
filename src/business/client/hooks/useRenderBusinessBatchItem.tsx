import { type GenerationBatch } from '@/types/generation';

export default function useRenderBusinessBatchItem(_batch: GenerationBatch) {
  return {
    businessBatchItem: null,
    shouldRenderBusinessBatchItem: false,
  };
}
