import { Buffer } from 'node:buffer';

import { TRPCClientError } from '@trpc/client';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../utils/logger';
import { registerGoalCommand } from '.';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    goal: {
      graph: { query: vi.fn() },
      graphOperation: { query: vi.fn() },
      metricState: { query: vi.fn() },
      metricStateOperation: { query: vi.fn() },
      recordObservation: { mutate: vi.fn() },
      removeMetricCriteria: { mutate: vi.fn() },
      setMetricCriteria: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
vi.mock('../task/url', () => ({
  resolveAppUrlBuilder: vi
    .fn()
    .mockResolvedValue((pathname: string) => `https://app.lobehub.com${pathname}`),
}));

const run = (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerGoalCommand(program);
  return program.parseAsync(['node', 'test', 'goal', ...args]);
};

const operationToken = () =>
  vi.stubEnv(
    'LOBEHUB_JWT',
    `header.${Buffer.from(JSON.stringify({ purpose: 'hetero-operation' })).toString('base64url')}.signature`,
  );

const measuredGraph = {
  decisions: [],
  edges: [],
  goal: {
    config: { acceptance: { metrics: [{ key: 'latency_ms', op: 'lte', target: 16.7 }] } },
    id: 'goal-1',
    requirement: null,
    status: 'running',
    title: 'Measured',
  },
  nodes: [],
};

const recordedState = {
  allMet: true,
  criteria: [{ key: 'latency_ms', met: true, op: 'lte', target: 16.7, value: 5 }],
};

describe('goal measured acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(console.log).mockRestore();
  });

  it('shows the value the gate reads, so a recorded clause is not read as unmeasured', async () => {
    // A planner that saw only the declaration reported "no observation" a
    // minute after the owner recorded 5 ms, and kept the goal waiting.
    operationToken();
    mockClient.goal.graphOperation.query.mockResolvedValue({ data: measuredGraph });
    mockClient.goal.metricStateOperation.query.mockResolvedValue({ data: recordedState });

    await run('show', 'goal-1', '--json');

    expect(mockClient.goal.metricStateOperation.query).toHaveBeenCalledWith({ id: 'goal-1' });
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(output.metrics).toEqual(recordedState);
  });

  it('prints each clause with its reading', async () => {
    mockClient.goal.graph.query.mockResolvedValue({ data: measuredGraph });
    mockClient.goal.metricState.query.mockResolvedValue({
      data: {
        allMet: false,
        criteria: [{ key: 'latency_ms', met: false, op: 'lte', target: 16.7, value: null }],
      },
    });

    await run('show', 'goal-1');

    const printed = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(printed).toContain('latency_ms ≤ 16.7');
    expect(printed).toContain('no observation');
  });

  it('skips the metric read for a goal that declares no clauses', async () => {
    mockClient.goal.graph.query.mockResolvedValue({
      data: { ...measuredGraph, goal: { ...measuredGraph.goal, config: {} } },
    });

    await run('show', 'goal-1', '--json');

    expect(mockClient.goal.metricState.query).not.toHaveBeenCalled();
  });

  it('still shows the goal when the server cannot report metric values', async () => {
    mockClient.goal.graph.query.mockResolvedValue({ data: measuredGraph });
    mockClient.goal.metricState.query.mockRejectedValue(
      new TRPCClientError('No procedure found on path "goal.metricState"', {
        result: { error: { data: { code: 'NOT_FOUND' } } } as never,
      }),
    );

    await run('show', 'goal-1', '--json');

    const output = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(output.goal.id).toBe('goal-1');
    expect(output.metrics).toBeUndefined();
  });

  it('fails the show when the metric read fails for any other reason', async () => {
    // Swallowing an expired login or a server error would print the goal as if
    // nothing were recorded — the unreadable gate this read exists to fix.
    mockClient.goal.graph.query.mockResolvedValue({ data: measuredGraph });
    mockClient.goal.metricState.query.mockRejectedValue(new Error('fetch failed'));

    await expect(run('show', 'goal-1', '--json')).rejects.toThrow('fetch failed');
  });

  it('records, declares and removes clauses with the owner login', async () => {
    vi.spyOn(log, 'info').mockImplementation(() => {});
    mockClient.goal.recordObservation.mutate.mockResolvedValue({ message: 'Observation recorded' });
    mockClient.goal.setMetricCriteria.mutate.mockResolvedValue({ message: 'Updated' });
    mockClient.goal.removeMetricCriteria.mutate.mockResolvedValue({ message: 'Removed' });

    await run('metric', 'record', 'goal-1', 'latency_ms', '5', '--unit', 'ms');
    await run('metric', 'set', 'goal-1', 'latency_ms', '--op', 'lte', '--target', '16.6');
    await run('metric', 'remove', 'goal-1', 'latency_ms');

    expect(mockClient.goal.recordObservation.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      key: 'latency_ms',
      title: undefined,
      unit: 'ms',
      value: 5,
    });
    expect(mockClient.goal.setMetricCriteria.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      metrics: [{ key: 'latency_ms', op: 'lte', target: 16.6, title: undefined }],
      mode: 'merge',
    });
    expect(mockClient.goal.removeMetricCriteria.mutate).toHaveBeenCalledWith({
      id: 'goal-1',
      keys: ['latency_ms'],
    });
  });

  it('refuses to let a planning run write the number that clears its own gate', async () => {
    operationToken();

    await expect(run('metric', 'record', 'goal-1', 'latency_ms', '5')).rejects.toThrow(
      'written by the goal owner',
    );
    expect(mockClient.goal.recordObservation.mutate).not.toHaveBeenCalled();
  });
});
