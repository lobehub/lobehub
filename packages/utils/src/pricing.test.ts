import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  getAudioInputUnitRate,
  getAudioOutputUnitRate,
  getCachedAudioInputUnitRate,
  getCachedTextInputUnitRate,
  getTextInputUnitRate,
  getTextOutputUnitRate,
  getUnitRateByName,
  getWriteCacheInputUnitRate,
} from './pricing';

describe('pricing utilities (new)', () => {
  describe('getUnitRateByName', () => {
    it('returns undefined when pricing or unitName is missing', () => {
      expect(getUnitRateByName()).toBeUndefined();
      const p = { units: [] } as Pricing;
      expect(getUnitRateByName(p)).toBeUndefined();
    });

    it('returns undefined when unit not found', () => {
      const pricing: Pricing = {
        units: [{ name: 'textOutput', strategy: 'fixed', unit: 'millionTokens', rate: 0.002 }],
      };
      expect(getUnitRateByName(pricing, 'textInput')).toBeUndefined();
    });

    it('handles fixed strategy', () => {
      const pricing: Pricing = {
        units: [{ name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate: 0.001 }],
      };
      expect(getUnitRateByName(pricing, 'textInput')).toBe(0.001);
    });

    it('handles tiered strategy (first tier)', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'audioInput',
            strategy: 'tiered',
            unit: 'second',
            tiers: [
              { rate: 0.01, upTo: 3600 },
              { rate: 0.008, upTo: 'infinity' },
            ],
          },
        ],
      };
      expect(getUnitRateByName(pricing, 'audioInput')).toBe(0.01);
    });

    it('returns undefined when tiered.tiers is absent or empty', () => {
      const noTiers: Pricing = {
        units: [
          { name: 'textInput', strategy: 'tiered', unit: 'millionTokens', tiers: undefined as any },
        ],
      };
      const emptyTiers: Pricing = {
        units: [{ name: 'textInput', strategy: 'tiered', unit: 'millionTokens', tiers: [] }],
      };
      expect(getUnitRateByName(noTiers, 'textInput')).toBeUndefined();
      expect(getUnitRateByName(emptyTiers, 'textInput')).toBeUndefined();
    });

    it('handles lookup strategy (first price value)', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'textInput',
            strategy: 'lookup',
            unit: 'millionTokens',
            lookup: {
              pricingParams: ['model'],
              prices: { a: 0.001, b: 0.03 },
            },
          },
        ],
      };
      expect(getUnitRateByName(pricing, 'textInput')).toBe(0.001);
    });

    it('returns undefined when lookup missing or has no prices', () => {
      const missingLookup: Pricing = {
        units: [
          {
            name: 'textInput',
            strategy: 'lookup',
            unit: 'millionTokens',
            lookup: undefined as any,
          },
        ],
      } as any;
      const emptyPrices: Pricing = {
        units: [
          {
            name: 'textInput',
            strategy: 'lookup',
            unit: 'millionTokens',
            lookup: { pricingParams: ['model'], prices: {} },
          },
        ],
      };
      expect(getUnitRateByName(missingLookup, 'textInput')).toBeUndefined();
      expect(getUnitRateByName(emptyPrices, 'textInput')).toBeUndefined();
    });

    it('works with multiple units', () => {
      const pricing: Pricing = {
        units: [
          { name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate: 0.001 },
          { name: 'textOutput', strategy: 'fixed', unit: 'millionTokens', rate: 0.002 },
          {
            name: 'audioInput',
            strategy: 'tiered',
            unit: 'second',
            tiers: [
              { rate: 0.01, upTo: 3600 },
              { rate: 0.008, upTo: 'infinity' },
            ],
          },
        ],
      };
      expect(getUnitRateByName(pricing, 'textInput')).toBe(0.001);
      expect(getUnitRateByName(pricing, 'textOutput')).toBe(0.002);
      expect(getUnitRateByName(pricing, 'audioInput')).toBe(0.01);
    });
  });

  describe('wrapper helpers', () => {
    it('return the same values as getUnitRateByName for each unit', () => {
      const pricing: Pricing = {
        units: [
          { name: 'textInput', strategy: 'fixed', unit: 'millionTokens', rate: 0.001 },
          { name: 'textOutput', strategy: 'fixed', unit: 'millionTokens', rate: 0.002 },
          {
            name: 'audioInput',
            strategy: 'tiered',
            unit: 'second',
            tiers: [
              { rate: 0.01, upTo: 3600 },
              { rate: 0.008, upTo: 'infinity' },
            ],
          },
          { name: 'audioOutput', strategy: 'fixed', unit: 'second', rate: 0.015 },
          { name: 'textInput_cacheRead', strategy: 'fixed', unit: 'millionTokens', rate: 0.0005 },
          {
            name: 'textInput_cacheWrite',
            strategy: 'lookup',
            unit: 'millionTokens',
            lookup: { pricingParams: ['ttl'], prices: { '5': 0.2, '60': 0.6 } },
          },
          { name: 'audioInput_cacheRead', strategy: 'fixed', unit: 'second', rate: 0.005 },
        ],
      };

      expect(getTextInputUnitRate(pricing)).toBe(getUnitRateByName(pricing, 'textInput'));
      expect(getTextOutputUnitRate(pricing)).toBe(getUnitRateByName(pricing, 'textOutput'));
      expect(getAudioInputUnitRate(pricing)).toBe(getUnitRateByName(pricing, 'audioInput'));
      expect(getAudioOutputUnitRate(pricing)).toBe(getUnitRateByName(pricing, 'audioOutput'));
      expect(getCachedTextInputUnitRate(pricing)).toBe(
        getUnitRateByName(pricing, 'textInput_cacheRead'),
      );
      expect(getWriteCacheInputUnitRate(pricing)).toBe(
        getUnitRateByName(pricing, 'textInput_cacheWrite'),
      );
      expect(getCachedAudioInputUnitRate(pricing)).toBe(
        getUnitRateByName(pricing, 'audioInput_cacheRead'),
      );

      // also validate expected concrete values for clarity
      expect(getTextInputUnitRate(pricing)).toBe(0.001);
      expect(getTextOutputUnitRate(pricing)).toBe(0.002);
      expect(getAudioInputUnitRate(pricing)).toBe(0.01);
      expect(getAudioOutputUnitRate(pricing)).toBe(0.015);
      expect(getCachedTextInputUnitRate(pricing)).toBe(0.0005);
      expect(getWriteCacheInputUnitRate(pricing)).toBe(0.2);
      expect(getCachedAudioInputUnitRate(pricing)).toBe(0.005);
    });
  });
});
