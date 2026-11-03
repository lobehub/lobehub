import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat';

import { useProjectDraftStaging } from './useProjectDraftStaging';

const ids = new Set(['pwd_mac', 'pwd_linux']);
const paneA = { agentId: 'agt_a', projectWorkingDirectoryId: 'pwd_mac' };
const paneB = { agentId: 'agt_b', projectWorkingDirectoryId: 'pwd_linux' };

const pending = () => useChatStore.getState().pendingNewTopicDirectory;

describe('useProjectDraftStaging', () => {
  beforeEach(() => {
    act(() => useChatStore.getState().setPendingNewTopicDirectory());
  });

  it("stages the pane's draft when it mounts", () => {
    renderHook(() => useProjectDraftStaging(paneA, ids));

    expect(pending()).toEqual(paneA);
  });

  /** @example Review: a draft opened in a second split pane overwrote the first pane's staging. */
  it('restages its own draft when the user returns to the pane', () => {
    const a = renderHook(() => useProjectDraftStaging(paneA, ids));
    renderHook(() => useProjectDraftStaging(paneB, ids));
    expect(pending()).toEqual(paneB);

    act(() => a.result.current());

    expect(pending()).toEqual(paneA);
  });

  it('follows a device switch in its own composer instead of reverting it', () => {
    const a = renderHook(() => useProjectDraftStaging(paneA, ids));
    const switched = { agentId: 'agt_a', projectWorkingDirectoryId: 'pwd_linux' };

    act(() => useChatStore.getState().setPendingNewTopicDirectory(switched));
    act(() => a.result.current());

    expect(pending()).toEqual(switched);
  });

  it('stages nothing without a draft', () => {
    const { result } = renderHook(() => useProjectDraftStaging(undefined, ids));
    act(() => result.current());

    expect(pending()).toBeUndefined();
  });
});
