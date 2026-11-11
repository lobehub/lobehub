import { describe, expect, it } from 'vitest';

import { ModelParamsMetaSchema } from '../standard-parameters';
import { gptImage2Schema, gptImage26Schema } from './imageParameters';

describe('gptImage26Schema', () => {
  it('declares GIF output within API bounds and six quality tiers, sharing GPT Image 2 sizes', () => {
    expect(() => ModelParamsMetaSchema.parse(gptImage26Schema)).not.toThrow();
    expect(gptImage26Schema).toMatchObject({
      frameCount: { default: 9, max: 16, min: 2, step: 1 },
      frameDurationMs: { default: 200, max: 2000, min: 20, step: 10 },
      imageUrls: gptImage2Schema.imageUrls,
      outputFormat: { default: 'png', enum: ['png', 'gif'] },
      quality: { default: 'auto', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] },
      size: gptImage2Schema.size,
    });
  });

  it('keeps GIF output off GPT Image 2', () => {
    for (const key of ['outputFormat', 'frameCount', 'frameDurationMs'])
      expect(gptImage2Schema).not.toHaveProperty(key);
  });
});
