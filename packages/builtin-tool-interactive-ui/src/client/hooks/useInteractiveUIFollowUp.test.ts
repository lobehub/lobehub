import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInteractiveUIFollowUp } from './useInteractiveUIFollowUp';

const boundary = vi.hoisted(() => ({ state: {} as any }));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: any) => unknown) => selector(boundary.state),
  useConversationStoreApi: () => ({ getState: () => boundary.state }),
}));

const source = {
  id: 'tool-1',
  plugin: { apiName: 'renderUI', identifier: 'lobe-interactive-ui' },
  role: 'tool',
};

beforeEach(() => {
  boundary.state = {
    composerTarget: { contextKey: 'main_agent_topic', writable: true },
    context: { agentId: 'agent', topicId: 'topic' },
    dbMessages: [source],
    operationState: { isInputLoading: false },
    sendMessage: vi.fn().mockImplementation(async (params) => params.onMessageAccepted()),
  };
});

describe('host-confirmed interactive UI follow-up', () => {
  it('does not send on mount or on an untrusted click', async () => {
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    expect(boundary.state.sendMessage).not.toHaveBeenCalled();
    await act(() => result.current.submit('r1', 'plan B', false));
    expect(boundary.state.sendMessage).not.toHaveBeenCalled();
  });

  it('uses the host conversation and preserves the existing composer draft', async () => {
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    await act(() => result.current.submit('r1', 'quantity 500, plan B, cost 50', true));
    expect(boundary.state.sendMessage).toHaveBeenCalledOnce();
    expect(boundary.state.sendMessage.mock.calls[0][0]).toMatchObject({
      conversationContext: { agentId: 'agent', topicId: 'topic' },
      message:
        '[Interactive UI: Plans; source tool message: tool-1]\nquantity 500, plan B, cost 50',
      preserveComposer: true,
    });
    expect(result.current.status).toBe('sent');
  });

  it('does not claim a silently failed send was accepted', async () => {
    boundary.state.sendMessage.mockResolvedValue(undefined);
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    await act(() => result.current.submit('r1', 'plan B', true));
    expect(result.current.status).toBe('uncertain');
  });

  it('keeps acceptance when the assistant run later fails', async () => {
    boundary.state.sendMessage.mockImplementation(async (params: any) => {
      params.onMessageAccepted();
      throw new Error('assistant run failed');
    });
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    await act(() => result.current.submit('r1', 'plan B', true));
    expect(result.current.status).toBe('sent');
  });

  it('keeps a sent proposal until the send settles, then resets for the next proposal', async () => {
    let finish!: () => void;
    boundary.state.sendMessage.mockImplementation((params: any) => {
      params.onMessageAccepted();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    let first!: Promise<void>;
    act(() => {
      first = result.current.submit('r1', 'plan B', true);
    });
    expect(result.current.status).toBe('sent');
    expect(result.current.pending).toBe(true);
    expect(result.current.dismiss()).toBe(false);
    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.pending).toBe(false);
    act(() => {
      expect(result.current.dismiss()).toBe(true);
    });
    expect(result.current.status).toBe('idle');
  });

  it('rechecks navigation and source ownership at click time', async () => {
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    boundary.state.context = { agentId: 'agent', topicId: 'other-topic' };
    await act(() => result.current.submit('r1', 'plan B', true));
    expect(boundary.state.sendMessage).not.toHaveBeenCalled();
    boundary.state.context = { agentId: 'agent', topicId: 'topic' };
    boundary.state.dbMessages = [];
    await act(() => result.current.submit('r1', 'plan B', true));
    expect(boundary.state.sendMessage).not.toHaveBeenCalled();
  });

  it('blocks duplicate in-flight clicks and never replays an uncertain request', async () => {
    let reject!: (error: Error) => void;
    boundary.state.sendMessage.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    let first!: Promise<void>;
    act(() => {
      first = result.current.submit('r1', 'plan B', true);
    });
    await act(() => result.current.submit('r1', 'plan B', true));
    await act(async () => {
      reject(new Error('network uncertain'));
      await first;
    });
    expect(result.current.status).toBe('uncertain');
    await act(() => result.current.submit('r1', 'plan B', true));
    expect(boundary.state.sendMessage).toHaveBeenCalledOnce();
  });

  it('does not claim a preflight-denied send succeeded', async () => {
    boundary.state.sendMessage.mockImplementation(async (params: any) =>
      params.onPreflightFailure(),
    );
    const { result } = renderHook(() => useInteractiveUIFollowUp('tool-1', 'Plans', false));
    await act(() => result.current.submit('r1', 'plan B', true));
    expect(result.current.status).toBe('uncertain');
  });

  it('rejects read-only, busy, empty and oversized submissions', async () => {
    const { result, rerender } = renderHook(
      ({ readOnly }) => useInteractiveUIFollowUp('tool-1', 'Plans', readOnly),
      { initialProps: { readOnly: true } },
    );
    await act(() => result.current.submit('r1', 'plan B', true));
    rerender({ readOnly: false });
    boundary.state.operationState.isInputLoading = true;
    await act(() => result.current.submit('r1', 'plan B', true));
    boundary.state.operationState.isInputLoading = false;
    await act(() => result.current.submit('r1', ' ', true));
    await act(() => result.current.submit('r1', 'x'.repeat(2_001), true));
    expect(boundary.state.sendMessage).not.toHaveBeenCalled();
  });
});
