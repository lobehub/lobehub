import { describe, expect, it } from 'vitest';

import { naceModels } from './nace';

describe('naceModels', () => {
  it('publishes Drex Max and Drex 2.0 as enabled decision models billed on input only', () => {
    const pricing = (rate: number) => ({
      currency: 'USD',
      units: [{ name: 'textInput', rate, strategy: 'fixed', unit: 'millionTokens' }],
    });

    expect(naceModels).toEqual([
      expect.objectContaining({
        contextWindowTokens: 262_144,
        displayName: 'Drex Max',
        enabled: true,
        id: 'drex-max',
        pricing: pricing(0.03),
        type: 'decision',
      }),
      expect.objectContaining({
        contextWindowTokens: 262_144,
        displayName: 'Drex 2.0',
        enabled: true,
        id: 'drex-v2.0',
        pricing: pricing(0.06),
        type: 'decision',
      }),
    ]);
  });
});
