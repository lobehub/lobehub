/** The agent run fee of an external agent this desktop spawns itself. */

import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeHeterogeneousAgent } from '../transports/hetero/heterogeneousAgentExecutor';
import {
  ccInit,
  ccResult,
  ccText,
  createMockStore,
  defaultParams,
  setupIpcCapture,
} from './heterogeneousAgentExecutor.testUtils';

const mockBeginFee = vi.fn();
const mockFinishFee = vi.fn();
const mockSendPrompt = vi.fn();
const mockStartSession = vi.fn();
const mockUpdateMessageError = vi.fn();

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { info: vi.fn() },
}));

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    beginLocalHeteroRunFee: (...args: any[]) => mockBeginFee(...args),
    finishLocalHeteroRunFee: (...args: any[]) => mockFinishFee(...args),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    batchMutate: vi.fn(async (operations: any[]) => ({
      results: operations.map((operation, index) => ({ index, success: true, ...operation })),
      success: true,
    })),
    createMessage: vi.fn(async (params: any) => ({ id: params.id })),
    getMessages: vi.fn(async () => []),
    updateMessage: vi.fn(async () => undefined),
    updateMessageError: (...args: any[]) => mockUpdateMessageError(...args),
    updateToolMessage: vi.fn(async () => undefined),
  },
}));

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    cancelSession: vi.fn(async () => undefined),
    getClaudeCodeIdentity: vi.fn(async () => null),
    getCodexQuota: vi.fn(async () => null),
    getSessionInfo: vi.fn(async () => ({})),
    sendPrompt: (...args: any[]) => mockSendPrompt(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    stopSession: vi.fn(async () => undefined),
  },
}));

vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: {
    recordUsage: vi.fn(async () => undefined),
    selectAccountForAgent: vi.fn(async () => null),
  },
}));

vi.mock('../transports/gateway/gatewayEventHandler', () => ({
  createGatewayEventHandler: vi.fn(() => vi.fn()),
}));

