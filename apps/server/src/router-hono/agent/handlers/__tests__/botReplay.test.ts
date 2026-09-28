import { beforeEach, describe, expect, it, vi } from 'vitest';

import { botReplay } from '../botReplay';

const mockReplay = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/bot/deferredReplay', () => ({ runDeferredReplay: mockReplay }));

const target = { applicationId: 'app', platform: 'wechat', platformThreadId: 'wechat:single:user' };
const context = (body: unknown) =>
  ({
    json: (value: unknown, status = 200) => Response.json(value, { status }),
    req: { json: async () => body },
  }) as any;

beforeEach(() => {
  vi.resetAllMocks();
});
describe('bot replay endpoint', () => {
  it('returns a retryable status after a delivery error, then succeeds on retry', async () => {
    mockReplay.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce(undefined);
    expect((await botReplay(context({ payload: target }))).status).toBe(500);
    expect((await botReplay(context({ payload: target }))).status).toBe(200);
    expect(mockReplay).toHaveBeenCalledWith(target);
  });
  it('rejects malformed payloads before dispatch', async () => {
    expect((await botReplay(context({ payload: {} }))).status).toBe(400);
    expect(mockReplay).not.toHaveBeenCalled();
  });
});
