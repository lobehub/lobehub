import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  aggregateKimiCodeUsage,
  getKimiCodeHome,
  parseKimiCodeWireUsage,
  readKimiCodeSessionUsage,
  toKimiCodeUsageData,
} from './kimiCodeUsage';

const tempDirs: string[] = [];

const makeTempKimiHome = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lobe-kimi-usage-'));
  tempDirs.push(dir);
  return dir;
};

const writeWireLog = async (
  kimiHome: string,
  wdKey: string,
  sessionId: string,
  lines: string[],
) => {
  const dir = path.join(kimiHome, 'sessions', wdKey, sessionId, 'agents', 'main');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'wire.jsonl'), lines.join('\n'));
};

const usageLine = (usage: Record<string, number>) =>
  JSON.stringify({ content: 'Working.', role: 'assistant', usage });

const usageRecordLine = (model: string, usage: Record<string, number>) =>
  JSON.stringify({ agentId: 'main', model, time: 1_700_000_000_000, type: 'usage.record', usage });

describe('kimiCodeUsage', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  describe('getKimiCodeHome', () => {
    it('prefers KIMI_CODE_HOME over the default home dir', () => {
      expect(getKimiCodeHome({ KIMI_CODE_HOME: '/managed/kimi' }, '/home/u')).toBe('/managed/kimi');
      expect(getKimiCodeHome({}, '/home/u')).toBe(path.join('/home/u', '.kimi-code'));
      expect(getKimiCodeHome({ KIMI_CODE_HOME: '  ' }, '/home/u')).toBe(
        path.join('/home/u', '.kimi-code'),
      );
    });
  });

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

    it('takes the model from the last usage-bearing record', () => {
      expect(
        aggregateKimiCodeUsage([
          { model: 'kimi-code/k2', usage: { inputOther: 10, output: 5 } },
          { model: 'kimi-code/k3', usage: { inputOther: 20, output: 6 } },
        ]),
      ).toMatchObject({ model: 'kimi-code/k3' });
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

  describe('readKimiCodeSessionUsage', () => {
    it('reads and aggregates usage from the session wire log across wd buckets', async () => {
      const kimiHome = await makeTempKimiHome();
      await writeWireLog(kimiHome, 'wd_lobehub_a3de130d1c24', 'session-1', [
        JSON.stringify({ role: 'meta', type: 'system.version', version: '2.0.2' }),
        usageRecordLine('kimi-code/k3', {
          inputCacheCreation: 0,
          inputCacheRead: 22_784,
          inputOther: 225,
          output: 27,
        }),
        usageRecordLine('kimi-code/k3', {
          inputCacheCreation: 10,
          inputCacheRead: 23_000,
          inputOther: 100,
          output: 53,
        }),
      ]);

      await expect(
        readKimiCodeSessionUsage('session-1', { env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toEqual({
        model: 'kimi-code/k3',
        usage: {
          inputCacheMissTokens: 325,
          inputCachedTokens: 45_784,
          inputWriteCacheTokens: 10,
          totalInputTokens: 46_119,
          totalOutputTokens: 80,
          totalTokens: 46_199,
        },
      });
    });

    it('omits the model when usage records do not carry one', async () => {
      const kimiHome = await makeTempKimiHome();
      await writeWireLog(kimiHome, 'wd_legacy', 'session-5', [
        usageLine({ inputOther: 7, output: 3 }),
      ]);

      await expect(
        readKimiCodeSessionUsage('session-5', { env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toEqual({
        model: undefined,
        usage: {
          inputCacheMissTokens: 7,
          inputCachedTokens: undefined,
          inputWriteCacheTokens: undefined,
          totalInputTokens: 7,
          totalOutputTokens: 3,
          totalTokens: 10,
        },
      });
    });

    it('resolves undefined for a missing session id, log, or usage records', async () => {
      const kimiHome = await makeTempKimiHome();
      await expect(
        readKimiCodeSessionUsage(undefined, { env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toBeUndefined();
      await expect(
        readKimiCodeSessionUsage('missing', {
          env: { KIMI_CODE_HOME: kimiHome },
          maxAttempts: 1,
        }),
      ).resolves.toBeUndefined();

      await writeWireLog(kimiHome, 'wd_x', 'session-2', [
        JSON.stringify({ role: 'meta', type: 'system.version' }),
      ]);
      await expect(
        readKimiCodeSessionUsage('session-2', {
          env: { KIMI_CODE_HOME: kimiHome },
          maxAttempts: 1,
        }),
      ).resolves.toBeUndefined();
    });

    it('picks the newest wire log when several buckets hold the same session id', async () => {
      const kimiHome = await makeTempKimiHome();
      await writeWireLog(kimiHome, 'wd_old', 'session-3', [
        usageLine({ inputOther: 1, output: 1 }),
      ]);
      // Ensure a strictly newer mtime for the second log.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeWireLog(kimiHome, 'wd_new', 'session-3', [
        usageLine({ inputOther: 50, output: 5 }),
      ]);

      await expect(
        readKimiCodeSessionUsage('session-3', { env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toMatchObject({ usage: { totalInputTokens: 50, totalOutputTokens: 5 } });
    });

    it('retries while the wire log is not flushed yet', async () => {
      const kimiHome = await makeTempKimiHome();
      const pending = readKimiCodeSessionUsage('session-4', {
        env: { KIMI_CODE_HOME: kimiHome },
        maxAttempts: 5,
        retryDelayMs: 30,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await writeWireLog(kimiHome, 'wd_late', 'session-4', [
        usageLine({ inputOther: 7, output: 3 }),
      ]);

      await expect(pending).resolves.toMatchObject({ usage: { totalTokens: 10 } });
    });
  });
});
