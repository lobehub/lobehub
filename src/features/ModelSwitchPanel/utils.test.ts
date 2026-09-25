import { USD_TO_CNY } from '@lobechat/const/currency';
import { type Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { formatPriceMultiplier, getInputPriceMultiplier } from './utils';

describe('getInputPriceMultiplier', () => {
  it('uses the USD input rate per 1M tokens as the multiplier', () => {
    const pricing = {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    } as Pricing;

    expect(getInputPriceMultiplier(pricing)).toBe(3);
  });

  it('converts CNY pricing to USD', () => {
    const pricing = {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: USD_TO_CNY * 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    } as Pricing;

    expect(getInputPriceMultiplier(pricing)).toBeCloseTo(2);
  });

  it('uses the first tier of tiered pricing', () => {
    const pricing = {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 200_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    } as Pricing;

    expect(getInputPriceMultiplier(pricing)).toBe(1.25);
  });

  it('keeps free models at 0', () => {
    const pricing = {
      units: [{ name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' }],
    } as Pricing;

    expect(getInputPriceMultiplier(pricing)).toBe(0);
  });

  it('returns undefined without a text input price', () => {
    expect(getInputPriceMultiplier(undefined)).toBeUndefined();
    expect(
      getInputPriceMultiplier({
        units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
      } as Pricing),
    ).toBeUndefined();
  });
});

describe('formatPriceMultiplier', () => {
  it.each([
    [0.0125, '0.013'],
    [0.05, '0.05'],
    [0.3, '0.3'],
    [1, '1'],
    [1.25, '1.25'],
    [2.555, '2.56'],
    [15, '15'],
    [37.5, '38'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatPriceMultiplier(input)).toBe(expected);
  });
});
