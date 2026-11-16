import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTfsCommand } from './tfs';

const mocks = vi.hoisted(() => ({
  git: vi.fn(),
  operation: vi.fn(),
  isOperation: vi.fn(),
  output: vi.fn(),
}));
vi.mock('../api/client', () => ({
  getTrpcClient: async () => ({
    tfs: { git: { mutate: mocks.git }, gitOperation: { mutate: mocks.operation } },
  }),
}));
vi.mock('../api/operationTokenFallback', () => ({ isOperationToken: mocks.isOperation }));
vi.mock('../utils/format', () => ({ outputJson: mocks.output }));

const run = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerTfsCommand(program);
  await program.parseAsync(['node', 'lh', 'tfs', 'git', ...args]);
};

describe('lh tfs git', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('LOBEHUB_TOPIC_ID', 'own-topic');
    mocks.git.mockResolvedValue({ success: true });
    mocks.operation.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.exitCode = 0;
  });

  it('operates on the named cloud conversation with user authentication', async () => {
    await run('pull', '--topic', 'selected-topic', '--branch', 'develop');
    expect(mocks.git).toHaveBeenCalledWith({
      operation: 'pull',
      topicId: 'selected-topic',
      branch: 'develop',
      sourceIndex: 0,
    });
    expect(mocks.operation).not.toHaveBeenCalled();
  });

  it('uses the current operation endpoint without falling back to a device login', async () => {
    mocks.isOperation.mockReturnValue(true);
    await run('push', '--source', '1', '--branch', 'feature/tfs');
    expect(mocks.operation).toHaveBeenCalledWith({
      operation: 'push',
      branch: 'feature/tfs',
      sourceIndex: 1,
    });
    expect(mocks.git).not.toHaveBeenCalled();
    await expect(run('fetch', '--topic', 'other-topic')).rejects.toThrow('own conversation');
  });

  it('rejects arbitrary Git commands and invalid sources', async () => {
    await expect(run('config')).rejects.toThrow('must be');
    await expect(run('fetch', '--source', '-1')).rejects.toThrow('Invalid Git source');
    expect(mocks.git).not.toHaveBeenCalled();
  });

  it('reports remote failure as a nonzero CLI exit', async () => {
    mocks.git.mockResolvedValue({ success: false, stderr: 'permission denied' });
    await run('fetch');
    expect(process.exitCode).toBe(1);
    expect(mocks.output).toHaveBeenCalledWith({ success: false, stderr: 'permission denied' });
  });
});
