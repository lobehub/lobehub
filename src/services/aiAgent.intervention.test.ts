import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from './aiAgent';

const mocks = vi.hoisted(() => ({
  resolveAgentInterventionBySource: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      resolveAgentInterventionBySource: {
        mutate: mocks.resolveAgentInterventionBySource,
      },
    },
  },
}));

describe('aiAgentService.resolveAgentInterventionBySource', () => {
  const params = {
    action: { scope: 'once', type: 'approve_tool' } as const,
    batchId: 'batch-1',
    operationId: 'operation-1',
    resolutionRequestId: '018fbd8e-7baf-7c6d-8000-000000000031',
    targets: [{ toolCallId: 'call-1', toolMessageId: 'message-1' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves a claimed result and its precreated execution', async () => {
    const execution = {
      autoStarted: true,
      messageId: 'assistant-1',
      operationId: 'operation-resumed',
      success: true,
    };
    mocks.resolveAgentInterventionBySource.mockResolvedValueOnce({
      contractVersion: 2,
      execution,
      state: 'claimed',
      status: 'approved',
      success: true,
    });

    await expect(aiAgentService.resolveAgentInterventionBySource(params)).resolves.toEqual({
      execution,
      handled: true,
      state: 'claimed',
    });
  });

  it('preserves an already-resolved result without inventing an execution', async () => {
    mocks.resolveAgentInterventionBySource.mockResolvedValueOnce({
      contractVersion: 2,
      state: 'already_resolved',
      status: 'approved',
      success: true,
    });

    await expect(aiAgentService.resolveAgentInterventionBySource(params)).resolves.toEqual({
      execution: undefined,
      handled: true,
      state: 'already_resolved',
    });
  });

  it('returns only the compatibility fallback when the source is unavailable', async () => {
    mocks.resolveAgentInterventionBySource.mockResolvedValueOnce({
      contractVersion: 2,
      status: 'unavailable',
      success: false,
    });

    const result = await aiAgentService.resolveAgentInterventionBySource(params);

    expect(result).toEqual({ handled: false });
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('execution');
  });
});
