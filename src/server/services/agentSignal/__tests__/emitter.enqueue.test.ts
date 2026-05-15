// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('enqueueAgentSignalSourceEvent', () => {
  it('falls back to in-process execution when workflow enqueue fails in local/test runtime', async () => {
    vi.resetModules();

    const getServerDB = vi.fn().mockResolvedValue({} as never);
    const triggerRun = vi
      .fn()
      .mockRejectedValue(
        new Error(
          '{"error":"invalid destination url: endpoint resolves to a loopback address: ::1"}',
        ),
      );
    const executeAgentSignalSourceEvent = vi.fn().mockResolvedValue({ deduped: true });

    vi.doMock('@/database/server', () => ({ getServerDB }));
    vi.doMock('../featureGate', () => ({
      isAgentSignalEnabledForUser: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock('@/server/workflows/agentSignal', () => ({
      AgentSignalWorkflow: { triggerRun },
    }));
    vi.doMock('../orchestrator', () => ({ executeAgentSignalSourceEvent }));

    const { enqueueAgentSignalSourceEvent } = await import('../emitter');

    const result = await enqueueAgentSignalSourceEvent(
      {
        payload: {
          message: 'Remember this',
          messageId: 'msg-1',
        },
        scopeKey: 'topic:topic-1',
        sourceId: 'source-1',
        sourceType: 'agent.user.message',
        timestamp: 1_710_000_000_000,
      },
      {
        agentId: 'agent-1',
        userId: 'user-1',
      },
    );

    expect(triggerRun).toHaveBeenCalledTimes(1);
    expect(executeAgentSignalSourceEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accepted: true,
      scopeKey: 'topic:topic-1',
      workflowRunId: 'local:source-1',
    });
  });

  it('keeps throwing non-loopback enqueue errors in production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');

    const getServerDB = vi.fn().mockResolvedValue({} as never);
    const triggerRun = vi.fn().mockRejectedValue(new Error('qstash unavailable'));
    const executeAgentSignalSourceEvent = vi.fn();

    vi.doMock('@/database/server', () => ({ getServerDB }));
    vi.doMock('../featureGate', () => ({
      isAgentSignalEnabledForUser: vi.fn().mockResolvedValue(true),
    }));
    vi.doMock('@/server/workflows/agentSignal', () => ({
      AgentSignalWorkflow: { triggerRun },
    }));
    vi.doMock('../orchestrator', () => ({ executeAgentSignalSourceEvent }));

    const { enqueueAgentSignalSourceEvent } = await import('../emitter');

    await expect(
      enqueueAgentSignalSourceEvent(
        {
          payload: {
            message: 'Remember this',
            messageId: 'msg-1',
          },
          scopeKey: 'topic:topic-1',
          sourceId: 'source-1',
          sourceType: 'agent.user.message',
          timestamp: 1_710_000_000_000,
        },
        {
          agentId: 'agent-1',
          userId: 'user-1',
        },
      ),
    ).rejects.toThrow('qstash unavailable');

    expect(executeAgentSignalSourceEvent).not.toHaveBeenCalled();
  });
});
