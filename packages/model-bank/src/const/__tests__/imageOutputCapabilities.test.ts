import { describe, expect, it } from 'vitest';

import { applyImageOutputCapabilities } from '../imageOutputCapabilities';

/** The GPT Image 2.6 parameter schema as the LobeHub model config declares it. */
const declaredGptImage26Schema = {
  frameCount: { default: 9, max: 64, min: 2, step: 1 },
  frameDurationMs: { default: 200, max: 2000, min: 20, step: 10 },
  imageUrls: { default: [], maxCount: 1, maxFileSize: 5_242_880 },
  outputFormat: { default: 'png', enum: ['png', 'gif'] },
  prompt: { default: '' },
  quality: { default: 'auto', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] },
  size: { default: 'auto', enum: ['auto', '1024x1024'] },
};

describe('applyImageOutputCapabilities', () => {
  it.each(['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare'])(
    'offers only the static formats the LobeHub route serves for %s and hides the frame params',
    (model) => {
      const result = applyImageOutputCapabilities(declaredGptImage26Schema, {
        model,
        provider: 'lobehub',
      });

      expect(result?.outputFormat).toEqual({ default: 'png', enum: ['png', 'jpeg', 'webp'] });
      expect(result).not.toHaveProperty('frameCount');
      expect(result).not.toHaveProperty('frameDurationMs');
      expect(Object.keys(result!).sort()).toEqual([
        'imageUrls',
        'outputFormat',
        'prompt',
        'quality',
        'size',
      ]);
      // The input card is not mutated.
      expect(declaredGptImage26Schema.outputFormat.enum).toEqual(['png', 'gif']);
      expect(declaredGptImage26Schema).toHaveProperty('frameCount');
    },
  );

  it('keeps the declared GIF output on a provider without a route limit', () => {
    const result = applyImageOutputCapabilities(declaredGptImage26Schema, {
      model: 'gpt-image-2.6-sunburst',
      provider: 'openai',
    });

    expect(result).toBe(declaredGptImage26Schema);
  });

  it('falls back to the first offered format when the declared default is not served', () => {
    const result = applyImageOutputCapabilities(
      { outputFormat: { default: 'gif', enum: ['gif'] }, prompt: { default: '' } },
      { model: 'gpt-image-2.6-sunburst', provider: 'lobehub' },
    );

    expect(result?.outputFormat).toEqual({ default: 'png', enum: ['png', 'jpeg', 'webp'] });
  });

  it('hides frame params on any model whose output formats do not include gif', () => {
    const result = applyImageOutputCapabilities(
      {
        frameCount: { default: 9, max: 16, min: 2 },
        outputFormat: { default: 'png', enum: ['png', 'webp'] },
        prompt: { default: '' },
      },
      { model: 'some-image-model', provider: 'openai' },
    );

    expect(result).toEqual({
      outputFormat: { default: 'png', enum: ['png', 'webp'] },
      prompt: { default: '' },
    });
  });

  it('does not add an output format to a model that declares none', () => {
    const schema = { prompt: { default: '' }, size: { default: 'auto', enum: ['auto'] } };

    expect(
      applyImageOutputCapabilities(schema, {
        model: 'gpt-image-2.6-sunburst',
        provider: 'lobehub',
      }),
    ).toBe(schema);
  });

  it('passes through a missing schema', () => {
    expect(
      applyImageOutputCapabilities(undefined, {
        model: 'gpt-image-2.6-sunburst',
        provider: 'lobehub',
      }),
    ).toBeUndefined();
  });
});
