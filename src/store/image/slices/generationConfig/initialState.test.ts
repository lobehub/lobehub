import { describe, expect, it } from 'vitest';

import { DEFAULT_IMAGE_GENERATION_PARAMETERS, initialGenerationConfigState } from './initialState';

describe('initialGenerationConfigState', () => {
  it('uses the canonical Nano Banana 2 resolution values', () => {
    expect(initialGenerationConfigState.parametersSchema.resolution?.enum).toEqual([
      '512',
      '1K',
      '2K',
      '4K',
    ]);
    expect(DEFAULT_IMAGE_GENERATION_PARAMETERS.resolution).toBe('1K');
  });
});
