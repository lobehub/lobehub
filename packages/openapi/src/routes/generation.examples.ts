import type { GenerationPayload } from '../types/generation.type';

/** Example generation published in the spec for the generation routes. */
export const GENERATION_EXAMPLE = {
  asset: {
    coverUrl: null,
    duration: null,
    height: 1024,
    thumbnailUrl: 'https://files.lobehub.com/generations/thumb_2xN8kq.webp',
    url: 'https://files.lobehub.com/generations/2xN8kq.png',
    width: 1024,
  },
  batchId: 'gb_q7PzJ2mXc4Ld',
  createdAt: '2026-01-15T08:30:00.000Z',
  error: null,
  fileId: 'file_8HsW1nVb3QkE',
  id: 'gen_3KdLx9TzQw7v',
  model: 'gpt-image-1',
  prompt: 'A lighthouse on a cliff at dawn, watercolor',
  provider: 'openai',
  seed: 42,
  status: 'success',
  topicId: 'gt_Vb5nR2kLp8Ws',
  type: 'image',
} satisfies GenerationPayload;
