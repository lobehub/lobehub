import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NativeUIDocument } from '../../native/types';
import { useNativeUIState } from './useNativeUIState';

const boundary = vi.hoisted(() => ({
  state: {} as any,
  update: vi.fn(),
  userId: 'user',
  dispatch: vi.fn(),
}));
vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: any) => unknown) => selector(boundary.state),
  useConversationStoreApi: () => ({ getState: () => boundary.state }),
}));
vi.mock('@/services/message', () => ({
  messageService: { updateMessagePluginState: boundary.update },
}));

vi.mock('@/store/chat', () => ({
  getChatStoreState: () => ({ internal_dispatchMessage: boundary.dispatch }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: Object.assign(
    (selector: (state: any) => unknown) => selector({ user: { id: boundary.userId } }),
    {
      getState: () => ({ user: { id: boundary.userId } }),
    },
  ),
}));

const document: NativeUIDocument = {
  body: [{ content: 'Comparison', id: 'intro', type: 'text' }],
  derived: {},
  fallback: 'Compare costs.',
  state: {
    n: { initial: 500, max: 1000, min: 10, step: 1, type: 'number' },
    plan: { initial: 'B', options: ['A', 'B', 'C'], type: 'string' },
  },
  title: 'Plans',
  version: 2,
};

beforeEach(() => {
  boundary.userId = crypto.randomUUID();
  boundary.dispatch.mockReset();
  boundary.update.mockReset().mockResolvedValue({ success: true });
  boundary.state = {
    composerTarget: { contextKey: 'main_agent_topic', writable: true },
    context: { agentId: 'agent', topicId: 'topic' },
    dbMessages: [
      {
        id: 'tool-1',
        plugin: { apiName: 'renderUI', identifier: 'lobe-interactive-ui' },
        role: 'tool',
      },
    ],
    internal_dispatchMessage: vi.fn(),
  };
});

describe('native UI host-owned state', () => {
  it('shares pending state and write order across a row remount', async () => {
    let finish!: (value: { success: boolean }) => void;
    boundary.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = renderHook(() => useNativeUIState(document, undefined, 'tool-1', false));
    act(() => {
      first.result.current.update('n', 600);
      first.result.current.update('n', 1000);
    });
    first.unmount();
    const next = renderHook(() =>
      useNativeUIState(document, { n: 500, plan: 'B' }, 'tool-1', false),
    );
    expect(next.result.current.values.n).toBe(1000);
    act(() => {
      next.result.current.update('n', 800);
      next.result.current.update('plan', 'C');
    });
    expect(boundary.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ success: true });
    });
    await waitFor(() => expect(next.result.current.saveStatus).toBe('saved'));
    expect(boundary.update.mock.calls.map((call) => call[1].values)).toEqual([
      { n: 600, plan: 'B' },
      { n: 800, plan: 'C' },
    ]);
    expect(next.result.current.values).toEqual({ n: 800, plan: 'C' });
  });

  it('does not continue a queued save under another signed-in account', async () => {
    let finish!: (value: { success: boolean }) => void;
    boundary.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useNativeUIState(document, undefined, 'tool-1', false));
    act(() => {
      result.current.update('n', 600);
      result.current.update('n', 1000);
    });
    boundary.userId = 'other-account';
    await act(async () => {
      finish({ success: true });
    });
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(boundary.update).toHaveBeenCalledTimes(1);
  });

  it('adopts fresh server hydration until a user edits, then preserves local ownership', async () => {
    const { result, rerender } = renderHook(
      ({ saved }) => useNativeUIState(document, saved, 'tool-1', false),
      { initialProps: { saved: { n: 500, plan: 'B' } } },
    );
    rerender({ saved: { n: 800, plan: 'C' } });
    expect(result.current.values).toEqual({ n: 800, plan: 'C' });
    act(() => result.current.update('n', 1000));
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    rerender({ saved: { n: 500, plan: 'B' } });
    expect(result.current.values).toEqual({ n: 1000, plan: 'C' });
  });

  it('restores validated saved selections without a write on mount', () => {
    const { result } = renderHook(() =>
      useNativeUIState(document, { n: 1000, plan: 'C', unexpected: 'ignored' }, 'tool-1', false),
    );
    expect(result.current.values).toEqual({ n: 1000, plan: 'C' });
    expect(boundary.update).not.toHaveBeenCalled();
  });

  it('updates locally immediately and saves only scalars to the original tool message', async () => {
    const { result } = renderHook(() => useNativeUIState(document, undefined, 'tool-1', false));
    act(() => result.current.update('n', 1000));
    expect(result.current.values).toEqual({ n: 1000, plan: 'B' });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(boundary.update).toHaveBeenCalledWith(
      'tool-1',
      { values: { n: 1000, plan: 'B' } },
      { agentId: 'agent', topicId: 'topic' },
    );
    expect(boundary.state.internal_dispatchMessage).toHaveBeenCalledWith({
      id: 'tool-1',
      key: 'values',
      type: 'updatePluginState',
      value: { n: 1000, plan: 'B' },
    });
  });

  it('rejects unknown fields, invalid values and no-op updates', () => {
    const { result } = renderHook(() => useNativeUIState(document, undefined, 'tool-1', false));
    act(() => {
      result.current.update('script', 'bad');
      result.current.update('n', Number.NaN);
      result.current.update('plan', 'unlisted');
      result.current.update('n', 500);
    });
    expect(boundary.update).not.toHaveBeenCalled();
    expect(result.current.values).toEqual({ n: 500, plan: 'B' });
  });

  it('rechecks read-only, destination and source identity on every change', () => {
    const { result, rerender } = renderHook(
      ({ readOnly }) => useNativeUIState(document, undefined, 'tool-1', readOnly),
      { initialProps: { readOnly: true } },
    );
    act(() => result.current.update('n', 1000));
    rerender({ readOnly: false });
    boundary.state.context.topicId = 'other';
    act(() => result.current.update('n', 1000));
    boundary.state.context.topicId = 'topic';
    boundary.state.dbMessages = [];
    act(() => result.current.update('n', 1000));
    expect(boundary.update).not.toHaveBeenCalled();
  });

  it('keeps unsaved edits visible, reports failure and retries only explicitly', async () => {
    boundary.update.mockResolvedValueOnce({ success: false });
    const { result } = renderHook(() => useNativeUIState(document, undefined, 'tool-1', false));
    act(() => result.current.update('n', 1000));
    await waitFor(() => expect(result.current.saveStatus).toBe('failed'));
    expect(result.current.values.n).toBe(1000);
    expect(boundary.state.internal_dispatchMessage).not.toHaveBeenCalled();
    expect(boundary.update).toHaveBeenCalledTimes(1);
    act(() => result.current.retrySave());
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
    expect(boundary.update).toHaveBeenCalledTimes(2);
  });

  it('does not publish a late response into a newly navigated conversation', async () => {
    let finish!: (value: { success: boolean }) => void;
    boundary.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useNativeUIState(document, undefined, 'tool-1', false));
    act(() => result.current.update('n', 1000));
    boundary.state.context = { agentId: 'other', topicId: 'other' };
    await act(async () => {
      finish({ success: true });
    });
    expect(boundary.state.internal_dispatchMessage).not.toHaveBeenCalled();
    expect(boundary.dispatch).toHaveBeenCalledWith(
      { id: 'tool-1', key: 'values', type: 'updatePluginState', value: { n: 1000, plan: 'B' } },
      { context: { agentId: 'agent', topicId: 'topic' } },
    );
    expect(boundary.update.mock.calls[0][2]).toEqual({ agentId: 'agent', topicId: 'topic' });
  });

  it('finishes the latest already-authorized queued edit after SPA navigation and unmount', async () => {
    let finish!: (value: { success: boolean }) => void;
    boundary.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, unmount } = renderHook(() =>
      useNativeUIState(document, undefined, 'tool-1', false),
    );
    act(() => {
      result.current.update('n', 600);
      result.current.update('n', 1000);
    });
    boundary.state.context = { agentId: 'other', topicId: 'other' };
    boundary.state.dbMessages = [];
    unmount();
    await act(async () => {
      finish({ success: true });
    });
    await waitFor(() => expect(boundary.update).toHaveBeenCalledTimes(2));
    expect(boundary.update.mock.calls[1]).toEqual([
      'tool-1',
      { values: { n: 1000, plan: 'B' } },
      { agentId: 'agent', topicId: 'topic' },
    ]);
    expect(boundary.state.internal_dispatchMessage).not.toHaveBeenCalled();
  });
});
