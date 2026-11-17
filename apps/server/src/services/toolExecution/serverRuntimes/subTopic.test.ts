// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subTopicRuntime } from './subTopic';

const service = vi.hoisted(() => ({
  get: vi.fn(),
  isOpenedBy: vi.fn(),
  list: vi.fn(),
  retire: vi.fn(),
  send: vi.fn(),
  open: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@/server/routers/lambda/subTopic', () => ({
  createSubTopicService: () => service,
  readLatestSubTopicTranscript: vi.fn(),
}));
vi.mock('@/server/services/subTopic/labGate', () => ({
  readSubTopicsEnabled: vi.fn(async () => true),
}));

const runtime = () =>
  subTopicRuntime.factory({
    operationId: 'op_parent',
    serverDB: {} as any,
    topicId: 'tpc_parent',
    userId: 'user-1',
  } as any);

describe('lobe-topic server runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.stop.mockResolvedValue({ stopped: 1, topicId: 'tpc_child' });
    service.send.mockResolvedValue({ delivery: 'started' });
  });

  it('acts on a sub-topic of the conversation it runs in', async () => {
    service.isOpenedBy.mockResolvedValue(true);

    const result = await runtime().stopTopic({ topicId: 'tpc_child' });

    expect(service.isOpenedBy).toHaveBeenCalledWith('tpc_child', 'tpc_parent');
    expect(service.stop).toHaveBeenCalledWith('tpc_child');
    expect(result.success).toBe(true);
  });

  it('refuses any other topic the account can see', async () => {
    service.isOpenedBy.mockResolvedValue(false);

    const result = await runtime().sendToTopic({ message: 'hi', topicId: 'tpc_someone_else' });

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/not a sub-topic of this conversation/);
    expect(service.send).not.toHaveBeenCalled();
  });
});
