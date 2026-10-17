import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerAcceptanceCommands } from '.';
import { registerVerifyCommand } from './deprecatedVerify';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    verify: {
      getVerifyState: { query: vi.fn() },
      listCriteria: { query: vi.fn() },
      listRubrics: { query: vi.fn() },
    },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));
vi.mock('../../settings', () => ({
  loadActiveWorkspace: () => undefined,
  resolveServerUrl: () => 'https://app.lobehub.com',
}));

const parse = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerVerifyCommand(program);
  registerAcceptanceCommands(program);
  await program.parseAsync(['node', 'lh', ...args]);
};

describe('`lh verify` moved under `lh acceptance`', () => {
  beforeEach(() => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockTrpcClient.verify.getVerifyState.query.mockResolvedValue(null);
    mockTrpcClient.verify.listCriteria.query.mockResolvedValue([]);
    mockTrpcClient.verify.listRubrics.query.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [['acceptance', 'plan', 'state', 'op_1']],
    [['acceptance', 'criterion', 'list']],
    [['acceptance', 'rubric', 'list']],
  ])('runs %j without a deprecation warning', async (args) => {
    await parse(...args);

    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    [['verify', 'plan', 'state', 'op_1'], 'lh acceptance plan state'],
    [['verify', 'criterion', 'list'], 'lh acceptance criterion list'],
    [['verify', 'rubric', 'list'], 'lh acceptance rubric list'],
  ])('keeps %j working and names %s as its replacement', async (args, replacement) => {
    await parse(...args);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(`use \`${replacement}\``));
  });

  it('routes both spellings of plan state to the same query', async () => {
    await parse('verify', 'plan', 'state', 'op_1');
    await parse('acceptance', 'plan', 'state', 'op_2');

    expect(mockTrpcClient.verify.getVerifyState.query.mock.calls).toEqual([
      [{ operationId: 'op_1' }],
      [{ operationId: 'op_2' }],
    ]);
  });

  it('points `lh verify execute` at `lh acceptance plan execute`', async () => {
    const program = new Command();
    registerVerifyCommand(program);
    registerAcceptanceCommands(program);
    const plan = program.commands
      .find((c) => c.name() === 'acceptance')
      ?.commands.find((c) => c.name() === 'plan');

    expect(plan?.commands.map((c) => c.name())).toContain('execute');
    expect(program.commands.find((c) => c.name() === 'verify')?.description()).toContain(
      'lh acceptance',
    );
  });
});
