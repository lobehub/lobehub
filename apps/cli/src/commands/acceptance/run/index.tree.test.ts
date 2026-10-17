import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAcceptanceCommands } from '..';

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

describe('lh acceptance — canonical run tree', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    (mockTrpcClient.verify as Record<string, any>).submitCheckEvidence = {
      mutate: vi.fn().mockResolvedValue({
        checkResult: { id: 'result_1', verifyRunId: 'run_1' },
        evidence: [{ id: 'evidence_1' }],
      }),
    };
  });
  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    // First-class `lh acceptance …` — the run subtree only hangs off this,
    // never off the deprecated `lh verify acceptance` alias.
    registerAcceptanceCommands(program);
    await program.parseAsync(['node', 'lh', 'acceptance', ...args]);
  };

  it('routes `acceptance run delete` to the same deleteRun mutation', async () => {
    mockTrpcClient.verify.deleteRun.mutate.mockReset().mockResolvedValue({ id: 'run_1' });
    await run(['run', 'delete', 'run_1', '--yes']);
    expect(mockTrpcClient.verify.deleteRun.mutate).toHaveBeenCalledWith({ verifyRunId: 'run_1' });
  });

  it('prints the acceptance link, never a /verify link, after submitting evidence', async () => {
    mockTrpcClient.verify.getRun = {
      query: vi.fn().mockResolvedValue({ acceptanceId: 'acc_1', id: 'run_1', roundIndex: 2 }),
    };
    await run([
      'run',
      'result',
      'submit',
      '--operation',
      'op_1',
      '--item',
      'check_1',
      '--type',
      'text',
      '--content',
      'passed',
    ]);

    const lines = consoleSpy.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('acceptance: https://app.lobehub.com/acceptance/acc_1');
    expect(lines.some((line) => line.includes('/verify/'))).toBe(false);
  });

  it('reports no link for a round outside any acceptance', async () => {
    mockTrpcClient.verify.getRun = {
      query: vi.fn().mockResolvedValue({ acceptanceId: null, id: 'run_1', roundIndex: null }),
    };
    await run([
      'run',
      'result',
      'submit',
      '--operation',
      'op_1',
      '--item',
      'check_1',
      '--type',
      'text',
      '--content',
      'passed',
      '--json',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls.map((call) => String(call[0])).join(''));
    expect(output).toMatchObject({ acceptanceUrl: null, roundIndex: null });
    expect(output).not.toHaveProperty('url');
  });

  it('includes the acceptance URL in JSON output', async () => {
    mockTrpcClient.verify.getRun = {
      query: vi.fn().mockResolvedValue({ acceptanceId: 'acc_1', id: 'run_1', roundIndex: 2 }),
    };
    await run([
      'run',
      'result',
      'submit',
      '--operation',
      'op_1',
      '--item',
      'check_1',
      '--type',
      'text',
      '--content',
      'passed',
      '--json',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls.map((call) => String(call[0])).join(''));
    expect(output).toMatchObject({
      acceptanceUrl: 'https://app.lobehub.com/acceptance/acc_1',
      roundIndex: 2,
    });
    expect(output).not.toHaveProperty('url');
  });

  it('does NOT attach the run subtree to the deprecated `verify acceptance` alias', async () => {
    const program = new Command();
    program.exitOverride();
    registerAcceptanceCommands(program, { deprecated: true });
    const acceptance = program.commands.find((c) => c.name() === 'acceptance');
    const hasRun = acceptance?.commands.some((c) => c.name() === 'run');
    expect(hasRun).toBe(false);
  });
});
