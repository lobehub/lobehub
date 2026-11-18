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

  // T-14428: a refused call used to return nothing, and the run recorded
  // "no result returned" over the reason
  describe('a call that does not run', () => {
    const setup = () => {
      const optimisticUpdateToolMessage = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({
        dbMessagesMap: {
          [messageMapKey({ agentId: 'agt_1' })]: [
            { agentId: 'agt_1', id: messageId, role: 'tool' } as any,
          ],
        },
        messageOperationMap: {},
        messagesMap: { [messageMapKey({ agentId: 'agt_1' })]: [] },
        operations: {},
        optimisticUpdateToolMessage,
        replaceMessages: vi.fn(),
      });
      return optimisticUpdateToolMessage;
    };

    it('keeps the reason a server refused it as the result', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const refusal = Object.assign(
        new Error("Connector 'french-coach' connects through your own device"),
        { data: { code: 'BAD_REQUEST' } },
      );
      vi.spyOn(mcpService, 'invokeMcpToolCall').mockRejectedValue(refusal);
      const optimisticUpdateToolMessage = setup();

      const content = await useChatStore.getState().invokeMCPTypePlugin(messageId, payload);

      expect(content).toBe(
        "MCP tool linear/list failed: Connector 'french-coach' connects through your own device",
      );
      expect(optimisticUpdateToolMessage).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining({
          content,
          pluginError: {
            body: { code: 'BAD_REQUEST', toolCallId: payload.id },
            message: refusal.message,
            type: 'ToolExecutionError',
          },
        }),
        undefined,
      );
    });

    it('names the server when nothing here can run it', async () => {
      vi.spyOn(mcpService, 'invokeMcpToolCall').mockResolvedValue(undefined);
      setup();

      const content = await useChatStore.getState().invokeMCPTypePlugin(messageId, payload);

      expect(content).toBe(
        "MCP tool linear/list failed: No enabled MCP server named 'linear' can run this call",
      );
    });

    it('still returns nothing for a call the user stopped', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(mcpService, 'invokeMcpToolCall').mockRejectedValue(
        new Error('The user aborted a request.'),
      );
      const optimisticUpdateToolMessage = setup();

      await expect(
        useChatStore.getState().invokeMCPTypePlugin(messageId, payload),
      ).resolves.toBeUndefined();
      expect(optimisticUpdateToolMessage).not.toHaveBeenCalled();
    });
  });
});
