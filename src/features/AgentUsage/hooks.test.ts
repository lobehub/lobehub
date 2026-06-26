import { describe, expect, it } from 'vitest';

import { type UsageLog, type UsageRecordItem } from '@/types/usage/usageRecord';

import { groupByModel, summarizeUsage } from './hooks';

const record = (over: Partial<UsageRecordItem>): UsageRecordItem => ({
  createdAt: new Date('2026-06-01'),
  id: 'm1',
  model: 'gpt-4o',
  provider: 'openai',
  spend: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  type: 'chat',
  updatedAt: new Date('2026-06-01'),
  userId: 'u1',
  ...over,
});

const log = (day: string, records: UsageRecordItem[]): UsageLog => ({
  date: new Date(day).getTime(),
  day,
  records,
  totalRequests: records.length,
  totalSpend: records.reduce((acc, r) => acc + r.spend, 0),
  totalTokens: records.reduce((acc, r) => acc + (r.totalTokens || 0), 0),
});

describe('summarizeUsage', () => {
  it('returns zeros for empty / undefined input', () => {
    expect(summarizeUsage()).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      totalSpend: 0,
      totalTokens: 0,
    });
    expect(summarizeUsage([])).toEqual({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      totalSpend: 0,
      totalTokens: 0,
    });
  });

  it('rolls up spend, tokens, requests and input/output across days', () => {
    const data: UsageLog[] = [
      log('2026-06-01', [
        record({ spend: 0.5, totalInputTokens: 100, totalOutputTokens: 40, totalTokens: 140 }),
        record({
          id: 'm2',
          spend: 0.25,
          totalInputTokens: 50,
          totalOutputTokens: 10,
          totalTokens: 60,
        }),
      ]),
      log('2026-06-02', [
        record({
          id: 'm3',
          spend: 1,
          totalInputTokens: 200,
          totalOutputTokens: 100,
          totalTokens: 300,
        }),
      ]),
    ];

    expect(summarizeUsage(data)).toEqual({
      totalInputTokens: 350,
      totalOutputTokens: 150,
      totalRequests: 3,
      totalSpend: 1.75,
      totalTokens: 500,
    });
  });
});

describe('groupByModel', () => {
  it('aggregates per (provider, model) and sorts by total tokens desc', () => {
    const data: UsageLog[] = [
      log('2026-06-01', [
        record({
          model: 'gpt-4o',
          provider: 'openai',
          spend: 0.2,
          totalTokens: 100,
          totalInputTokens: 80,
          totalOutputTokens: 20,
        }),
        record({
          id: 'm2',
          model: 'claude-opus-4-8',
          provider: 'anthropic',
          spend: 1,
          totalTokens: 400,
          totalInputTokens: 300,
          totalOutputTokens: 100,
        }),
      ]),
      log('2026-06-02', [
        record({
          id: 'm3',
          model: 'gpt-4o',
          provider: 'openai',
          spend: 0.3,
          totalTokens: 150,
          totalInputTokens: 100,
          totalOutputTokens: 50,
        }),
      ]),
    ];

    const rows = groupByModel(data);

    expect(rows).toHaveLength(2);
    // anthropic has more total tokens → sorted first
    expect(rows[0]).toMatchObject({
      key: 'anthropic/claude-opus-4-8',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      requests: 1,
      spend: 1,
      totalTokens: 400,
    });
    expect(rows[1]).toMatchObject({
      inputTokens: 180,
      key: 'openai/gpt-4o',
      outputTokens: 70,
      requests: 2,
      spend: 0.5,
      totalTokens: 250,
    });
  });

  it('falls back to "unknown" for missing model / provider', () => {
    const data: UsageLog[] = [
      log('2026-06-01', [record({ model: '', provider: '', totalTokens: 10 })]),
    ];
    expect(groupByModel(data)[0]).toMatchObject({ key: 'unknown/unknown', model: 'unknown' });
  });

  it('returns [] for empty input', () => {
    expect(groupByModel()).toEqual([]);
    expect(groupByModel([])).toEqual([]);
  });
});
