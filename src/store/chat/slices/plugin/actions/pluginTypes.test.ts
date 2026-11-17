import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from '@/services/mcp';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    getFromLocalStorageSync(): State {
      return {} as State;
    }

    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});

vi.mock('@/services/message', () => ({
  messageService: { updateMessageError: vi.fn(), updateToolMessage: vi.fn() },
}));

const messageId = 'message-id';
const payload = {
  apiName: 'list',
  arguments: '{}',
  id: 'tool-call-1',
  identifier: 'linear',
  type: 'mcp',
} as ChatToolPayload;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('invokeMCPTypePlugin', () => {
  it("resolves connectors for the message's agent, like the agent's runs do", async () => {
    const invoke = vi
      .spyOn(mcpService, 'invokeMcpToolCall')
      .mockResolvedValue({ content: 'ok', state: { content: [] }, success: true } as any);
    useChatStore.setState({
      dbMessagesMap: {
        [messageMapKey({ agentId: 'agt_1' })]: [
          // No topic: the oversized-result archive (a server call) stays out of it
          { agentId: 'agt_1', id: messageId, role: 'tool' } as any,
        ],
      },
      messageOperationMap: {},
      messagesMap: { [messageMapKey({ agentId: 'agt_1' })]: [] },
      operations: {},
      optimisticUpdateToolMessage: vi.fn().mockResolvedValue(undefined),
      replaceMessages: vi.fn(),
    });

    await useChatStore.getState().invokeMCPTypePlugin(messageId, payload);

    // A connector linked to an agent serves only that agent
    expect(invoke).toHaveBeenCalledWith(payload, expect.objectContaining({ agentId: 'agt_1' }));
  });
});
