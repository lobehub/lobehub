import { describe, expect, it } from 'vitest';

import { CreateAiModelSchema } from './aiModel';

describe('CreateAiModelSchema', () => {
  const base = { id: 'prunaai/p-video', providerId: 'replicate' };

  it('accepts a model with no parameters', () => {
    expect(CreateAiModelSchema.safeParse(base).success).toBe(true);
  });

  it('accepts video parameters on a video model', () => {
    const result = CreateAiModelSchema.safeParse({
      ...base,
      parameters: {
        duration: { default: 5, max: 20, min: 1 },
        prompt: { default: '' },
        resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
      },
      type: 'video',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a parameter block that does not match the declared type', () => {
    // `duration` has no home in the image vocabulary.
    const result = CreateAiModelSchema.safeParse({
      ...base,
      parameters: { duration: { default: 5 }, prompt: { default: '' } },
      type: 'image',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a video parameter whose shape is wrong', () => {
    const result = CreateAiModelSchema.safeParse({
      ...base,
      // `resolution` needs an enum to render a picker.
      parameters: { prompt: { default: '' }, resolution: { default: '720p' } },
      type: 'video',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('invalid video parameters');
  });

  it('rejects parameters on a model type that has none', () => {
    const result = CreateAiModelSchema.safeParse({
      ...base,
      parameters: { prompt: { default: '' } },
      type: 'chat',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('only supported on image and video models');
  });
});
