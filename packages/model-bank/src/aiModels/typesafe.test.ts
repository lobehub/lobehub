import { describe, expect, it } from 'vitest';

import { typeSafeModels } from './typesafe';

describe('typeSafeModels', () => {
  it('publishes Jev 1.14 as an enabled decision model', () => {
    expect(typeSafeModels).toEqual([
      expect.objectContaining({
        displayName: 'Jev 1.14',
        enabled: true,
        id: 'jev-1.14.0',
        pricing: {
          currency: 'USD',
          units: [
            {
              name: 'textInput',
              rate: 0.042,
              strategy: 'fixed',
              unit: 'millionTokens',
            },
          ],
        },
        type: 'decision',
      }),
    ]);
  });
});
