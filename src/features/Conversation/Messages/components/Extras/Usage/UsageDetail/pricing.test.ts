import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { getPriceLabels } from './pricing';

const fixed = (name: string, rate: number) => ({
  name,
  rate,
  strategy: 'fixed',
  unit: 'millionTokens',
});

const pricing = (...units: ReturnType<typeof fixed>[]) => ({ currency: 'USD', units }) as Pricing;

describe('getPriceLabels', () => {
  it('writes the dollar sign and two decimals on every rate', () => {
    const labels = getPriceLabels(
      pricing(fixed('textInput', 3), fixed('textOutput', 15), fixed('textInput_cacheRead', 0.3)),
    );

    expect(labels.input).toEqual({ amount: '3.00', text: '$3.00' });
    expect(labels.output).toEqual({ amount: '15.00', text: '$15.00' });
    expect(labels.cachedInput).toEqual({ amount: '0.30', text: '$0.30' });
  });

  it('shows every rate with the same decimals when one needs more', () => {
    const labels = getPriceLabels(pricing(fixed('textInput', 0.075), fixed('textOutput', 0.3)));

    expect(labels.input.text).toBe('$0.075');
    expect(labels.output.text).toBe('$0.300');
  });

  it('leaves out the cache rates a model does not quote', () => {
    const labels = getPriceLabels(pricing(fixed('textInput', 3), fixed('textOutput', 15)));

    expect(labels.cachedInput).toBeUndefined();
    expect(labels.writeCacheInput).toBeUndefined();
  });

  it('reads a missing rate as -- rather than $0.00', () => {
    const labels = getPriceLabels(pricing(fixed('textInput', 3)));

    expect(labels.output).toEqual({ text: '--' });
  });

  it('reads every rate as -- when the model has no pricing', () => {
    const labels = getPriceLabels(undefined);

    expect(labels.input.text).toBe('--');
    expect(labels.output.text).toBe('--');
  });
});
