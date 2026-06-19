import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelAgentRun,
  clearAgentRunsForTest,
  getAgentRun,
  listAgentRuns,
  registerAgentRun,
} from './agentRunSupervisor';

const { mockHeteroFinishMutate } = vi.hoisted(() => ({
  mockHeteroFinishMutate: vi.fn().mockResolvedValue({ ack: true }),
}));

vi.mock('../api/client', () => ({
  createLambdaClient: vi.fn(() => ({
    aiAgent: {
      heteroFinish: {
        mutate: mockHeteroFinishMutate,
      },
    },
  })),
}));

const makeFakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  child.kill = vi.fn().mockReturnValue(true);
  child.pid = 1234;
  return child;
};

describe('agentRunSupervisor', () => {
  afterEach(() => {
    clearAgentRunsForTest();
    mockHeteroFinishMutate.mockClear();
  });

  it('registers an accepted agent run by operationId', () => {
    const child = makeFakeChild();

    registerAgentRun({
      agentType: 'codex',
      child,
      jwt: 'jwt',
      operationId: 'op-1',
      serverUrl: 'https://app.lobehub.com',
      topicId: 'topic-1',
    });

    expect(getAgentRun('op-1')).toEqual(
      expect.objectContaining({
        agentType: 'codex',
        child,
        operationId: 'op-1',
        pid: 1234,
        topicId: 'topic-1',
      }),
    );
  });

  it('cleans up a run after child exit or close', () => {
    const child = makeFakeChild();
    registerAgentRun({
      agentType: 'claude-code',
      child,
      jwt: 'jwt',
      operationId: 'op-2',
      serverUrl: 'https://app.lobehub.com',
      topicId: 'topic-2',
    });

    child.emit('exit', 0, null);

    expect(getAgentRun('op-2')).toBeUndefined();
    expect(listAgentRuns()).toEqual([]);
  });

  it('sends SIGINT by default when cancelling an existing operation', async () => {
    const child = makeFakeChild();
    registerAgentRun({
      agentType: 'codex',
      child,
      jwt: 'jwt',
      operationId: 'op-3',
      serverUrl: 'https://app.lobehub.com',
      topicId: 'topic-3',
    });

    const result = await cancelAgentRun({ operationId: 'op-3' });

    expect(child.kill).toHaveBeenCalledWith('SIGINT');
    expect(mockHeteroFinishMutate).toHaveBeenCalledWith({
      agentType: 'codex',
      operationId: 'op-3',
      result: 'cancelled',
      topicId: 'topic-3',
    });
    expect(result).toEqual({
      operationId: 'op-3',
      pid: 1234,
      signal: 'SIGINT',
      success: true,
    });
  });

  it('returns success false when operationId is not registered', async () => {
    await expect(cancelAgentRun({ operationId: 'missing' })).resolves.toEqual({
      message: 'No agent run found with operationId: missing',
      operationId: 'missing',
      success: false,
    });
  });
});
