import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ConversationContext } from '../../../types';
import { createStore } from '../../index';

// ── Mock the hetero runtime seam ──
// `continueHeteroAfterError` re-creates ONE assistant row chained onto the run's
// surviving tail, then delegates to `executeHeterogeneousAgent` with the topic's
// resumable CLI session. We spy on that boundary to assert what the new turn is
// parented to and which prompt it carries — a continuation instruction, not the
// original user prompt (which would restart the whole task).
const mockExecuteHeterogeneousAgent = vi.fn();
vi.mock(
  '@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor',
  () => ({
    executeHeterogeneousAgent: (...args: any[]) => mockExecuteHeterogeneousAgent(...args),
  }),
);

// The action must route from the merged effective config. A current member's
// private local override runs in-process even if the shared workspace row points
// at the gateway.
const mockSelectRuntimeType = vi.fn((ctx: any) =>
  ctx?.executionTarget === 'local' && !ctx?.isWorkspaceAgent ? 'hetero' : 'gateway',
);
vi.mock('@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher', () => ({
  selectRuntimeType: (ctx: any) => mockSelectRuntimeType(ctx),
}));

let mockResumeSessionId: string | undefined = 'sess-1';
let mockIsWorkspaceAgent = false;
let mockSharedExecutionTarget: 'device' | 'local' = 'local';
let mockWorkspaceOverride: { boundDeviceId: string; executionTarget: 'local' } | undefined;
vi.mock('@/store/chat/slices/agentRun/actions/transports/hetero/heteroResume', () => ({
  resolveHeteroResume: () => ({ cwdChanged: false, resumeSessionId: mockResumeSessionId }),
}));

vi.mock('@/store/chat/utils/activeTopicDocumentContext', () => ({
  mergeAgentRuntimeInitialContexts: () => undefined,
  resolveActiveTopicDocumentInitialContext: async () => undefined,
}));

vi.mock('@/store/chat/slices/operation/selectors', () => ({
  operationSelectors: {
    getOperationById: () => () => undefined,
    isMessageProcessing: () => () => false,
  },
}));

const mockCreateMessage = vi.fn(async () => ({ id: 'assistant-new' }));
const mockUpdateMessage = vi.fn(async () => ({ success: false }));
const mockRemoveMessages = vi.fn(async () => ({ success: false }));
vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: (...args: any[]) => mockCreateMessage(...(args as [])),
    removeMessages: (...args: any[]) => mockRemoveMessages(...(args as [])),
    updateMessage: (...args: any[]) => mockUpdateMessage(...(args as [])),
  },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({ localAgentWorkingDirectoryMap: {} }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    isWorkspaceAgentById: () => () => mockIsWorkspaceAgent,
  },
  agentSelectors: {
    getAgentConfigById: () => () => ({
      agencyConfig: {
        boundDeviceId: 'workspace-device',
        executionTarget: mockSharedExecutionTarget,
        heterogeneousProvider: { type: 'claude-code' },
        workingDirByDevice: {
          'personal-device': '/Users/me/project',
          'workspace-device': '/workspace/project',
        },
      },
    }),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { getTopicById: () => () => undefined },
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'personal-device' } }),
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({
    workspaceUserPreference: {
      agentDeviceOverrides: mockWorkspaceOverride ? { 'agent-1': mockWorkspaceOverride } : {},
    },
  }),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { info: vi.fn() },
}));

const mockChatDeleteMessage = vi.fn(async () => {});
const mockExecuteGatewayAgent = vi.fn(async () => {});
const noop = vi.fn();
vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      operations: {},
      operationsByMessage: {},

      associateMessageWithOperation: noop,
      completeOperation: noop,
      deleteMessage: (...args: any[]) => mockChatDeleteMessage(...(args as [])),
      executeGatewayAgent: (...args: any[]) => mockExecuteGatewayAgent(...(args as [])),
      failOperation: noop,
      internal_updateTopicLoading: noop,
      isGatewayModeEnabled: () => false,
      refreshMessages: vi.fn(async () => {}),
      startOperation: vi.fn(() => ({ operationId: 'op-id' })),
      switchMessageBranch: vi.fn(async () => {}),
    })),
    setState: vi.fn(),
  },
}));

const CONTEXT: ConversationContext = { agentId: 'agent-1', threadId: null, topicId: 'topic-1' };

const HETERO_RATE_LIMIT = { body: { agentType: 'claude-code', code: 'rate_limit' } };

const USER_MESSAGE = { content: 'clean up worktrees', id: 'user-1', role: 'user' };

/**
 * A finished-then-failed run: step-1 did real work (a tool call), step-2 opened
 * and immediately died on the usage limit. `step-1` is also the group id.
 */
const buildGroupStore = (children: any[], dbMessages?: any[]) => {
  const store = createStore({ context: CONTEXT });
  act(() => {
    store.setState({
      dbMessages: dbMessages ?? [
        USER_MESSAGE,
        { content: '', id: 'step-1', parentId: 'user-1', role: 'assistant' },
        { content: '', id: 'step-2', parentId: 'step-1', role: 'assistant' },
      ],
      displayMessages: [
        USER_MESSAGE,
        { children, content: '', id: 'step-1', parentId: 'user-1', role: 'assistantGroup' },
      ],
    } as any);
  });
  return store;
};

const executorParams = () => mockExecuteHeterogeneousAgent.mock.calls[0][1];

