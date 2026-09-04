// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const server = {
    close: vi.fn((callback: () => void) => callback()),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
    listening: false,
  };

  return {
    createServer: vi.fn(() => server),
    server,
    startLocalTrashPurgeSchedule: vi.fn(),
  };
});

vi.mock('node:http', () => ({ createServer: mocks.createServer }));
vi.mock('./index', () => ({ default: { fetch: vi.fn() } }));
vi.mock('@/server/workflows/trash', () => ({
  startLocalTrashPurgeSchedule: mocks.startLocalTrashPurgeSchedule,
}));

describe('Hono standalone startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL', 'postgres://example.test/lobechat');
    vi.stubEnv('QSTASH_TOKEN', '');
    mocks.server.listening = false;
  });

  it('starts background trash retention before accepting requests', async () => {
    await import('./standalone');

    await vi.waitFor(() => expect(mocks.server.listen).toHaveBeenCalledOnce());
    expect(mocks.startLocalTrashPurgeSchedule).toHaveBeenCalledOnce();
    expect(mocks.startLocalTrashPurgeSchedule.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.server.listen.mock.invocationCallOrder[0],
    );
  });
});
