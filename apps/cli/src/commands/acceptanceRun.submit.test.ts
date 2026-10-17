import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAcceptanceCommands } from './verifyAcceptance';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    verify: {
      getRunAcceptanceRound: { query: vi.fn() },
      submitCheckEvidence: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));
vi.mock('../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

const submitArgs = [
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
];

describe('lh acceptance run result submit — report link', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockTrpcClient.verify.submitCheckEvidence.mutate.mockReset().mockResolvedValue({
      checkResult: { id: 'result_1', verifyRunId: 'run_1' },
      evidence: [{ id: 'evidence_1' }],
    });
    mockTrpcClient.verify.getRunAcceptanceRound.query
      .mockReset()
      .mockResolvedValue({ acceptanceId: 'acceptance-1', roundIndex: 2 });
  });
  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerAcceptanceCommands(program);
    await program.parseAsync(['node', 'lh', 'acceptance', ...args]);
  };
  const printed = () => consoleSpy.mock.calls.map((call) => String(call[0]));

  it("prints the run's acceptance round URL, never a retired /verify link", async () => {
    await run(submitArgs);

    expect(mockTrpcClient.verify.getRunAcceptanceRound.query).toHaveBeenCalledWith({
      verifyRunId: 'run_1',
    });
    expect(printed()).toContain('report: https://app.lobehub.com/acceptance/acceptance-1?r=2');
    expect(printed().some((line) => line.includes('/verify/'))).toBe(false);
  });

  it('includes the acceptance round URL in JSON output', async () => {
    await run([...submitArgs, '--json']);

    const output = JSON.parse(printed().join(''));
    expect(output.url).toBe('https://app.lobehub.com/acceptance/acceptance-1?r=2');
  });

  it('warns and prints no report URL when the round lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockTrpcClient.verify.getRunAcceptanceRound.query.mockRejectedValue(new Error('offline'));

    await run(submitArgs);

    expect(printed().some((line) => line.includes('report:'))).toBe(false);
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('offline'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('prints no report URL for a run outside any acceptance', async () => {
    mockTrpcClient.verify.getRunAcceptanceRound.query.mockResolvedValue(null);

    await run(submitArgs);

    expect(printed().some((line) => line.includes('report:'))).toBe(false);
  });
});
