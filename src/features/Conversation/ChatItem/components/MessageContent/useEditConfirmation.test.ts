import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, messageStateSelectors, Provider } from '@/features/Conversation/store';
import { agentSelectors } from '@/store/agent/selectors';

import { useEditConfirmation } from './useEditConfirmation';

/** @example The same editor routes historical Codex prompts to edit-and-resend. */
describe('message edit confirmation', () => {
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
    const save = vi.spyOn(store.getState(), 'updateMessageContent').mockResolvedValue();
    const resend = vi.spyOn(store.getState(), 'regenerateUserMessage').mockResolvedValue();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(Provider, { children, createStore: () => store });
    const hook = renderHook(
      () =>
        useEditConfirmation({
          id: 'u1',
          editing: true,
          canEdit: true,
          canCreate: true,
          onEditingChange: vi.fn(),
        }),
      { wrapper },
    );
    return { ...hook, resend, save };
  };

  /** @example Editing an older Codex user turn sends its replacement with editor attachments. */
  it('submits a historical Codex edit through the context-aware rerun path', async () => {
    const { result, resend, save } = setup();
    const editorData = { attachment: 'image-1' };
    /** @example Historical Codex messages show Send rather than save-only behavior. */
    expect(result.current.shouldSendOnConfirm).toBe(true);
    await act(() => result.current.onConfirm('edited', editorData));
    /** @example Persistence and rerun are owned by one operation, with the replacement data. */
    expect(resend).toHaveBeenCalledWith('u1', { content: 'edited', editorData });
    /** @example The editor cannot race a separate save against Codex execution. */
    expect(save).not.toHaveBeenCalled();
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
    await act(() => result.current.onConfirm('edited'));
    /** @example Busy state blocks the runtime call. */
    expect(resend).not.toHaveBeenCalled();
    /** @example Busy state also blocks a misleading save without a rerun. */
    expect(save).not.toHaveBeenCalled();
  });
});
