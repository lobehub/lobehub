import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import {
  fetchTopicPreviews,
  getValidTopicPreview,
  hasRecentTopicPreviewAttempt,
  hasTopicPreview,
  invalidateTopicPreview,
  resetTopicPreviews,
  TOPIC_PREVIEW_MAX_ENTRIES,
  TOPIC_PREVIEW_TTL_MS,
} from './topicPreview';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { message: { getTopicPreviews: { query: vi.fn() } } },
}));

const query = vi.mocked(lambdaClient.message.getTopicPreviews.query);

const UPDATED_AT = '2026-10-27T00:00:00.000Z';

const okItem = (topicId: string, topicUpdatedAt = UPDATED_AT) => ({
  editedFiles: [],
  goals: [],
  kind: 'single' as const,
  message: { content: `answer of ${topicId}`, id: `msg_${topicId}`, role: 'assistant' },
  status: 'ok' as const,
  topicId,
  topicUpdatedAt,
  workRootOperationId: null,
  works: [],
});

const answerWith = (topicIds: string[]) =>
  query.mockResolvedValueOnce(topicIds.map((id) => okItem(id)) as any);

describe('topicPreview cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTopicPreviews();
    query.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a fetched preview while the topic is unchanged', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(query).toHaveBeenCalledWith({
      agentId: 'agt_1',
      groupId: undefined,
      topicIds: ['tpc_a'],
    });
    expect(getValidTopicPreview('tpc_a', { topicUpdatedAt: UPDATED_AT })?.message.id).toBe(
      'msg_tpc_a',
    );
    expect(hasTopicPreview('tpc_a')).toBe(true);
  });

  it('keeps skipped items out of the cache', async () => {
    query.mockResolvedValueOnce([{ reason: 'running', status: 'skipped', topicId: 'tpc_a' }]);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(hasTopicPreview('tpc_a')).toBe(false);
  });

  it('expires a preview after its time to live', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    vi.advanceTimersByTime(TOPIC_PREVIEW_TTL_MS + 1);

    expect(getValidTopicPreview('tpc_a', { topicUpdatedAt: UPDATED_AT })).toBeUndefined();
    expect(hasTopicPreview('tpc_a')).toBe(false);
  });

  it('drops a preview whose topic has been updated since', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(
      getValidTopicPreview('tpc_a', { topicUpdatedAt: '2026-10-27T00:05:00.000Z' }),
    ).toBeUndefined();
    expect(hasTopicPreview('tpc_a')).toBe(false);
  });

  it('drops a preview once the topic is running', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(getValidTopicPreview('tpc_a', { running: true, topicUpdatedAt: UPDATED_AT })).toBe(
      undefined,
    );
    expect(hasTopicPreview('tpc_a')).toBe(false);
  });

  it('accepts a topic list timestamp given as a Date', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(getValidTopicPreview('tpc_a', { topicUpdatedAt: new Date(UPDATED_AT) })).toBeDefined();
  });

  it('evicts the oldest preview past the size cap', async () => {
    const ids = Array.from({ length: TOPIC_PREVIEW_MAX_ENTRIES + 1 }, (_, i) => `tpc_${i}`);
    for (const id of ids) {
      answerWith([id]);
      await fetchTopicPreviews({ agentId: 'agt_1', topicIds: [id] });
    }

    expect(hasTopicPreview('tpc_0')).toBe(false);
    expect(hasTopicPreview('tpc_1')).toBe(true);
    expect(hasTopicPreview(ids.at(-1)!)).toBe(true);
  });

  it('removes an invalidated preview', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    invalidateTopicPreview('tpc_a');

    expect(hasTopicPreview('tpc_a')).toBe(false);
  });

  it('does not cache a preview fetched before a local change to its topic', async () => {
    let resolve!: (value: unknown) => void;
    query.mockReturnValueOnce(new Promise((r) => (resolve = r)) as any);
    const pending = fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    invalidateTopicPreview('tpc_a');
    resolve([okItem('tpc_a')]);
    await pending;

    expect(hasTopicPreview('tpc_a')).toBe(false);
  });

  it('swallows a failed request', async () => {
    query.mockRejectedValueOnce(new Error('network'));

    await expect(fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] })).resolves.toEqual(
      [],
    );
  });

  it('remembers a skipped topic for the time to live so hovering does not ask again', async () => {
    query.mockResolvedValueOnce([
      { reason: 'notFinalAnswer', status: 'skipped', topicId: 'tpc_a' },
    ] as any);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(hasRecentTopicPreviewAttempt('tpc_a')).toBe(true);
    vi.advanceTimersByTime(TOPIC_PREVIEW_TTL_MS + 1);
    expect(hasRecentTopicPreviewAttempt('tpc_a')).toBe(false);
  });

  it('remembers the topics of a failed request', async () => {
    query.mockRejectedValueOnce(new Error('network'));
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a', 'tpc_b'] });

    expect(hasRecentTopicPreviewAttempt('tpc_a')).toBe(true);
    expect(hasRecentTopicPreviewAttempt('tpc_b')).toBe(true);
  });

  it('counts a cached preview as an attempt and forgets both on invalidation', async () => {
    answerWith(['tpc_a']);
    await fetchTopicPreviews({ agentId: 'agt_1', topicIds: ['tpc_a'] });

    expect(hasRecentTopicPreviewAttempt('tpc_a')).toBe(true);
    invalidateTopicPreview('tpc_a');
    expect(hasRecentTopicPreviewAttempt('tpc_a')).toBe(false);
  });
});
