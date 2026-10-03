import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, messageStateSelectors, Provider } from '@/features/Conversation/store';
import { agentSelectors } from '@/store/agent/selectors';

import { useEditConfirmation } from './useEditConfirmation';

describe('Codex edit confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (provider: 'codex' | 'claude-code' = 'codex') => {
    vi.spyOn(agentSelectors, 'currentAgentHeterogeneousProviderType').mockReturnValue(provider);
    const store = createStore({
      context: { agentId: 'agent', topicId: 'topic', threadId: null },
      initialMessages: ['u1', 'u2'].map((id, index) => ({
        id,
        content: id,
        role: 'user',
        createdAt: index,
        updatedAt: index,
      })),
    });
    const fork = vi
      .spyOn(store.getState(), 'forkCodexMessage')
      .mockImplementation(async (_id, _edit, onBranchReady) => {
        onBranchReady?.();
      });
    const save = vi.spyOn(store.getState(), 'updateMessageContent').mockResolvedValue();
    const regenerate = vi.spyOn(store.getState(), 'regenerateUserMessage').mockResolvedValue();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(Provider, { children, createStore: () => store });
    const onEditingChange = vi.fn();
    const hook = renderHook(
      () =>
        useEditConfirmation({
          id: 'u1',
          editing: true,
          canEdit: true,
          canCreate: true,
          onEditingChange,
        }),
      { wrapper },
    );
    return { ...hook, fork, save, regenerate, onEditingChange };
  };

  it('resends an older prompt without overwriting the original', async () => {
    const { result, fork, save, regenerate } = setup();
    expect(result.current.shouldSendOnConfirm).toBe(true);
    const editorData = { attachment: 'original-attachment' };
    await act(() => result.current.onConfirm('edited', editorData));
    expect(fork).toHaveBeenCalledWith(
      'u1',
      { content: 'edited', editorData },
      expect.any(Function),
    );
    expect(save).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  // Closing before the fork and swallowing its rejection discarded the revised
  // draft when preflight or persistence failed. Rejecting keeps EditorModal open.
  /** @example A failed branch creation keeps the draft available for another attempt. */
  it('preserves the editor and propagates a failed resend', async () => {
    const { result, fork, save, onEditingChange } = setup();
    fork.mockRejectedValueOnce(new Error('create failed'));
    /** @example EditorModal receives the failure instead of a successful close signal. */
    await expect(result.current.onConfirm('revised draft')).rejects.toThrow('create failed');
    /** @example The original message and open editor remain unchanged. */
    expect(onEditingChange).not.toHaveBeenCalled();
    /** @example Editing never overwrites the source message. */
    expect(save).not.toHaveBeenCalled();
    await act(() => result.current.onConfirm('revised draft'));
    /** @example The editor closes once resending succeeds. */
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  // ROOT CAUSE:
  // Waiting for the whole native run kept EditorModal over the permission UI.
  // The user could not approve the child until manually cancelling the editor.
  // Close after the saved child is ready, while native execution remains pending.
  /** @example A running child can request approval without the editor covering it. */
  it('closes the saved editor before the child run finishes', async () => {
    const { result, fork, onEditingChange, save } = setup();
    let finish!: () => void;
    const pendingRun = new Promise<void>((resolve) => {
      finish = resolve;
    });
    fork.mockImplementation(async (_messageId, _edit, onBranchReady?: () => void) => {
      onBranchReady?.();
      await pendingRun;
    });
    let submission: Promise<void> | undefined;
    try {
      await act(async () => {
        submission = result.current.onConfirm('Needs approval');
      });
      /** @example The editor is dismissed while the native run is still unresolved. */
      expect(onEditingChange).toHaveBeenCalledWith(false);
      /** @example The source message remains unchanged. */
      expect(save).not.toHaveBeenCalled();
    } finally {
      finish();
      await act(async () => {
        await submission;
      });
    }
  });

  // ROOT CAUSE:
  // A busy refusal resolved like a save, so EditorModal discarded a draft without creating a child.
  /** @example Editing during another run preserves the draft and reports unavailability. */
  it('rejects a busy confirmation without closing or saving the editor', async () => {
    vi.spyOn(messageStateSelectors, 'isInputLoading').mockReturnValue(true);
    const { result, fork, save, onEditingChange } = setup();
    expect(result.current.shouldSendOnConfirm).toBe(true);
    await expect(result.current.onConfirm('Keep this revision')).rejects.toThrow();
    expect(onEditingChange).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
  });

  it('retains save-only behavior for older non-Codex messages', async () => {
    const { result, fork, save } = setup('claude-code');
    expect(result.current.shouldSendOnConfirm).toBe(false);
    await act(() => result.current.onConfirm('edited'));
    expect(save).toHaveBeenCalledWith('u1', 'edited', { editorData: undefined });
    expect(fork).not.toHaveBeenCalled();
  });
});
