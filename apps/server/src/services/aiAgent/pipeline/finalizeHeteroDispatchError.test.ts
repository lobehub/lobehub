import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finalizeHeteroDispatchError } from './finalizeHeteroDispatchError';

const mocks = vi.hoisted(() => ({
  completeOperation: vi.fn(),
  publishAgentRuntimeEnd: vi.fn(),
}));

vi.mock('@/server/services/agentRuntime/CompletionLifecycle', () => ({
  CompletionLifecycle: class {
    completeOperation = mocks.completeOperation;
  },
}));

vi.mock('@/server/services/agentRuntime/hooks', () => ({
  hookDispatcher: { canDeliver: vi.fn(() => true), getSerializedHooks: vi.fn(() => []) },
}));

vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({ publishAgentRuntimeEnd: mocks.publishAgentRuntimeEnd }),
}));

const createDeps = () => ({
  db: {} as any,
  messageModel: { update: vi.fn().mockResolvedValue(undefined) } as any,
  topicModel: { settleRunningOperation: vi.fn().mockResolvedValue(undefined) } as any,
  userId: 'user-1',
});

const baseParams = {
  assistantMessageId: 'asst-1',
  detail: 'CLAUDE_CODE_OAUTH_TOKEN 未设置。请先在凭证管理中添加该凭证后再运行 claude-code。',
  message: 'Hetero sandbox spawn failed',
  operationId: 'op-1',
  topicId: 'topic-1',
};

describe('finalizeHeteroDispatchError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeOperation.mockResolvedValue(undefined);
  });

  /**
   * The completion hooks (IM bot reply) only see the lifecycle error, not the
   * message row. Before T-1195 that error dropped the body, so the bot could
   * only render a bare Operation ID for a sandbox that was missing a credential.
   */
  it('hands the dispatch cause to the completion hooks', async () => {
    const deps = createDeps();
    const dispatch = {
      agentType: 'claude-code',
      deviceAccessDenied: true,
      missingCredential: 'CLAUDE_CODE_OAUTH_TOKEN',
      stage: 'sandbox_spawn',
    } as const;
    const error = { message: baseParams.message, type: ChatErrorType.ServerAgentRuntimeError };

    await finalizeHeteroDispatchError(deps, { ...baseParams, dispatch });

    expect(deps.messageModel.update).toHaveBeenCalledWith('asst-1', {
      content: '',
      error: { ...error, body: { detail: baseParams.detail, dispatch } },
    });
    // The free-form detail stays on the message row; hooks get only the
    // allowlisted cause.
    expect(mocks.completeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ error: { ...error, body: { dispatch } } }),
      'error',
      { skipErrorMessageWrite: true },
    );
  });

  it('keeps the lifecycle error unchanged for other dispatch failures', async () => {
    await finalizeHeteroDispatchError(createDeps(), baseParams);

    expect(mocks.completeOperation.mock.calls[0][0].error).toEqual({
      message: baseParams.message,
      type: ChatErrorType.ServerAgentRuntimeError,
    });
  });
});
