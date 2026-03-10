import { describe, expect, it } from 'vitest';

import { LayersEnum, MemorySourceType } from '@/types/userMemory';

import {
  type MemoryExtractionNormalizedPayload,
  type MemoryExtractionPayloadInput,
} from '../extract';
import { buildWorkflowPayloadInput, normalizeMemoryExtractionPayload } from '../extract';

describe('normalizeMemoryExtractionPayload', () => {
  it('normalizes sources, layers, ids, and dates with fallback baseUrl', () => {
    const fromDate = new Date('2024-01-01T00:00:00Z');
    const toDate = new Date('2024-02-01T00:00:00Z');

    const payload: MemoryExtractionPayloadInput = {
      forceAll: true,
      forceTopics: true,
      fromDate,
      identityCursor: 3,
      layers: [LayersEnum.Context, LayersEnum.Identity, LayersEnum.Context],
      mode: 'direct',
      sourceIds: ['source-1', 'source-1', ''],
      sources: ['chatTopics', 'benchmark_locomo', 'unknown'],
      toDate,
      topicIds: ['topic-1', 'topic-1', ''],
      userId: 'user-a',
      userIds: ['user-a', 'user-b', ''],
    };

    const normalized = normalizeMemoryExtractionPayload(payload, 'https://api.example.com');

    expect(normalized.baseUrl).toBe('https://api.example.com');
    expect(normalized.forceAll).toBe(true);
    expect(normalized.forceTopics).toBe(true);
    expect(normalized.from).toEqual(fromDate);
    expect(normalized.to).toEqual(toDate);
    expect(normalized.identityCursor).toBe(3);
    expect(normalized.layers).toEqual([LayersEnum.Context, LayersEnum.Identity]);
    expect(normalized.sources).toEqual([
      MemorySourceType.ChatTopic,
      MemorySourceType.BenchmarkLocomo,
    ]);
    expect(normalized.sourceIds).toEqual(['source-1']);
    expect(normalized.topicIds).toEqual(['topic-1']);
    expect(normalized.userId).toBe('user-a');
    expect(normalized.userIds).toEqual(['user-a', 'user-b']);
  });

  it('throws when baseUrl is missing in both payload and fallback', () => {
    const payload: MemoryExtractionPayloadInput = {
      forceAll: false,
      forceTopics: false,
      userIds: [],
    };

    expect(() => normalizeMemoryExtractionPayload(payload)).toThrow('Missing baseUrl');
  });
});

describe('buildWorkflowPayloadInput', () => {
  const baseNormalized: MemoryExtractionNormalizedPayload = {
    baseUrl: 'https://api.example.com',
    forceAll: false,
    forceTopics: false,
    from: undefined,
    identityCursor: 0,
    layers: [],
    mode: 'workflow',
    sourceIds: [],
    sources: [MemorySourceType.ChatTopic],
    to: undefined,
    topicCursor: undefined,
    topicIds: [],
    userCursor: undefined,
    userId: undefined,
    userIds: ['user-x', 'user-y'],
  };

  it('falls back to the first user id when userId is missing', () => {
    const payload = buildWorkflowPayloadInput(baseNormalized);

    expect(payload.userId).toBe('user-x');
    expect(payload.userIds).toEqual(['user-x', 'user-y']);
    expect(payload.baseUrl).toBe('https://api.example.com');
    expect(payload.mode).toBe('workflow');
  });

  it('preserves explicit userId when provided', () => {
    const normalized: MemoryExtractionNormalizedPayload = {
      ...baseNormalized,
      userId: 'user-z',
    };

    const payload = buildWorkflowPayloadInput(normalized);

    expect(payload.userId).toBe('user-z');
    expect(payload.userIds).toEqual(['user-x', 'user-y']);
  });
});
