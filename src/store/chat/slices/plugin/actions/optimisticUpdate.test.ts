import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';

import { messagesReducer } from '../../message/reducer';
import { PluginOptimisticUpdateActionImpl } from './optimisticUpdate';

vi.mock('@/services/message', () => ({
  messageService: { batchMutateOrThrow: vi.fn().mockResolvedValue(undefined) },
}));

describe('optimistic tool failure', () => {
  it('updates the renderer error field before persistence resolves', async () => {
    let messages = [{ id: 'tool-1', role: 'tool', content: '' }] as UIChatMessage[];
    let complete!: () => void;
    vi.mocked(messageService.batchMutateOrThrow).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }) as never,
    );
    const action = new PluginOptimisticUpdateActionImpl(
      vi.fn(),
      () =>
        ({
          internal_dispatchMessage: (payload: Parameters<typeof messagesReducer>[1]) => {
            messages = messagesReducer(messages, payload);
          },
        }) as never,
    );
    const error = { message: 'Additional input is unsupported', type: 'ToolCallError' };
    const pending = action.optimisticUpdateToolMessage('tool-1', {
      content: error.message,
      pluginError: error,
    });
    try {
      expect(messages[0].pluginError).toEqual(error);
      expect(messages[0].plugin).toBeUndefined();
    } finally {
      complete();
      await pending;
    }
  });
});
