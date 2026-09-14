import { describe, expect, it } from 'vitest';

import { gptImage25Schema, gptImage2Schema } from '../../const/imageParameters';
import { LOBE_DEFAULT_MODEL_LIST } from '../index';

const GPT_IMAGE_25_QUALITY = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];

const findOpenAICard = (id: string) =>
  LOBE_DEFAULT_MODEL_LIST.find((model) => model.providerId === 'openai' && model.id === id);

describe('GPT Image 2.5 model cards', () => {
  it.each(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])(
    'registers %s as an enabled image model carrying the 2.5 quality tiers',
    (id) => {
      const card = findOpenAICard(id);

      expect(card).toBeDefined();
      expect(card).toMatchObject({
        enabled: true,
        parameters: { quality: { default: 'auto', enum: GPT_IMAGE_25_QUALITY } },
        type: 'image',
      });
    },
  );

  it('offers the six quality tiers the GPT Image 2.5 model pages list', () => {
    expect(gptImage25Schema.quality?.enum).toEqual(GPT_IMAGE_25_QUALITY);
  });

  it.each(['xhigh', 'max'])('keeps %s off the GPT Image 2 schema, which rejects it', (quality) => {
    // Measured against the Images API: both tiers succeed on the 2.5 models, while gpt-image-2
    // answers 400 "The model 'gpt-image-2' does not support quality '<tier>'".
    expect(gptImage2Schema.quality?.enum ?? []).not.toContain(quality);
  });

  it('reuses the GPT Image 2 size and reference-image constraints', () => {
    expect(gptImage25Schema.size).toBe(gptImage2Schema.size);
    expect(gptImage25Schema.imageUrls).toBe(gptImage2Schema.imageUrls);
  });
});
