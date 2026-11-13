import type { ChatToolPayload } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mcpService } from '@/services/mcp';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useToolStore } from '@/store/tool';

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

// A result inside a topic is archived through a server call; keep it local.
vi.mock('@/services/toolResultArchive', () => ({
  archiveToolResultViaServer: vi.fn(async ({ content }: { content: string }) => content),
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

describe('invokeComposioTypePlugin', () => {
  // Regression: the client runtime ran a Composio call without naming its
  // conversation, so the server resolved only the workspace's shared
  // connections and a private agent's own Composio connection was unreachable.
  it("runs the call in the message's agent and topic", async () => {
    const callComposioTool = vi.fn().mockResolvedValue({
      data: { content: 'ok', state: {}, success: true },
      success: true,
    });
    vi.spyOn(useToolStore, 'getState').mockReturnValue({
      callComposioTool,
      composioServers: [{ identifier: 'gmail' }],
    } as any);
    const key = messageMapKey({ agentId: 'agt_private', topicId: 'tpc_direct' });
    useChatStore.setState({
      dbMessagesMap: {
        [key]: [
          { agentId: 'agt_private', id: messageId, role: 'tool', topicId: 'tpc_direct' } as any,
        ],
      },
      messageOperationMap: {},
      messagesMap: { [key]: [] },
      operations: {},
      optimisticUpdateToolMessage: vi.fn().mockResolvedValue(undefined),
      replaceMessages: vi.fn(),
    });

    await useChatStore.getState().invokeComposioTypePlugin(messageId, {
      ...payload,
      apiName: 'GMAIL_SEND_EMAIL',
      identifier: 'gmail',
    });

    expect(callComposioTool).toHaveBeenCalledWith({
      agentId: 'agt_private',
      identifier: 'gmail',
      toolArgs: {},
      toolSlug: 'GMAIL_SEND_EMAIL',
      topicId: 'tpc_direct',
    });
  });
});
