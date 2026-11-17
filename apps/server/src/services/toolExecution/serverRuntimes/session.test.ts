// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionRuntime } from './session';

const service = vi.hoisted(() => ({
  get: vi.fn(),
  isOpenedBy: vi.fn(),
  list: vi.fn(),
  retire: vi.fn(),
  send: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@/server/routers/lambda/subSession', () => ({
  createSubSessionService: () => service,
  readLatestSessionTranscript: vi.fn(),
}));
vi.mock('@/server/services/subSession/labGate', () => ({
  readSubSessionsEnabled: vi.fn(async () => true),
}));

const runtime = () =>
  sessionRuntime.factory({
    operationId: 'op_parent',
    serverDB: {} as any,
    topicId: 'tpc_parent',
    userId: 'user-1',
  } as any);

describe('lobe-session server runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.stop.mockResolvedValue({ stopped: 1, topicId: 'tpc_child' });
    service.send.mockResolvedValue({ delivery: 'started' });
  });

  it('acts on a sub-session of the conversation it runs in', async () => {
    service.isOpenedBy.mockResolvedValue(true);

    const result = await runtime().stopSession({ topicId: 'tpc_child' });

    expect(service.isOpenedBy).toHaveBeenCalledWith('tpc_child', 'tpc_parent');
    expect(service.stop).toHaveBeenCalledWith('tpc_child');
    expect(result.success).toBe(true);
  });

  it('refuses any other topic the account can see', async () => {
    service.isOpenedBy.mockResolvedValue(false);

    const result = await runtime().sendToSession({ message: 'hi', topicId: 'tpc_someone_else' });

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/not a sub-session of this conversation/);
    expect(service.send).not.toHaveBeenCalled();
  });
});
