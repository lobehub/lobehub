// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const readStringStream = async (response: Response): Promise<string> => {
  const reader = response.body!.getReader();
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return body;
    body += value as unknown as string;
  }
};

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  loadRounds: vi.fn(),
  releaseWatcher: vi.fn(),
  renewWatcher: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('@/app/(backend)/middleware/auth', () => ({
  checkAuth:
    (handler: any) =>
    (req: Request): Promise<Response> =>
      handler(req, { serverDB: {}, userId: 'user-1' }),
}));
vi.mock('@/server/services/resourceEvents', () => ({
  subscribeResourceEvents: mocks.subscribe,
}));
vi.mock('@/server/services/verify', () => ({
  AcceptanceService: vi.fn(() => ({
    acceptanceModel: { findById: mocks.findById },
    loadRounds: mocks.loadRounds,
  })),
  releaseAcceptanceWatcher: mocks.releaseWatcher,
  renewAcceptanceWatcher: mocks.renewWatcher,
}));
vi.mock('../../_utils/workspace', () => ({
  resolveValidWorkspaceIdFromRequest: vi.fn().mockResolvedValue(undefined),
  WORKSPACE_ID_HEADER: 'X-Workspace-Id',
}));

describe('acceptance events route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue({ id: 'acceptance-1', status: 'delivered' });
    mocks.renewWatcher.mockResolvedValue(undefined);
    mocks.releaseWatcher.mockResolvedValue(undefined);
    mocks.subscribe.mockImplementation(
      (_ref: unknown, _listener: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
    );
  });

  it('replays a durable feedback submission and closes the stream', async () => {
    mocks.loadRounds.mockResolvedValue({
      runs: [
        {
          decisionDetail: { feedbackSubmittedAt: '2026-07-28T08:00:00.000Z' },
          roundIndex: 1,
        },
      ],
    });

    const response = await GET(
      new Request('https://app.lobehub.com/webapi/acceptance/events?id=acceptance-1&round=1'),
      {} as any,
    );
    const body = await readStringStream(response);

    expect(body).toContain('event: acceptance.feedbackSubmitted');
    expect(mocks.renewWatcher).toHaveBeenCalledWith('acceptance-1', 1, expect.any(String));
    expect(mocks.releaseWatcher).toHaveBeenCalledWith('acceptance-1', 1, expect.any(String));
  });

  it('terminates an outstanding round when the aggregate is accepted', async () => {
    mocks.findById.mockResolvedValue({ id: 'acceptance-1', status: 'accepted' });
    mocks.loadRounds.mockResolvedValue({ runs: [{ decisionDetail: {}, roundIndex: 1 }] });

    const response = await GET(
      new Request('https://app.lobehub.com/webapi/acceptance/events?id=acceptance-1&round=1'),
      {} as any,
    );

    await expect(readStringStream(response)).resolves.toContain('event: acceptance.accepted');
  });
});
