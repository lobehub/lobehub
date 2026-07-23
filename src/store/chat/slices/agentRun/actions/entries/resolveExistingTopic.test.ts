import { describe, expect, it, vi } from 'vitest';

import type { ChatTopic } from '@/types/topic';

import { resolveExistingTopicForRun } from './resolveExistingTopic';

const topic = (over?: Partial<ChatTopic>): ChatTopic =>
  ({
    createdAt: 0,
    favorite: false,
    id: 'tpc_x',
    metadata: { workingDirectory: '/repo/bound-dir' },
    title: 't',
    updatedAt: 0,
    ...over,
  }) as ChatTopic;

describe('resolveExistingTopicForRun', () => {
  it('returns the store row without fetching when present', async () => {
    const fetchTopicDetail = vi.fn();
    const storeTopic = topic();
    const out = await resolveExistingTopicForRun({
      fetchTopicDetail,
      isHetero: true,
      storeTopic,
      topicId: 'tpc_x',
    });
    expect(out).toBe(storeTopic);
    expect(fetchTopicDetail).not.toHaveBeenCalled();
  });

  it('falls back to the server row when the paginated store misses a hetero topic', async () => {
    // the exact production failure: deep-linked old topic beyond the loaded
    // page → store miss → cwd/resume metadata must come from the server row
    const serverTopic = topic({ id: 'tpc_deep' });
    const fetchTopicDetail = vi.fn().mockResolvedValue(serverTopic);
    const out = await resolveExistingTopicForRun({
      fetchTopicDetail,
      isHetero: true,
      storeTopic: undefined,
      topicId: 'tpc_deep',
    });
    expect(out).toBe(serverTopic);
    expect(fetchTopicDetail).toHaveBeenCalledWith('tpc_deep');
    expect(out?.metadata?.workingDirectory).toBe('/repo/bound-dir');
  });

  it('skips the round-trip for non-hetero runs', async () => {
    const fetchTopicDetail = vi.fn();
    const out = await resolveExistingTopicForRun({
      fetchTopicDetail,
      isHetero: false,
      storeTopic: undefined,
      topicId: 'tpc_x',
    });
    expect(out).toBeUndefined();
    expect(fetchTopicDetail).not.toHaveBeenCalled();
  });

  it('skips when there is no topicId (new-topic send)', async () => {
    const fetchTopicDetail = vi.fn();
    const out = await resolveExistingTopicForRun({
      fetchTopicDetail,
      isHetero: true,
      storeTopic: undefined,
      topicId: undefined,
    });
    expect(out).toBeUndefined();
    expect(fetchTopicDetail).not.toHaveBeenCalled();
  });

  it('degrades to undefined (old behavior) when the fetch fails', async () => {
    const fetchTopicDetail = vi.fn().mockRejectedValue(new Error('network down'));
    const out = await resolveExistingTopicForRun({
      fetchTopicDetail,
      isHetero: true,
      storeTopic: undefined,
      topicId: 'tpc_x',
    });
    expect(out).toBeUndefined();
  });

  it('maps a server null (topic deleted) to undefined', async () => {
    const fetchTopicDetail = vi.fn().mockResolvedValue(null);
    const out = await resolveExistingTopicForRun({
      fetchTopicDetail,
      isHetero: true,
      storeTopic: undefined,
      topicId: 'tpc_gone',
    });
    expect(out).toBeUndefined();
  });
});
