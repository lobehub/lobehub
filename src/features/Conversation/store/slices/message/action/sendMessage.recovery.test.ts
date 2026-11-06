import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import type { Store } from '../../../action';
import { sendMessage } from './sendMessage';

afterEach(() => vi.restoreAllMocks());

describe('provider send recovery ownership', () => {
  it.each(['block', 'throw'])('recovers a hook refusal: %s', async (mode) => {
    const recover = vi.fn();
    const forward = vi.spyOn(useChatStore.getState(), 'sendMessage').mockResolvedValue(undefined);
    const state = {
      context: { agentId: 'agent', topicId: 'a' },
      editor: null,
      hooks: {
        onBeforeSendMessage: async () => {
          if (mode === 'throw') throw new Error('refused');
          return false;
        },
      },
    } as unknown as Store;
    await sendMessage(
      vi.fn(),
      () => state,
    )({
      message: 'test',
      onBeforeSendFailure: recover,
    }).catch(() => {});
    expect(recover).toHaveBeenCalledOnce();
    expect(forward).not.toHaveBeenCalled();
  });

  it('captures the document before preflight and checks the live provider context', async () => {
    let document = { text: '' };
    let resume!: () => void;
    const editor = { getJSONState: () => document };
    const state = {
      context: { agentId: 'agent', topicId: 'a' },
      displayMessages: [],
      editor,
      hooks: {
        onBeforeSendMessage: () =>
          new Promise<void>((resolve) => {
            resume = resolve;
          }),
      },
    } as unknown as Store;
    const forward = vi.spyOn(useChatStore.getState(), 'sendMessage').mockResolvedValue(undefined);
    const sending = sendMessage(vi.fn(), () => state)({ message: 'test' });
    document = { text: 'new draft' };
    resume();
    await sending;
    const params = forward.mock.calls[0][0];
    expect(params.inputEditorSnapshot).toEqual({ json: JSON.stringify({ text: '' }) });
    expect(params.isInputEditorCurrent?.()).toBe(true);
    state.context = { agentId: 'agent', topicId: 'b' };
    expect(params.isInputEditorCurrent?.()).toBe(false);
  });
});
