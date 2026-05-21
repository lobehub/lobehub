/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import debug from 'debug';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AssistantTurnSettledWatcher from './AssistantTurnSettledWatcher';

const { mockState, mockChatState } = vi.hoisted(() => ({
  mockChatState: {
    operations: {} as Record<string, any>,
    operationsByMessage: {} as Record<string, string[]>,
  },
  mockState: {
    displayMessages: [] as Array<{ id: string; role: string }>,
    generatingIds: new Set<string>(),
    hooks: {} as Record<string, ((...args: any[]) => any) | undefined>,
    pendingInterventions: [] as Array<{ id: string }>,
  },
}));

vi.mock('./store', () => ({
  contextSelectors: {
    hook: (name: string) => (state: typeof mockState) => state.hooks[name],
  },
  conversationSelectors: {
    displayMessages: (state: typeof mockState) => state.displayMessages,
  },
  dataSelectors: {
    pendingInterventions: (state: typeof mockState) => state.pendingInterventions,
  },
  messageStateSelectors: {
    isAssistantGroupItemGenerating: (id: string) => (state: typeof mockState) =>
      state.generatingIds.has(id),
  },
  useConversationStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => mockChatState,
  },
}));

interface SeedOp {
  cancelReason?: string;
  endTime?: number;
  parentOperationId?: string;
  status: string;
  type: string;
}

const seedOperations = (messageId: string, ops: SeedOp[]) => {
  mockChatState.operations = {};
  mockChatState.operationsByMessage = {};
  const ids: string[] = [];
  ops.forEach((op, index) => {
    const id = `op-${messageId}-${index}`;
    ids.push(id);
    mockChatState.operations[id] = {
      id,
      parentOperationId: op.parentOperationId,
      status: op.status,
      type: op.type,
      metadata: {
        cancelReason: op.cancelReason,
        endTime: op.endTime ?? index + 1,
        startTime: 0,
      },
    };
  });
  mockChatState.operationsByMessage[messageId] = ids;
};

const armAndSettle = (
  rerender: (ui: React.ReactElement) => void,
  hook: ReturnType<typeof vi.fn>,
) => {
  mockState.hooks.onAssistantTurnSettled = hook;
  mockState.displayMessages = [
    { id: 'user-1', role: 'user' },
    { id: 'assistant-1', role: 'assistant' },
  ];
  mockState.generatingIds = new Set(['assistant-1']);
  rerender(<AssistantTurnSettledWatcher />);

  mockState.generatingIds = new Set();
  rerender(<AssistantTurnSettledWatcher />);
};

describe('AssistantTurnSettledWatcher', () => {
  beforeEach(() => {
    mockState.displayMessages = [];
    mockState.generatingIds = new Set();
    mockState.pendingInterventions = [];
    mockState.hooks = {};
    mockChatState.operations = {};
    mockChatState.operationsByMessage = {};
  });

  it('fires with reason "completed" when latest terminal op is sendMessage/completed', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [{ status: 'completed', type: 'sendMessage' }]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'completed' });
    });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('fires with reason "regenerated" when latest terminal op type is regenerate', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [{ status: 'completed', type: 'regenerate' }]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'regenerated' });
    });
  });

  it('fires with reason "continued" when latest terminal op type is continue', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [{ status: 'completed', type: 'continue' }]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'continued' });
    });
  });

  it('fires with reason "stopped" when latest terminal op is cancelled, even on regenerate', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [{ status: 'cancelled', type: 'regenerate' }]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'stopped' });
    });
  });

  it('derives "regenerated" when parent regenerate completes after child callLLM also completes (parent/child ordering)', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [
      { endTime: 1000, status: 'completed', type: 'regenerate' },
      {
        endTime: 1500,
        parentOperationId: 'op-assistant-1-0',
        status: 'completed',
        type: 'callLLM',
      },
    ]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'regenerated' });
    });
  });

  it('derives "continued" when parent continue completes after child callLLM also completes', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [
      { endTime: 1000, status: 'completed', type: 'continue' },
      {
        endTime: 1500,
        parentOperationId: 'op-assistant-1-0',
        status: 'completed',
        type: 'callLLM',
      },
    ]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'continued' });
    });
  });

  it('derives "stopped" when parent regenerate is cancelled with cancelled child callLLM finishing later', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [
      {
        cancelReason: 'User cancelled',
        endTime: 1000,
        status: 'cancelled',
        type: 'regenerate',
      },
      {
        endTime: 1500,
        parentOperationId: 'op-assistant-1-0',
        status: 'cancelled',
        type: 'callLLM',
      },
    ]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'stopped' });
    });
  });

  it('defers settlement while pending intervention exists, fires once it clears', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [{ status: 'completed', type: 'sendMessage' }]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);

    mockState.hooks.onAssistantTurnSettled = hook;
    mockState.displayMessages = [
      { id: 'user-1', role: 'user' },
      { id: 'assistant-1', role: 'assistant' },
    ];
    mockState.generatingIds = new Set(['assistant-1']);
    rerender(<AssistantTurnSettledWatcher />);

    mockState.generatingIds = new Set();
    mockState.pendingInterventions = [{ id: 'tool-1' }];
    rerender(<AssistantTurnSettledWatcher />);
    expect(hook).not.toHaveBeenCalled();

    mockState.pendingInterventions = [];
    rerender(<AssistantTurnSettledWatcher />);
    expect(hook).not.toHaveBeenCalled();

    mockState.generatingIds = new Set(['assistant-1']);
    rerender(<AssistantTurnSettledWatcher />);
    expect(hook).not.toHaveBeenCalled();

    mockState.generatingIds = new Set();
    rerender(<AssistantTurnSettledWatcher />);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'completed' });
    });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire for the same message id across rerenders', async () => {
    const hook = vi.fn();
    seedOperations('assistant-1', [{ status: 'completed', type: 'sendMessage' }]);

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledTimes(1);
    });

    rerender(<AssistantTurnSettledWatcher />);
    rerender(<AssistantTurnSettledWatcher />);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('falls back to reason "completed" and logs when no terminal op exists', async () => {
    const hook = vi.fn();
    const logSpy = vi.spyOn(debug, 'log').mockImplementation(() => {});
    debug.enable('lobe-render:features:Conversation');

    const { rerender } = render(<AssistantTurnSettledWatcher />);
    armAndSettle(rerender, hook);

    await waitFor(() => {
      expect(hook).toHaveBeenCalledWith('assistant-1', { reason: 'completed' });
    });
    expect(logSpy).toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('settlement fired without terminal op');

    logSpy.mockRestore();
    debug.disable();
  });
});
