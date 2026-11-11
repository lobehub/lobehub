import { describe, expect, it } from 'vitest';

import { extractDefaultValues, ModelParamsMetaSchema } from '../standard-parameters';
import { gptImage2Schema, gptImage26Schema } from './imageParameters';

describe('gptImage26Schema', () => {
  it('validates against the parameter meta-schema', () => {
    expect(() => ModelParamsMetaSchema.parse(gptImage26Schema)).not.toThrow();
  });

  it('defaults to a static PNG and offers an animated GIF', () => {
    expect(gptImage26Schema.outputFormat).toEqual({ default: 'png', enum: ['png', 'gif'] });
    expect(extractDefaultValues(gptImage26Schema)).toMatchObject({ outputFormat: 'png' });
  });

  it('bounds the GIF frames to what the Images API accepts', () => {
    expect(gptImage26Schema.frameCount).toEqual({ default: 9, max: 16, min: 2, step: 1 });
    expect(gptImage26Schema.frameDurationMs).toEqual({
      default: 200,
      max: 2000,
      min: 20,
      step: 10,
    });
  });

  it('offers the six quality tiers of the 2.6 models, defaulting to auto', () => {
    expect(gptImage26Schema.quality).toEqual({
      default: 'auto',
      enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('shares the size list and the single reference image with GPT Image 2', () => {
    expect(gptImage26Schema.size).toBe(gptImage2Schema.size);
    expect(gptImage26Schema.imageUrls).toBe(gptImage2Schema.imageUrls);
  });

  it('keeps GIF output off GPT Image 2', () => {
    expect(gptImage2Schema.outputFormat).toBeUndefined();
    expect(gptImage2Schema.frameCount).toBeUndefined();
    expect(gptImage2Schema.frameDurationMs).toBeUndefined();
  });
});
