import { type GenerationBatch } from '@/types/generation';

export default function useRenderBusinessVideoBatchItem(_batch: GenerationBatch) {
  return {
    businessBatchItem: null,
    shouldRenderBusinessBatchItem: false,
  };
}
