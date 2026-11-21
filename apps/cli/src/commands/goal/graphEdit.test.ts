import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerGoalGraphEditCommands, resolveEdge } from './graphEdit';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      addEdge: { mutate: vi.fn() },
      removeEdge: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));

const source = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalGraphEditCommands(program.command('goal'));
  return program.parseAsync(['node', 'test', 'goal', ...args]);
};

describe('resolveEdge', () => {
  it('stores `A blocks B` as `B depends_on A`', () => {
    expect(resolveEdge(source, target, 'blocks')).toEqual({
      kind: 'depends_on',
      sourceNodeId: target,
      targetNodeId: source,
    });
  });

  it('keeps a writable kind as typed', () => {
    expect(resolveEdge(source, target, 'depends_on')).toEqual({
      kind: 'depends_on',
      sourceNodeId: source,
      targetNodeId: target,
    });
  });

  it('names the valid kinds and the direction when the kind is unknown', () => {
    expect(() => resolveEdge(source, target, 'requires')).toThrow(
      /Unknown edge kind "requires".*A depends_on B. means A waits for B[\s\S]*Kinds: depends_on/,
    );
  });
});

describe('goal add-edge / remove-edge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, 'info').mockImplementation(() => {});
  });

  it('add-edge sends the resolved edge and echoes it as a sentence', async () => {
    mockClient.goal.addEdge.mutate.mockResolvedValue({ data: { id: 'edge-1' } });

    await run('add-edge', 'goal-1', source, target, 'blocks');

    expect(mockClient.goal.addEdge.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      kind: 'depends_on',
      sourceNodeId: target,
      targetNodeId: source,
    });
    expect(log.info).toHaveBeenCalledWith('Created edge edge-1: 22222222 depends_on 11111111');
  });

  it('add-edge rejects an unknown kind before calling the server', async () => {
    await expect(run('add-edge', 'goal-1', source, target, 'requires')).rejects.toThrow(
      /Unknown edge kind/,
    );
    expect(mockClient.goal.addEdge.mutate).not.toHaveBeenCalled();
  });

  it('remove-edge without a kind removes every edge between the pair', async () => {
    mockClient.goal.removeEdge.mutate.mockResolvedValue({ message: 'Removed 2 edge(s)' });

    await run('remove-edge', 'goal-1', source, target, '--reason', 'wrong direction');

    expect(mockClient.goal.removeEdge.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      kind: undefined,
      reason: 'wrong direction',
      sourceNodeId: source,
      targetNodeId: target,
    });
    expect(log.info).toHaveBeenCalledWith('Removed 2 edge(s): 11111111 any 22222222');
  });

  it('remove-edge undoes a `blocks` edge with the same words that added it', async () => {
    mockClient.goal.removeEdge.mutate.mockResolvedValue({ message: 'Removed 1 edge(s)' });

    await run('remove-edge', 'goal-1', source, target, 'blocks');

    expect(mockClient.goal.removeEdge.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'depends_on', sourceNodeId: target, targetNodeId: source }),
    );
  });
});
