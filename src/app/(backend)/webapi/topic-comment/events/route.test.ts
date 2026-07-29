// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  assertTopicCommentReadAccess: vi.fn(),
  signal: undefined as AbortSignal | undefined,
  subscribeResourceEvents: vi.fn(),
  writeConnection: vi.fn(),
  writeHeartbeat: vi.fn(),
  writeStreamEvent: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  createSSEHeaders: () => ({ 'Content-Type': 'text/event-stream' }),
  createSSEWriter: () => ({
    writeConnection: mocks.writeConnection,
    writeHeartbeat: mocks.writeHeartbeat,
    writeStreamEvent: mocks.writeStreamEvent,
  }),
}));

vi.mock('@/app/(backend)/middleware/auth', () => ({
  checkAuth:
    (handler: (req: Request, context: { serverDB: object; userId: string }) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { serverDB: {}, userId: 'user-1' }),
}));

vi.mock('@/server/routers/lambda/_helpers/topicCommentAccess', () => ({
  assertTopicCommentReadAccess: mocks.assertTopicCommentReadAccess,
}));

vi.mock('@/server/services/resourceEvents', () => ({
  subscribeResourceEvents: mocks.subscribeResourceEvents,
}));

vi.mock('../../_utils/workspace', () => ({
  resolveValidWorkspaceIdFromRequest: vi.fn().mockResolvedValue('workspace-1'),
}));

describe('topic comment event stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.signal = undefined;
    mocks.assertTopicCommentReadAccess.mockResolvedValue(undefined);
    mocks.subscribeResourceEvents.mockImplementation(
      (_ref: unknown, _onEvent: unknown, signal: AbortSignal) => {
        mocks.signal = signal;
        return new Promise(() => {});
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('terminates the subscription when heartbeat access revalidation fails', async () => {
    mocks.assertTopicCommentReadAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('access revoked'));

    const response = await GET(
      new Request('https://example.com/webapi/topic-comment/events?topicId=topic-1'),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    expect(mocks.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mocks.assertTopicCommentReadAccess).toHaveBeenCalledTimes(2);
    expect(mocks.signal?.aborted).toBe(true);
    expect(mocks.writeHeartbeat).not.toHaveBeenCalled();
  });
});
