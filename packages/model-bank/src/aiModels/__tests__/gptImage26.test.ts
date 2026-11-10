import { describe, expect, it } from 'vitest';

import { gptImage2Schema, gptImage26Schema } from '../../const/imageParameters';
import { extractDefaultValues, ModelParamsMetaSchema } from '../../standard-parameters';
import { LOBE_DEFAULT_MODEL_LIST } from '../index';

const findOpenAICard = (id: string) =>
  LOBE_DEFAULT_MODEL_LIST.find((model) => model.providerId === 'openai' && model.id === id);

describe('GPT Image 2.6 model cards', () => {
  it.each(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])(
    'registers %s as an enabled image model on the 2.6 schema',
    (id) => {
      const card = findOpenAICard(id);

      expect(card).toMatchObject({ enabled: true, type: 'image' });
      expect(card?.parameters).toBe(gptImage26Schema);
    },
  );

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

  it('offers the six quality tiers of the 2.6 models', () => {
    expect(gptImage26Schema.quality?.enum).toEqual([
      'auto',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('keeps GIF output off GPT Image 2', () => {
    expect(gptImage2Schema.outputFormat).toBeUndefined();
    expect(gptImage2Schema.frameCount).toBeUndefined();
  });
});
