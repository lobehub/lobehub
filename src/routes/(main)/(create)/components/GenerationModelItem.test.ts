/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { resolveGenerationPrice } from './GenerationModelItem';

describe('resolveGenerationPrice', () => {
  it('prefers the exact price over the approximate one', () => {
    expect(resolveGenerationPrice({ approxUsd: 0.05, exactUsd: 0.04, isVideo: false })).toEqual({
      amount: '0.04',
      key: 'GenerationModelItem.creditsPerImageExact',
    });
  });

  it('falls back to the approximate price', () => {
    expect(resolveGenerationPrice({ approxUsd: 0.8, isVideo: true })).toEqual({
      amount: '0.80',
      key: 'GenerationModelItem.creditsPerVideoApproximate',
    });
  });

  it('keeps at least two decimals and groups thousands', () => {
    expect(resolveGenerationPrice({ exactUsd: 1234.5, isVideo: false })?.amount).toBe('1,234.50');
    expect(resolveGenerationPrice({ exactUsd: 0.039, isVideo: false })?.amount).toBe('0.039');
  });

  it('shows a free model as $0.00 rather than hiding the price', () => {
    expect(resolveGenerationPrice({ exactUsd: 0, isVideo: false })?.amount).toBe('0.00');
  });

  it('returns nothing when the model has no USD price', () => {
    expect(resolveGenerationPrice({ isVideo: false })).toBeUndefined();
  });
});
