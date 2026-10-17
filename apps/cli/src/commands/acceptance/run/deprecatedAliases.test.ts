import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerVerifyCommand } from '../deprecatedVerify';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    user: {
      getUserState: {
        query: vi.fn(async () => ({ settings: { general: { responseLanguage: 'en-US' } } })),
      },
    },
    verify: {
      createRubric: { mutate: vi.fn() },
      deleteRun: { mutate: vi.fn() },
      getRubric: { query: vi.fn() },
      updateRubric: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

describe('verify run delete command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.deleteRun.mutate.mockReset().mockResolvedValue({
      id: 'run-1',
      success: true,
    });
  });

  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('deletes the run without prompting when --yes is passed', async () => {
    await run(['run', 'delete', 'run-1', '--yes']);

    expect(mockTrpcClient.verify.deleteRun.mutate).toHaveBeenCalledWith({ verifyRunId: 'run-1' });
  });
});

describe('verify evidence upload command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetTrpcClient.mockReset();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code}`);
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('rejects evidence with both file and inline content', async () => {
    await expect(
      run([
        'evidence',
        'upload',
        '--check',
        'result-1',
        '--type',
        'text',
        '--file',
        'artifact.txt',
        '--content',
        'inline payload',
      ]),
    ).rejects.toThrow('process.exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockGetTrpcClient).not.toHaveBeenCalled();
  });
});
