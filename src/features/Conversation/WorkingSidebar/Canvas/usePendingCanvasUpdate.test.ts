import { CanvasApiName, CanvasIdentifier } from '@lobechat/builtin-tool-canvas';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePendingCanvasUpdate } from './usePendingCanvasUpdate';

const state = { messages: [] as any[], running: false };

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/store/chat/slices/operation/selectors', () => ({
  operationSelectors: {
    isAgentRuntimeRunningByContext: () => (s: typeof state) => s.running,
  },
}));
vi.mock('@/store/chat/slices/message/selectors', () => ({
  dbMessageSelectors: { activeDbMessages: (s: typeof state) => s.messages },
}));

const streamingUpdate = [
  {
    id: 'msg_a',
    role: 'assistant',
    tools: [
      {
        apiName: CanvasApiName.updateCanvas,
        arguments: '{"canvasId":"cvs_1"',
        id: 'call_1',
        identifier: CanvasIdentifier,
      },
    ],
  },
];
const savedUpdate = [
  ...streamingUpdate,
  { content: 'Saved', id: 'msg_t', pluginState: {}, role: 'tool', tool_call_id: 'call_1' },
];

beforeEach(() => {
  state.messages = [];
  state.running = false;
});

describe('usePendingCanvasUpdate', () => {
  it('reports pending only while the run that edits this canvas is active', () => {
    state.messages = streamingUpdate;
    state.running = true;
    const { rerender, result } = renderHook(() => usePendingCanvasUpdate('cvs_1'));
    expect(result.current).toBe(true);

    state.running = false;
    rerender();
    expect(result.current).toBe(false);
  });

  it('stays pending while the approved call executes even when the run is not tracked as running', () => {
    state.messages = [
      ...streamingUpdate,
      {
        content: '',
        id: 'msg_t',
        pluginIntervention: { status: 'approved' },
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ];
    const { result } = renderHook(() => usePendingCanvasUpdate('cvs_1'));

    expect(result.current).toBe(true);
  });

  it('stays pending through the approval wait even when the run is paused', () => {
    state.messages = [
      ...streamingUpdate,
      {
        content: '',
        id: 'msg_t',
        pluginIntervention: { status: 'pending' },
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ];
    const { rerender, result } = renderHook(() => usePendingCanvasUpdate('cvs_1'));
    expect(result.current).toBe(true);

    state.messages = savedUpdate;
    state.running = true;
    rerender();
    expect(result.current).toBe(false);
  });
});
