import { describe, expect, it } from 'vitest';

import { aggregateKimiCodeUsage, parseKimiCodeWireUsage, toKimiCodeUsageData } from './usage';

const usageLine = (usage: Record<string, number>) =>
  JSON.stringify({ content: 'Working.', role: 'assistant', usage });

const usageRecordLine = (model: string, usage: Record<string, number>) =>
  JSON.stringify({ agentId: 'main', model, time: 1_700_000_000_000, type: 'usage.record', usage });

describe('kimiCode usage', () => {
  describe('toKimiCodeUsageData', () => {
    it('maps wire usage fields onto the UsageData cache split', () => {
      expect(
        toKimiCodeUsageData({
          inputCacheCreation: 100,
          inputCacheRead: 22_784,
          inputOther: 225,
          output: 27,
        }),
      ).toEqual({
        inputCacheMissTokens: 225,
        inputCachedTokens: 22_784,
        inputWriteCacheTokens: 100,
        totalInputTokens: 23_109,
        totalOutputTokens: 27,
        totalTokens: 23_136,
      });
    });

    it('omits zero cache fields and returns undefined for empty usage', () => {
      expect(toKimiCodeUsageData({ inputOther: 5, output: 2 })).toEqual({
        inputCacheMissTokens: 5,
        inputCachedTokens: undefined,
        inputWriteCacheTokens: undefined,
        totalInputTokens: 5,
        totalOutputTokens: 2,
        totalTokens: 7,
      });
      expect(toKimiCodeUsageData({})).toBeUndefined();
      expect(toKimiCodeUsageData(undefined)).toBeUndefined();
    });
  });

  describe('aggregateKimiCodeUsage', () => {
    it('sums multiple per-request records into a grand total', () => {
      expect(
        aggregateKimiCodeUsage([
          { usage: { inputCacheCreation: 0, inputCacheRead: 22_784, inputOther: 225, output: 27 } },
          {
            usage: { inputCacheCreation: 512, inputCacheRead: 23_000, inputOther: 100, output: 53 },
          },
        ]),
      ).toEqual({
        model: undefined,
        usage: {
          inputCacheMissTokens: 325,
          inputCachedTokens: 45_784,
          inputWriteCacheTokens: 512,
          totalInputTokens: 46_621,
          totalOutputTokens: 80,
          totalTokens: 46_701,
        },
      });
    });

    it('takes the model from the last usage-bearing record, without the provider prefix', () => {
      expect(
        aggregateKimiCodeUsage([
          { model: 'kimi-code/k2', usage: { inputOther: 10, output: 5 } },
          { model: 'kimi-code/k3', usage: { inputOther: 20, output: 6 } },
        ]),
      ).toMatchObject({ model: 'kimi-k3' });
    });

    it('passes a model without the kimi-code/ prefix through unchanged', () => {
      expect(
        aggregateKimiCodeUsage([{ model: 'k3', usage: { inputOther: 10, output: 5 } }]),
      ).toMatchObject({ model: 'k3' });
    });

    it('returns undefined when no record carries tokens', () => {
      expect(aggregateKimiCodeUsage([])).toBeUndefined();
      expect(aggregateKimiCodeUsage([{ usage: { inputOther: 0, output: 0 } }])).toBeUndefined();
    });
  });

  describe('parseKimiCodeWireUsage', () => {
    it('extracts usage objects and skips non-usage or malformed lines', () => {
      const records = parseKimiCodeWireUsage(
        [
          JSON.stringify({ role: 'meta', type: 'system.version', version: '2.0.2' }),
          usageLine({ inputCacheRead: 100, inputOther: 10, output: 5 }),
          'not json {',
          JSON.stringify({ role: 'assistant', content: 'no usage here' }),
          usageLine({ inputOther: 3, output: 1 }),
          '',
        ].join('\n'),
      );
      expect(records).toEqual([
        { model: undefined, usage: { inputCacheRead: 100, inputOther: 10, output: 5 } },
        { model: undefined, usage: { inputOther: 3, output: 1 } },
      ]);
    });

    it('captures the model from usage.record lines and ignores other typed lines', () => {
      const records = parseKimiCodeWireUsage(
        [
          usageRecordLine('kimi-code/k3', { inputCacheRead: 100, inputOther: 10, output: 5 }),
          JSON.stringify({
            content: 'Working.',
            role: 'assistant',
            type: 'assistant.message',
            usage: { inputOther: 999, output: 999 },
          }),
        ].join('\n'),
      );
      expect(records).toEqual([
        { model: 'kimi-code/k3', usage: { inputCacheRead: 100, inputOther: 10, output: 5 } },
      ]);
    });
  });
});