describe('continueHeteroAfterError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResumeSessionId = 'sess-1';
    mockIsWorkspaceAgent = false;
    mockSharedExecutionTarget = 'local';
    mockWorkspaceOverride = undefined;
  });

  it('keeps a tail step that did work: clears its error and chains the continuation onto it', async () => {
    const store = buildGroupStore([
      { content: 'looking', id: 'step-1', tools: [{ id: 'call-1' }] },
      { content: '', error: HETERO_RATE_LIMIT, id: 'step-2', tools: [{ id: 'call-2' }] },
    ]);

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    // The failed step survives, minus its error.
    expect(mockUpdateMessage).toHaveBeenCalledWith('step-2', { error: null }, CONTEXT);
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    // The whole turn must NOT be deleted.
    expect(mockChatDeleteMessage).not.toHaveBeenCalled();

    // New assistant row chains onto the tail, keeping it inside the same group.
    expect(mockCreateMessage).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'step-2' }));

    expect(mockExecuteHeterogeneousAgent).toHaveBeenCalledTimes(1);
    expect(executorParams()).toMatchObject({
      assistantMessageId: 'assistant-new',
      resumeSessionId: 'sess-1',
    });
    expect(executorParams().message).toContain('Continue the task from where it stopped');
    expect(executorParams().message).not.toBe(USER_MESSAGE.content);
  });

  it('drops an error-only tail step and chains the continuation onto its parent', async () => {
    // The terminal-error echo suppressor cleared the step's content, so it has
    // nothing to render — keeping it would leave an empty block in the bubble.
    const store = buildGroupStore([
      { content: 'looking', id: 'step-1', tools: [{ id: 'call-1' }] },
      { content: '', error: HETERO_RATE_LIMIT, id: 'step-2' },
    ]);

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    expect(mockRemoveMessages).toHaveBeenCalledWith(['step-2'], CONTEXT);
    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(mockChatDeleteMessage).not.toHaveBeenCalled();
    expect(mockCreateMessage).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'step-1' }));
  });

  it('falls back to a whole-turn regenerate when the failed step is the group head', async () => {
    // Nothing ran before the failure, so there is no work to keep — and the
    // head's id doubles as the group id.
    const store = buildGroupStore(
      [{ content: '', error: HETERO_RATE_LIMIT, id: 'step-1' }],
      [USER_MESSAGE, { content: '', id: 'step-1', parentId: 'user-1', role: 'assistant' }],
    );

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    expect(mockChatDeleteMessage).toHaveBeenCalledWith('step-1', { operationId: 'op-id' });
    // Regenerated from the original user prompt, not the continuation prompt.
    expect(executorParams().message).toBe(USER_MESSAGE.content);
  });

  it('falls back to a whole-turn regenerate when no CLI session survives to resume', async () => {
    mockResumeSessionId = undefined;
    const store = buildGroupStore([
      { content: 'looking', id: 'step-1', tools: [{ id: 'call-1' }] },
      { content: '', error: HETERO_RATE_LIMIT, id: 'step-2' },
    ]);

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    expect(mockChatDeleteMessage).toHaveBeenCalledWith('step-1', { operationId: 'op-id' });
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(executorParams().message).toBe(USER_MESSAGE.content);
  });

  it('resumes locally when a workspace member overrides the shared device with this desktop', async () => {
    mockIsWorkspaceAgent = true;
    mockSharedExecutionTarget = 'device';
    mockWorkspaceOverride = {
      boundDeviceId: 'personal-device',
      executionTarget: 'local',
    };
    const store = buildGroupStore([
      { content: 'looking', id: 'step-1', tools: [{ id: 'call-1' }] },
      { content: '', error: HETERO_RATE_LIMIT, id: 'step-2' },
    ]);

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    expect(mockSelectRuntimeType).toHaveBeenCalledWith(
      expect.objectContaining({
        boundDeviceId: 'personal-device',
        executionTarget: 'local',
        isWorkspaceAgent: false,
      }),
    );
    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(mockRemoveMessages).toHaveBeenCalledWith(['step-2'], CONTEXT);
    expect(mockChatDeleteMessage).not.toHaveBeenCalled();
    expect(mockExecuteGatewayAgent).not.toHaveBeenCalled();
    expect(mockExecuteHeterogeneousAgent).toHaveBeenCalledTimes(1);
    expect(executorParams().workingDirectory).toBe('/Users/me/project');
  });

  it('falls back through the gateway for a workspace shared-local target without an override', async () => {
    mockIsWorkspaceAgent = true;
    mockSharedExecutionTarget = 'local';
    const store = buildGroupStore([
      { content: 'looking', id: 'step-1', tools: [{ id: 'call-1' }] },
      { content: '', error: HETERO_RATE_LIMIT, id: 'step-2' },
    ]);

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    expect(mockSelectRuntimeType).toHaveBeenCalledWith(
      expect.objectContaining({
        boundDeviceId: 'workspace-device',
        executionTarget: 'local',
        isWorkspaceAgent: true,
      }),
    );
    expect(mockExecuteGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({ message: USER_MESSAGE.content }),
    );
    expect(mockExecuteHeterogeneousAgent).not.toHaveBeenCalled();
  });

  it('ignores a tail error that is not a heterogeneous-agent status error', async () => {
    const store = buildGroupStore([
      { content: 'looking', id: 'step-1', tools: [{ id: 'call-1' }] },
      { content: '', error: { body: { message: 'boom' }, type: 'PluginError' }, id: 'step-2' },
    ]);

    await act(async () => {
      await store.getState().continueHeteroAfterError('step-1');
    });

    expect(mockChatDeleteMessage).not.toHaveBeenCalled();
    expect(mockExecuteHeterogeneousAgent).not.toHaveBeenCalled();
  });
});
