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

const runtime = (extra: Record<string, unknown> = {}) =>
  subTopicRuntime.factory({
    operationId: 'op_parent',
    serverDB: {} as any,
    topicId: 'tpc_parent',
    userId: 'user-1',
    ...extra,
  } as any);

const externalSender = {
  botContext: {
    applicationId: 'app-1',
    isOwner: false,
    platform: 'discord',
    platformThreadId: 'thread-1',
    senderExternalUserId: 'stranger',
  },
};

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

  it('refuses to open a sub-topic for a bot sender who is denied devices', async () => {
    const result = await runtime(externalSender).openTopic({ prompt: 'run the deploy script' });

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/bot owner or a trusted sender/);
    expect(service.open).not.toHaveBeenCalled();
  });

  it('refuses to continue a sub-topic for such a sender too, but lets it stop one', async () => {
    service.isOpenedBy.mockResolvedValue(true);

    const sent = await runtime(externalSender).sendToTopic({ message: 'hi', topicId: 'tpc_child' });
    expect(sent.success).toBe(false);
    expect(service.send).not.toHaveBeenCalled();

    const stopped = await runtime(externalSender).stopTopic({ topicId: 'tpc_child' });
    expect(stopped.success).toBe(true);
  });

  it("opens one for the bot's owner", async () => {
    service.open.mockResolvedValue({ agentId: 'agt_1', operationId: 'op_1', topicId: 'tpc_new' });

    const result = await runtime({
      botContext: { ...externalSender.botContext, isOwner: true, senderExternalUserId: 'owner' },
    }).openTopic({ prompt: 'x' });

    expect(result.success).toBe(true);
    expect(service.open).toHaveBeenCalled();
  });
});
