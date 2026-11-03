// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import { aiChatRouter } from '../aiChat';

vi.mock('@/database/models/agent');
vi.mock('@/database/models/message');
vi.mock('@/database/models/thread');
vi.mock('@/database/repositories/topic');
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const mockCtx = { userId: 'u1' };

describe('aiChatRouter.decide', () => {
  const questions = {
    helpful: {
      criteria: { false: 'Chatter.', true: 'An open question.' },
      instructions: 'Would stepping in help?',
      type: 'boolean' as const,
    },
  };

  it('asks the decision model from the server and returns its answers', async () => {
    const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
    const response = {
      answers: { helpful: { probability: 0.82, type: 'boolean' } },
      model: 'jev-1.14.0',
    };
    const mockDecide = vi.fn().mockResolvedValue(response);
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ decide: mockDecide } as any);

    const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);
    const result = await caller.decide({
      metadata: { trigger: 'cli' },
      model: 'jev-1.14.0',
      provider: 'lobehub',
      questions,
      state: 'Newest message: is the queue mode ready?',
    });

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith({}, 'u1', 'lobehub', undefined);
    expect(mockDecide).toHaveBeenCalledWith(
      { model: 'jev-1.14.0', questions, state: 'Newest message: is the queue mode ready?' },
      {
        metadata: { trigger: 'cli' },
        signal: undefined,
        tracing: { tracingId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      },
    );
    expect(result.data).toEqual(response);
    expect(result.tracingId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a request without questions before calling the model', async () => {
    const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
    vi.mocked(initModelRuntimeFromDB).mockClear();

    const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

    await expect(
      caller.decide({ model: 'jev-1.14.0', provider: 'lobehub', questions: {}, state: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(initModelRuntimeFromDB).not.toHaveBeenCalled();
  });

  it('maps a provider without decision support to a client error', async () => {
    const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
    const mockDecide = vi.fn().mockRejectedValue({
      error: { message: 'Decision models are not supported by this provider' },
      errorType: AgentRuntimeErrorType.CapabilityNotSupported,
    });
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ decide: mockDecide } as any);

    const caller = aiChatRouter.createCaller({ ...mockCtx, serverDB: {} } as any);

    try {
      await caller.decide({ model: 'gpt-4o', provider: 'openai', questions, state: 'x' });
      throw new Error('Expected decide to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ message: AgentRuntimeErrorType.CapabilityNotSupported });
      expect((error as TRPCError).code).not.toBe('INTERNAL_SERVER_ERROR');
    }
  });
});
