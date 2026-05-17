import type { ModelParamsSchema } from '../standard-parameters';

export const gptImage1Schema: ModelParamsSchema = {
  imageUrls: { default: [], maxCount: 1, maxFileSize: 5 * 1024 * 1024 },
  prompt: { default: '' },
  size: {
    default: 'auto',
    enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
  },
};

export const gptImage2Schema: ModelParamsSchema = {
  imageUrls: { default: [], maxCount: 1, maxFileSize: 5 * 1024 * 1024 },
  prompt: { default: '' },
  size: {
    default: 'auto',
    enum: [
      'auto',
      '1024x1024',
      '1536x1024',
      '1024x1536',
      '2048x2048',
      '2048x1152',
      '3840x2160',
      '2160x3840',
    ],
  },
};
