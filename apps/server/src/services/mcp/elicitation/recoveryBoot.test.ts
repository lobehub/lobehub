// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerDB, startMcpRecoveryWorker } = vi.hoisted(() => ({
  getServerDB: vi.fn(async () => 'db'),
  startMcpRecoveryWorker: vi.fn(),
}));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB }));
vi.mock('./recoveryWorker', () => ({ startMcpRecoveryWorker }));

const createRuntime = vi.fn();
const load = async () => {
  vi.resetModules();
  const { ensureMcpRecoveryWorker } = await import('./recoveryBoot');
  return () => ensureMcpRecoveryWorker(createRuntime);
};

describe('starting MCP recovery with the Agent runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DATABASE_URL', 'postgres://local');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('AGENT_RUNTIME_MODE', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('starts the worker once per process on a self-hosted server', async () => {
    const ensure = await load();
    ensure();
    ensure();
    await vi.waitFor(() =>
      expect(startMcpRecoveryWorker).toHaveBeenCalledWith('db', createRuntime),
    );
    expect(startMcpRecoveryWorker).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['on Vercel', { VERCEL_ENV: 'production' }],
    ['in queue mode', { AGENT_RUNTIME_MODE: 'queue' }],
    ['without a database', { DATABASE_URL: '' }],
    ['outside the Node runtime', { NEXT_RUNTIME: '' }],
  ])('leaves recovery to the queue %s', async (_, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const ensure = await load();
    ensure();
    await Promise.resolve();
    expect(getServerDB).not.toHaveBeenCalled();
    expect(startMcpRecoveryWorker).not.toHaveBeenCalled();
  });

  it('tries again on the next run when starting fails', async () => {
    getServerDB.mockRejectedValueOnce(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ensure = await load();
    ensure();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    ensure();
    await vi.waitFor(() => expect(startMcpRecoveryWorker).toHaveBeenCalledTimes(1));
  });
});
