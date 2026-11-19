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

  // Left behind, the draft outlived its pane: the agent's next blank
  // conversation anywhere sent into this project and offered its environment.
  it('withdraws its draft when the pane leaves it', () => {
    const projectDraft = { agentId: 'agt_a', projectId: 'prj_1' };
    const pane = renderHook(({ draft }) => useProjectDraftStaging(draft, ids), {
      initialProps: { draft: projectDraft as typeof projectDraft | undefined },
    });
    expect(pending()).toEqual(projectDraft);

    pane.rerender({ draft: undefined });
    expect(pending()).toBeUndefined();

    pane.rerender({ draft: projectDraft });
    pane.unmount();
    expect(pending()).toBeUndefined();
  });

  /** @example Review: closing one of two split panes on the same draft cleared the other's staging. */
  it('keeps a draft staged while another live pane holds the same one', () => {
    const projectDraft = { agentId: 'agt_a', projectId: 'prj_1' };
    const first = renderHook(() => useProjectDraftStaging({ ...projectDraft }, ids));
    const second = renderHook(() => useProjectDraftStaging({ ...projectDraft }, ids));

    first.unmount();
    expect(pending()).toEqual(projectDraft);

    second.unmount();
    expect(pending()).toBeUndefined();
  });

  it("leaves another pane's staged draft alone", () => {
    const a = renderHook(() => useProjectDraftStaging(paneA, ids));
    renderHook(() => useProjectDraftStaging(paneB, ids));

    a.unmount();

    expect(pending()).toEqual(paneB);
  });

  it('stages nothing without a draft', () => {
    const { result } = renderHook(() => useProjectDraftStaging(undefined, ids));
    act(() => result.current());

    expect(pending()).toBeUndefined();
  });
});
