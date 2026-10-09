import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, messageStateSelectors, Provider } from '@/features/Conversation/store';
import { useCanEditCodexMessage } from '@/hooks/useCanEditCodexMessage';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';

import { useEditConfirmation } from './useEditConfirmation';

vi.mock('@/hooks/useCanEditCodexMessage', () => ({ useCanEditCodexMessage: vi.fn(() => true) }));

/** @example The same editor routes historical Codex prompts to edit-and-resend. */
describe('message edit confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (
    provider: 'codex' | 'claude-code' = 'codex',
    canEditCodex = true,
    globalProvider = provider,
  ) => {
    vi.mocked(useCanEditCodexMessage).mockReturnValue(canEditCodex);
    vi.spyOn(agentSelectors, 'currentAgentHeterogeneousProviderType').mockReturnValue(
      globalProvider,
    );
    vi.spyOn(agentByIdSelectors, 'getAgencyConfigById').mockImplementation(
      (id) => () => (id === 'agent' ? { heterogeneousProvider: { type: provider } } : undefined),
    );
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
    const save = vi.spyOn(store.getState(), 'updateMessageContent').mockResolvedValue();
    const resend = vi.spyOn(store.getState(), 'regenerateUserMessage').mockResolvedValue();
    const close = vi.fn();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(Provider, { children, createStore: () => store });
    const hook = renderHook(
      () =>
        useEditConfirmation({
          id: 'u1',
          editing: true,
          canEdit: true,
          canCreate: true,
          onEditingChange: close,
        }),
      { wrapper },
    );
    return { ...hook, close, resend, save };
  };

  /** @example Editing an older Codex user turn sends its replacement with editor attachments. */
  it('submits a historical Codex edit through the context-aware rerun path', async () => {
    const { result, resend, save } = setup();
    const editorData = { attachment: 'image-1' };
    /** @example Historical Codex messages show Send rather than save-only behavior. */
    expect(result.current.shouldSendOnConfirm).toBe(true);
    await act(() => result.current.onConfirm('edited', editorData));
    /** @example Persistence and rerun are owned by one operation, with the replacement data. */
    expect(resend).toHaveBeenCalledWith('u1', {
      content: 'edited',
      editorData,
      onAccepted: expect.any(Function),
    });
    /** @example The editor cannot race a separate save against Codex execution. */
    expect(save).not.toHaveBeenCalled();
  });

  /** @example An isolated editor follows its own agent when global selection differs. */
  it('routes the conversation Codex agent to resend when the global agent is ordinary', async () => {
    // ROOT CAUSE:
    // The confirmation used global agent selection although the provider owns a
    // captured agent id. Selecting another agent could classify this row as a save.
    const { result, resend, save } = setup('codex', true, 'claude-code');
    await act(() => result.current.onConfirm('isolated edit'));
    /** @example The source row is preserved and replacement creation owns persistence. */
    expect(save).not.toHaveBeenCalled();
    /** @example Dispatch uses the editor's conversation ownership. */
    expect(resend).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ content: 'isolated edit' }),
    );
  });

  /** @example An ordinary conversation stays save-only regardless of global Codex selection. */
  it('keeps an ordinary conversation editable when the global agent is Codex', async () => {
    const { result, resend, save } = setup('claude-code', false, 'codex');
    await act(() => result.current.onConfirm('ordinary edit'));
    /** @example The ordinary historical row keeps its existing save behavior. */
    expect(save).toHaveBeenCalledWith('u1', 'ordinary edit', { editorData: undefined });
    /** @example A different global provider cannot redirect the row into Codex. */
    expect(resend).not.toHaveBeenCalled();
  });

  /** @example A failed save leaves the same edit draft open for correction and retry. */
  it('preserves the editor when submitting a Codex edit fails', async () => {
    // ROOT CAUSE:
    //
    // Closing editing state before the save resolved destroyed the modal and draft.
    // Dismissal belongs after persistence accepts the replacement, not before it.
    const { result, resend, close } = setup();
    resend.mockRejectedValueOnce(new Error('save unavailable'));
    /** @example The caller sees the real failure. */
    await expect(result.current.onConfirm('UNSAVED-DRAFT')).rejects.toThrow('save unavailable');
    /** @example No close callback discards the unsaved draft. */
    expect(close).not.toHaveBeenCalled();
  });

  /** @example Other heterogeneous agents keep their existing save-only historical edit behavior. */
  it('preserves ordinary historical message editing', async () => {
    const { result, resend, save } = setup('claude-code');
    /** @example A non-Codex historical message continues to offer Save. */
    expect(result.current.shouldSendOnConfirm).toBe(false);
    await act(() => result.current.onConfirm('edited'));
    /** @example The existing editor save contract remains intact. */
    expect(save).toHaveBeenCalledWith('u1', 'edited', { editorData: undefined });
    /** @example Historical saves do not acquire new regenerate behavior on other runtimes. */
    expect(resend).not.toHaveBeenCalled();
  });

  /** @example A running Codex conversation cannot be changed underneath its native session. */
  it('does not save or resend a Codex edit while input is loading', async () => {
    vi.spyOn(messageStateSelectors, 'isInputLoading').mockReturnValue(true);
    const { result, resend, save } = setup();
    /** @example Rejecting keeps the shared editor modal open. */
    await expect(result.current.onConfirm('edited')).rejects.toThrow(
      'messageAction.codexEdit.cannotSubmit',
    );
    /** @example Busy state blocks the runtime call. */
    expect(resend).not.toHaveBeenCalled();
    /** @example Busy state also blocks a misleading save without a rerun. */
    expect(save).not.toHaveBeenCalled();
  });
});
