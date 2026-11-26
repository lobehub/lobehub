import { describe, expect, it } from 'vitest';

import { normalizeImageGenerationParams } from './normalizeImageGenerationParams';

describe('normalizeImageGenerationParams', () => {
  it('omits the manual size for GIF without mutating the input', () => {
    const params = { outputFormat: 'gif', size: '1024x1024' };

    expect(normalizeImageGenerationParams(params, 'gpt-image-2.6-flare')).toEqual({
      outputFormat: 'gif',
    });
    expect(params).toEqual({ outputFormat: 'gif', size: '1024x1024' });
  });

  it('preserves passthrough GIF sizes for other models', () => {
    const params = { outputFormat: 'gif', size: '768x768' };
    expect(normalizeImageGenerationParams(params, 'custom-gif-model')).toBe(params);
  });

  it('matches the runtime output-format alias precedence for passthrough callers', () => {
    expect(
      normalizeImageGenerationParams(
        { output_format: 'gif', size: '1024x1024' },
        'gpt-image-2.6-flare',
      ),
    ).toEqual({
      output_format: 'gif',
    });
    const params = { outputFormat: 'png', output_format: 'gif', size: '1536x1024' };
    expect(normalizeImageGenerationParams(params, 'gpt-image-2.6-flare')).toBe(params);
  });

  it.each(['png', 'jpeg', 'webp', undefined])(
    'preserves static image dimensions for %s',
    (outputFormat) => {
      const params = { outputFormat, size: '1536x1024', width: 1536, height: 1024 };
      expect(normalizeImageGenerationParams(params, 'gpt-image-2.6-flare')).toBe(params);
    },
  );
});
