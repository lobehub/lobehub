import { describe, expect, it } from 'vitest';

import {
  nanoBanana2LiteParameters,
  nanoBanana2Parameters,
  nanoBananaParameters,
  nanoBananaProParameters,
} from '../imageParameters';

describe('thinkingLevel presets', () => {
  // Each model rejects the levels it does not list, so a preset that offers a
  // wider range than its model accepts turns into a 400 at generation time.
  it('offers minimal and high for Nano Banana 2', () => {
    expect(nanoBanana2Parameters.thinkingLevel).toEqual({
      default: 'minimal',
      enum: ['minimal', 'high'],
    });
  });

  it('offers minimal and high for Nano Banana 2 Lite', () => {
    expect(nanoBanana2LiteParameters.thinkingLevel).toEqual({
      default: 'minimal',
      enum: ['minimal', 'high'],
    });
  });

  it('offers all four levels for Nano Banana Pro', () => {
    expect(nanoBananaProParameters.thinkingLevel).toEqual({
      default: 'medium',
      enum: ['minimal', 'low', 'medium', 'high'],
    });
  });

  it('leaves Nano Banana out, because it rejects thinkingConfig entirely', () => {
    expect(nanoBananaParameters.thinkingLevel).toBeUndefined();
  });
});
