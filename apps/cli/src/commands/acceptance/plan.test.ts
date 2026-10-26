import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { attachPlanCommands } from './plan';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: { verify: { disputeCheck: { mutate: vi.fn() } } },
}));
const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({ getTrpcClient: vi.fn() }));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));

describe('acceptance plan dispute', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.disputeCheck.mutate.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = undefined;
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    attachPlanCommands(program);
    await program.parseAsync(['node', 'lh', 'plan', 'dispute', 'op-1', ...args]);
  };

  it("files the dispute and prints the panel's answer", async () => {
    mockTrpcClient.verify.disputeCheck.mutate.mockResolvedValue({
      message: 'Dispute upheld (2 of 3 panel models upheld it).',
      success: true,
    });

    await run([
      '--item',
      'c2',
      '--kind',
      'missed_evidence',
      '--reason',
      'Screenshot e1 shows it',
      '--evidence',
      'e1, e2',
    ]);

    expect(mockTrpcClient.verify.disputeCheck.mutate).toHaveBeenCalledWith({
      checkItemId: 'c2',
      evidenceIds: ['e1', 'e2'],
      kind: 'missed_evidence',
      operationId: 'op-1',
      reason: 'Screenshot e1 shows it',
    });
    expect(consoleSpy.mock.calls.flat().join('\n')).toContain('Dispute upheld');
    expect(process.exitCode).toBeUndefined();
  });

  it('exits non-zero when the dispute is refused', async () => {
    mockTrpcClient.verify.disputeCheck.mutate.mockResolvedValue({
      error: 'ALREADY_RULED',
      message: 'A panel already overruled a dispute of "Exports a PDF".',
      success: false,
    });

    await run(['--item', 'c2', '--kind', 'invalid_criterion', '--reason', 'Again']);

    expect(process.exitCode).toBe(1);
  });

  it('rejects an unknown kind before calling the server', async () => {
    const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(run(['--item', 'c2', '--kind', 'too_hard', '--reason', 'x'])).rejects.toThrow(
      'exit',
    );
    expect(mockTrpcClient.verify.disputeCheck.mutate).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
