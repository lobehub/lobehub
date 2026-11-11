import { describe, expect, it } from 'vitest';

import { gptImage26Schema } from '../../const/imageParameters';
import { openaiImageModels } from './nonChat';

describe('GPT Image 2.6 model cards', () => {
  it.each(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])(
    'registers %s as an enabled official image model on the 2.6 schema',
    (id) => {
      const card = openaiImageModels.find((model) => model.id === id);

      expect(card).toMatchObject({
        enabled: true,
        isOfficial: true,
        releasedAt: '2026-11-04',
        type: 'image',
      });
      expect(card?.parameters).toBe(gptImage26Schema);
      /** @see https://developers.openai.com/api/docs/pricing */
      expect(card?.pricing?.units).toEqual([
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ]);
    },
  );
});
