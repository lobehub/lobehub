import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat/store';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

const AGENT_ID = 'agent-1';
const TOPIC_ID = 'topic-1';
const RUN_TOPIC_ID = 'topic-run';
const BUCKET = topicMapKey({ agentId: AGENT_ID });

const seedBucket = (status: 'unread' | 'active', id = TOPIC_ID) =>
  useChatStore.setState({
    topicDataMap: {
      [BUCKET]: { hasMore: false, items: [{ id, status, title: 't' } as any] } as any,
    },
  });

const bucketStatus = (id = TOPIC_ID) =>
  useChatStore.getState().topicDataMap[BUCKET]?.items?.find((t) => t.id === id)?.status;

describe('markTopicRead', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
    useChatStore.setState({ activeAgentId: AGENT_ID });
    vi.spyOn(topicService, 'markTopicRead').mockResolvedValue({
      id: TOPIC_ID,
      status: 'active',
    } as any);
    vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears an unread topic loaded in the topic buckets and mirrors it locally', async () => {
    seedBucket('unread');

    await useChatStore.getState().markTopicRead({ agentId: AGENT_ID, topicId: TOPIC_ID });

    expect(topicService.markTopicRead).toHaveBeenCalledWith(TOPIC_ID);
    expect(bucketStatus()).toBe('active');
  });

  it('leaves a topic it cannot see alone', async () => {
    await useChatStore.getState().markTopicRead({ agentId: AGENT_ID, topicId: TOPIC_ID });

    expect(topicService.markTopicRead).not.toHaveBeenCalled();
  });

  /** @example A project conversation lives in the project replica, not in `topicDataMap`. */
  it('clears a topic outside the topic buckets when the caller knows it is unread', async () => {
    await useChatStore
      .getState()
      .markTopicRead({ agentId: AGENT_ID, status: 'unread', topicId: TOPIC_ID });

    expect(topicService.markTopicRead).toHaveBeenCalledWith(TOPIC_ID);
  });

  it('skips the write when the caller reports a status other than unread', async () => {
    await useChatStore
      .getState()
      .markTopicRead({ agentId: AGENT_ID, status: 'running', topicId: TOPIC_ID });

    expect(topicService.markTopicRead).not.toHaveBeenCalled();
  });

  /**
   * @example A persisted project row still says unread, but a run started since
   * on another device: the server keeps `running`, so nothing writes `active`.
   */
  it('never writes active itself and mirrors nothing when the server says the topic moved on', async () => {
    vi.mocked(topicService.markTopicRead).mockResolvedValue(null);
    seedBucket('unread');

    await useChatStore.getState().markTopicRead({ agentId: AGENT_ID, topicId: TOPIC_ID });

    expect(topicService.updateTopic).not.toHaveBeenCalled();
    expect(bucketStatus()).toBe('unread');
  });

  /**
   * @example The user sends a message while the clear is in flight: the clear's
   * `active` answer is already stale and must not replace the run's status.
   */
  it('keeps a run that started while the clear was in flight', async () => {
    // Pins outlive `setState` resets, so this topic is kept apart from the others.
    let answer!: (value: any) => void;
    vi.mocked(topicService.markTopicRead).mockReturnValue(
      new Promise((resolve) => (answer = resolve)) as any,
    );
    seedBucket('unread', RUN_TOPIC_ID);

    const clearing = useChatStore
      .getState()
      .markTopicRead({ agentId: AGENT_ID, topicId: RUN_TOPIC_ID });
    useChatStore
      .getState()
      .internal_pinTopicStatus({ agentId: AGENT_ID, status: 'running', topicId: RUN_TOPIC_ID });
    answer({ id: RUN_TOPIC_ID, status: 'active' });
    await clearing;

    expect(bucketStatus(RUN_TOPIC_ID)).toBe('running');
  });

  describe('when the clear fails', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      useChatStore.setState({ activeTopicId: TOPIC_ID });
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** @example The open conversation must not stay unread after a dropped request. */
    it('retries a transient failure while the topic stays open', async () => {
      vi.mocked(topicService.markTopicRead)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ id: TOPIC_ID, status: 'active' } as any);
      seedBucket('unread');

      const clearing = useChatStore
        .getState()
        .markTopicRead({ agentId: AGENT_ID, topicId: TOPIC_ID });
      await vi.runAllTimersAsync();
      await clearing;

      expect(topicService.markTopicRead).toHaveBeenCalledTimes(2);
      expect(bucketStatus()).toBe('active');
    });

    it('does not retry a client error', async () => {
      vi.mocked(topicService.markTopicRead).mockRejectedValue({ data: { httpStatus: 403 } });
      seedBucket('unread');

      const clearing = useChatStore
        .getState()
        .markTopicRead({ agentId: AGENT_ID, topicId: TOPIC_ID });
      await vi.runAllTimersAsync();
      await clearing;

      expect(topicService.markTopicRead).toHaveBeenCalledTimes(1);
      expect(bucketStatus()).toBe('unread');
    });

    it('stops retrying once the user leaves the topic', async () => {
      vi.mocked(topicService.markTopicRead).mockRejectedValue(new TypeError('Failed to fetch'));
      seedBucket('unread');

      const clearing = useChatStore
        .getState()
        .markTopicRead({ agentId: AGENT_ID, topicId: TOPIC_ID });
      useChatStore.setState({ activeTopicId: 'another-topic' });
      await vi.runAllTimersAsync();
      await clearing;

      expect(topicService.markTopicRead).toHaveBeenCalledTimes(1);
    });
  });
});
