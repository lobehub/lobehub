import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerVerifyCommand } from './verify';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    verify: {
      createRubric: { mutate: vi.fn() },
      getRubric: { query: vi.fn() },
      updateRubric: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('verify rubric config commands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.verify.createRubric.mutate.mockReset().mockResolvedValue({ id: 'rub-1' });
    mockTrpcClient.verify.updateRubric.mutate.mockReset().mockResolvedValue(undefined);
    mockTrpcClient.verify.getRubric.query.mockReset();
  });

  afterEach(() => consoleSpy.mockRestore());

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerVerifyCommand(program);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('passes maxRepairRounds config when creating a rubric', async () => {
    await run(['rubric', 'create', '-t', 'Standard', '--max-repair-rounds', '3']);

    expect(mockTrpcClient.verify.createRubric.mutate).toHaveBeenCalledWith({
      config: { maxRepairRounds: 3 },
      description: undefined,
      title: 'Standard',
    });
  });

  it('omits config when no max-repair-rounds flag is given', async () => {
    await run(['rubric', 'create', '-t', 'Standard']);

    expect(mockTrpcClient.verify.createRubric.mutate).toHaveBeenCalledWith({
      config: undefined,
      description: undefined,
      title: 'Standard',
    });
  });

  it('updates only the config when max-repair-rounds is passed', async () => {
    await run(['rubric', 'update', 'rub-1', '--max-repair-rounds', '0']);

    expect(mockTrpcClient.verify.updateRubric.mutate).toHaveBeenCalledWith({
      id: 'rub-1',
      value: { config: { maxRepairRounds: 0 } },
    });
  });

  it('views a rubric and prints its repair-round config', async () => {
    mockTrpcClient.verify.getRubric.query.mockResolvedValue({
      config: { maxRepairRounds: 4 },
      description: 'desc',
      id: 'rub-1',
      title: 'Standard',
    });

    await run(['rubric', 'view', 'rub-1']);

    expect(mockTrpcClient.verify.getRubric.query).toHaveBeenCalledWith({ id: 'rub-1' });
    const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Standard');
    expect(printed).toContain('4');
  });
});