describe('heterogeneousAgentExecutor run fee', () => {
  let ipc: ReturnType<typeof setupIpcCapture>;

  /** The CLI streams one answer and exits cleanly. */
  const answerCleanly = async (params: any) => {
    ipc.emitRawLine(params.sessionId, ccInit());
    ipc.emitRawLine(params.sessionId, ccText('msg-1', 'answer'));
    ipc.emitRawLine(params.sessionId, ccResult());
    ipc.emitComplete(params.sessionId);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = setupIpcCapture();
    let session = 0;
    mockStartSession.mockImplementation(async (params: any) => {
      session += 1;
      const sessionId = `ipc-sess-${session}`;
      ipc.setAgentType(sessionId, params.agentType ?? 'claude-code');
      return { sessionId };
    });
    mockSendPrompt.mockImplementation(answerCleanly);
    mockBeginFee.mockResolvedValue({ feeId: 'local_hetero_1_fee' });
    mockFinishFee.mockResolvedValue({ success: true });
    mockUpdateMessageError.mockResolvedValue({ success: false });
  });

  it('holds the fee before spawning the CLI and charges it after a finished run', async () => {
    await executeHeterogeneousAgent(() => createMockStore(), defaultParams);

    expect(mockBeginFee).toHaveBeenCalledWith(
      { topicId: 'topic-1' },
      { signal: expect.any(AbortSignal), workspaceId: null },
    );
    expect(mockBeginFee.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartSession.mock.invocationCallOrder[0],
    );
    expect(mockFinishFee).toHaveBeenCalledTimes(1);
    expect(mockFinishFee).toHaveBeenCalledWith(
      { durationMs: expect.any(Number), feeId: 'local_hetero_1_fee', reason: 'done' },
      { signal: expect.any(AbortSignal), workspaceId: null },
    );
  });

  it('holds and settles in the scope the run started in', async () => {
    await executeHeterogeneousAgent(() => createMockStore(), {
      ...defaultParams,
      workspaceId: null,
    });

    expect(mockBeginFee.mock.calls[0][1]).toMatchObject({ workspaceId: null });
    expect(mockFinishFee.mock.calls[0][1]).toMatchObject({ workspaceId: null });
  });

  /**
   * @example The user clicks Stop right after sending, while the fee hold is still pending.
   */
  it('does not start the CLI when the user stops during the fee hold', async () => {
    // Before: the executor spawned the CLI once the hold returned, though the
    // run had been stopped; the native cancel was registered only after spawn.
    const abortController = new AbortController();
    const updateTopicStatus = vi.fn();
    const store = createMockStore({
      activeTopicId: 'topic-1',
      onOperationCancel: vi.fn(),
      operations: {
        'op-1': {
          abortController,
          context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
          metadata: { startTime: 0 },
        },
      },
      updateTopicStatus,
    });
    mockBeginFee.mockImplementation(async () => {
      abortController.abort();
      return { feeId: 'local_hetero_1_fee' };
    });

    await executeHeterogeneousAgent(() => store, defaultParams);

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockFinishFee).toHaveBeenCalledWith(
      expect.objectContaining({ feeId: 'local_hetero_1_fee', reason: 'interrupted' }),
      expect.anything(),
    );
    // The topic leaves the running state as any other stopped run does.
    expect(updateTopicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', topicId: 'topic-1' }),
    );
  });

  /**
   * @example A user whose balance cannot cover the fee sends to Claude Code on Desktop.
   */
  it('does not start the CLI when the server refuses an unfunded fee', async () => {
    // Before: desktop-local runs never reported to the server, so a user with
    // no balance ran Claude Code / Codex without paying the agent run fee.
    // After: the refused hold ends the run with the fee error and no CLI.
    mockBeginFee.mockRejectedValue(new Error(ChatErrorType.InsufficientBudgetForAgentRunFee));

    await executeHeterogeneousAgent(() => createMockStore(), defaultParams);

    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockSendPrompt).not.toHaveBeenCalled();
    expect(mockUpdateMessageError).toHaveBeenCalledWith(
      'ast-initial',
      expect.objectContaining({ type: ChatErrorType.InsufficientBudgetForAgentRunFee }),
      expect.anything(),
    );
    expect(mockFinishFee).not.toHaveBeenCalled();
  });

  it('still runs when the fee hold fails for another reason', async () => {
    mockBeginFee.mockRejectedValue(new Error('No "mutation"-procedure on path'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await executeHeterogeneousAgent(() => createMockStore(), defaultParams);

    expect(mockStartSession).toHaveBeenCalledTimes(1);
    expect(mockFinishFee).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('gives the fee back when the CLI fails', async () => {
    mockSendPrompt.mockRejectedValue(new Error('Agent exited with code 1'));

    await executeHeterogeneousAgent(() => createMockStore(), defaultParams);

    expect(mockFinishFee).toHaveBeenCalledWith(
      expect.objectContaining({ feeId: 'local_hetero_1_fee', reason: 'error' }),
      expect.anything(),
    );
  });

  it('settles a stopped run as interrupted', async () => {
    const abortController = new AbortController();
    const store = createMockStore({
      onOperationCancel: vi.fn(),
      operations: {
        'op-1': {
          abortController,
          context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
          metadata: { startTime: 0 },
        },
      },
    });
    mockSendPrompt.mockImplementation(async (params: any) => {
      ipc.emitRawLine(params.sessionId, ccInit());
      abortController.abort();
      ipc.emitComplete(params.sessionId);
    });

    await executeHeterogeneousAgent(() => store, defaultParams);

    expect(mockFinishFee).toHaveBeenCalledWith(
      expect.objectContaining({ feeId: 'local_hetero_1_fee', reason: 'interrupted' }),
      expect.anything(),
    );
  });

  /**
   * @example The user stops a run and the cancel cleanup takes several more seconds.
   */
  it('reports the duration up to the Stop, not up to the end of cleanup', async () => {
    // Before: the server measured until `finish` arrived, after cleanup, so the
    // cleanup counted toward the stopped run's duration.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const abortController = new AbortController();
    const store = createMockStore({
      onOperationCancel: vi.fn(),
      operations: {
        'op-1': {
          abortController,
          context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
          metadata: { startTime: 0 },
        },
      },
    });
    mockSendPrompt.mockImplementation(async (params: any) => {
      ipc.emitRawLine(params.sessionId, ccInit());
      vi.setSystemTime(28_000);
      abortController.abort();
      vi.setSystemTime(40_000);
      ipc.emitComplete(params.sessionId);
    });

    try {
      await executeHeterogeneousAgent(() => store, defaultParams);
    } finally {
      vi.useRealTimers();
    }

    expect(mockFinishFee.mock.calls[0][0]).toMatchObject({ durationMs: 28_000 });
  });

  it('holds one fee across a resume fallback retry', async () => {
    mockSendPrompt.mockRejectedValueOnce({
      agentType: 'claude-code',
      code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
      message: 'No conversation found with session ID',
    });

    await executeHeterogeneousAgent(() => createMockStore(), {
      ...defaultParams,
      resumeSessionId: 'cc-stale',
    });

    expect(mockStartSession).toHaveBeenCalledTimes(2);
    expect(mockBeginFee).toHaveBeenCalledTimes(1);
    expect(mockFinishFee).toHaveBeenCalledTimes(1);
    expect(mockFinishFee).toHaveBeenCalledWith(
      expect.objectContaining({ feeId: 'local_hetero_1_fee', reason: 'done' }),
      expect.anything(),
    );
  });

  it.each([
    ['a continuation', { continuesRun: true }],
    ['a transcript replay', { replayTranscript: true, resumeSessionId: 'cc-sess-1' }],
    ['a sub-agent', { context: { ...defaultParams.context, scope: 'sub_agent' as const } }],
    [
      'a group member',
      { context: { ...defaultParams.context, orchestrationRole: 'member' as const } },
    ],
  ])('holds no fee for %s', async (_name, overrides) => {
    await executeHeterogeneousAgent(() => createMockStore(), { ...defaultParams, ...overrides });

    expect(mockBeginFee).not.toHaveBeenCalled();
    expect(mockFinishFee).not.toHaveBeenCalled();
  });
});
