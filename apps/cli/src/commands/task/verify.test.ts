import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerVerifyCommands, toVerifyPatch } from './verify';

const { client } = vi.hoisted(() => ({
  client: {
    task: {
      getVerifyConfig: { query: vi.fn() },
      updateVerifyConfig: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => client) }));
vi.mock('../../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerVerifyCommands(program.command('task'));
  return program.parseAsync(['node', 'test', 'task', 'verify', ...args]);
};

describe('toVerifyPatch', () => {
  it('sends only explicit flags', () => {
    expect(toVerifyPatch({})).toEqual({});
    expect(toVerifyPatch({ criteria: 'a, b', enable: true, maxIterations: '3' })).toEqual({
      enabled: true,
      maxIterations: 3,
      verifyCriteriaIds: ['a', 'b'],
    });
  });

  it('clears values with null', () => {
    expect(toVerifyPatch({ criteria: 'null', maxIterations: 'null', requirement: 'none' })).toEqual(
      { maxIterations: null, requirement: null, verifyCriteriaIds: null },
    );
  });

  it.each(['3abc', '2.5'])('rejects max iterations %s', (maxIterations) => {
    expect(() => toVerifyPatch({ maxIterations })).toThrow('--max-iterations');
  });

  it('refuses contradictory flags', () => {
    expect(() => toVerifyPatch({ disable: true, enable: true })).toThrow('cannot be used');
  });
});

describe('task verify commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    client.task.updateVerifyConfig.mutate.mockReset();
    client.task.updateVerifyConfig.mutate.mockResolvedValue({ data: {} });
  });

  it('shows unset enabled as on, because only an explicit false turns the gate off', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    client.task.getVerifyConfig.query.mockResolvedValue({ data: { requirement: 'CI green' } });

    await run('view', 'T-1');

    expect(String(consoleSpy.mock.calls[0][0])).toContain('true');
    consoleSpy.mockRestore();
  });

  it('sets the conditions', async () => {
    await run('set', 'T-1', '--requirement', 'CI green', '--disable');

    expect(client.task.updateVerifyConfig.mutate).toHaveBeenCalledWith({
      id: 'T-1',
      verify: { enabled: false, requirement: 'CI green' },
    });
  });

  it('refuses an empty update', async () => {
    await run('set', 'T-1');

    expect(client.task.updateVerifyConfig.mutate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
