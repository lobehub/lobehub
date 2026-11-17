import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subTopicService } from '@/services/subTopic';

import { TopicToolApiName } from '../../types';
import { topicToolExecutor } from './index';

const refreshSubTopics = vi.fn();
const refreshTopic = vi.fn();

vi.mock('@/services/subTopic', () => ({
  subTopicService: {
    archive: vi.fn(),
    get: vi.fn(),
    isOpenedBy: vi.fn(),
    list: vi.fn(),
    open: vi.fn(),
    read: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ refreshSubTopics, refreshTopic }) },
}));

const ctx = { operationId: 'op_parent', topicId: 'tpc_parent' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(subTopicService.isOpenedBy).mockResolvedValue(true);
});

describe('topicToolExecutor', () => {
  it('refreshes the sub-topic hierarchy after opening one in the client runtime', async () => {
    vi.mocked(subTopicService.open).mockResolvedValue({
      agentId: 'agt_lobe',
      operationId: 'op_child',
      topicId: 'tpc_child',
    } as any);

    const result = await topicToolExecutor.invoke(
      TopicToolApiName.openTopic,
      { prompt: 'Fix the flaky test' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(refreshSubTopics).toHaveBeenCalledTimes(1);
    expect(refreshTopic).not.toHaveBeenCalled();
  });

  it('also refreshes the topic list after archiving, since its sub-topics move to the top level', async () => {
    vi.mocked(subTopicService.archive).mockResolvedValue(undefined as any);

    await topicToolExecutor.invoke(TopicToolApiName.archiveTopic, { topicId: 'tpc_child' }, ctx);

    expect(refreshSubTopics).toHaveBeenCalledTimes(1);
    expect(refreshTopic).toHaveBeenCalledTimes(1);
  });

  it('refreshes after stop and send, but not after a read', async () => {
    vi.mocked(subTopicService.stop).mockResolvedValue({ stopped: 1, topicId: 'tpc_child' } as any);
    vi.mocked(subTopicService.read).mockResolvedValue({ items: [], total: 0 } as any);

    await topicToolExecutor.invoke(TopicToolApiName.stopTopic, { topicId: 'tpc_child' }, ctx);
    expect(refreshSubTopics).toHaveBeenCalledTimes(1);

    await topicToolExecutor.invoke(TopicToolApiName.readTopic, { topicId: 'tpc_child' }, ctx);
    expect(refreshSubTopics).toHaveBeenCalledTimes(1);
  });

  it('does not refresh after a failed call', async () => {
    vi.mocked(subTopicService.open).mockRejectedValue(new Error('FORBIDDEN'));

    const result = await topicToolExecutor.invoke(TopicToolApiName.openTopic, { prompt: 'x' }, ctx);

    expect(result.success).toBe(false);
    expect(refreshSubTopics).not.toHaveBeenCalled();
  });

  it('refreshes from the gateway hook when the call ran server-side', async () => {
    await topicToolExecutor.onAfterCall({
      apiName: TopicToolApiName.sendToTopic,
      identifier: 'lobe-topic',
      params: { content: 'next', topicId: 'tpc_child' },
      result: { success: true } as any,
    });

    expect(refreshSubTopics).toHaveBeenCalledTimes(1);
  });

  it('refuses a topic that is not a sub-topic of the calling conversation', async () => {
    vi.mocked(subTopicService.isOpenedBy).mockResolvedValue(false);

    for (const api of [
      TopicToolApiName.archiveTopic,
      TopicToolApiName.getTopic,
      TopicToolApiName.readTopic,
      TopicToolApiName.stopTopic,
    ]) {
      const result = await topicToolExecutor.invoke(api, { topicId: 'tpc_other' }, ctx);
      expect(result.success).toBe(false);
      expect(result.content).toMatch(/not a sub-topic of this conversation/);
    }
    const sent = await topicToolExecutor.invoke(
      TopicToolApiName.sendToTopic,
      { message: 'hi', topicId: 'tpc_other' },
      ctx,
    );
    expect(sent.success).toBe(false);

    expect(subTopicService.isOpenedBy).toHaveBeenCalledWith('tpc_other', 'tpc_parent');
    for (const fn of ['archive', 'get', 'read', 'send', 'stop'] as const)
      expect(subTopicService[fn]).not.toHaveBeenCalled();
    expect(refreshSubTopics).not.toHaveBeenCalled();
  });
});
