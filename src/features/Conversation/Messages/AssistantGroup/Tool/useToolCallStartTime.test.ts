/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConversationStore from '../../../store';
import type { State } from '../../../store/initialState';
import { useToolCallStartTime } from './useToolCallStartTime';

let runningToolCallStartTime: number | undefined;
let conversationState: State;

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/slices/operation/selectors', () => ({
  operationSelectors: {
    getRunningToolCallStartTime: () => () => runningToolCallStartTime,
  },
}));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof ConversationStore>();
  return {
    ...actual,
    useConversationStore: (selector: (s: State) => unknown) => selector(conversationState),
  };
});

const stateWithToolRow = (createdAt: Date | number | string | undefined): State =>
  ({
    dbMessages:
      createdAt === undefined
        ? []
        : [{ createdAt, id: 'tool-msg-1', role: 'tool', tool_call_id: 'call-1' }],
  }) as unknown as State;

describe('useToolCallStartTime', () => {
  beforeEach(() => {
    runningToolCallStartTime = undefined;
    conversationState = stateWithToolRow(undefined);
  });

  it('prefers the running operation start time over the tool row', () => {
    runningToolCallStartTime = 1000;
    conversationState = stateWithToolRow(2000);

    const { result } = renderHook(() => useToolCallStartTime('call-1'));

    expect(result.current).toBe(1000);
  });

  it('falls back to the tool message createdAt when no operation exists', () => {
    // Heterogeneous agents (Claude Code / Codex) never create a per-tool-call
    // operation, so without this fallback the timer restarts from mount time.
    conversationState = stateWithToolRow(2000);

    const { result } = renderHook(() => useToolCallStartTime('call-1'));

    expect(result.current).toBe(2000);
  });

  it('normalizes a rehydrated Date createdAt to epoch ms', () => {
    conversationState = stateWithToolRow(new Date(2000));

    const { result } = renderHook(() => useToolCallStartTime('call-1'));

    expect(result.current).toBe(2000);
  });

  it('ignores an unparsable createdAt', () => {
    conversationState = stateWithToolRow('not-a-date');

    const { result } = renderHook(() => useToolCallStartTime('call-1'));

    expect(result.current).toBeUndefined();
  });

  it('returns undefined while the tool row is not loaded yet', () => {
    const { result } = renderHook(() => useToolCallStartTime('call-1'));

    expect(result.current).toBeUndefined();
  });
});
