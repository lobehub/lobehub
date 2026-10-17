import { describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import * as serverConfigStore from '@/store/serverConfig';

import {
  readConversationMessageListPage,
  readConversationMessages,
} from './conversationMessageRead';

const mockServerConfig = ({
  gatewayMode = true,
  protocolV2 = true,
}: {
  gatewayMode?: boolean;
  protocolV2?: boolean;
}) => {
  vi.spyOn(serverConfigStore, 'getServerConfigStoreState').mockReturnValue({
    featureFlags: { enableGatewayMux: protocolV2 },
    serverConfig: {
      ...(protocolV2 && { agentGatewayProtocol: 2 }),
      ...(gatewayMode && { agentGatewayUrl: 'https://gateway.test', enableGatewayMode: true }),
    },
  } as unknown as ReturnType<typeof serverConfigStore.getServerConfigStoreState>);
};

describe('readConversationMessages', () => {
  it('asks for projected tool payloads inside the protocol-v2 rollout', async () => {
    mockServerConfig({});
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);

    await readConversationMessages({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectToolPayloads: true,
      topicId: 'topic-1',
    });
  });

  it('keeps whole payloads outside the protocol-v2 rollout', async () => {
    mockServerConfig({ protocolV2: false });
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);

    await readConversationMessages({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ projectToolPayloads: false }),
    );
  });

  it('gates projection on protocol v2 alone, not on gateway mode', async () => {
    // There is no browser runtime that assembles an LLM context from this
    // list any more, so gateway mode no longer holds the projection back.
    mockServerConfig({ gatewayMode: false });
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);

    await readConversationMessages({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectToolPayloads: true,
      topicId: 'topic-1',
    });
  });
});

describe('readConversationMessageListPage', () => {
  it('applies the same projection gate to the paged list read', async () => {
    mockServerConfig({});
    const getPage = vi.spyOn(messageService, 'getMessageListPage').mockResolvedValue([]);

    await readConversationMessageListPage({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getPage).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectToolPayloads: true,
      topicId: 'topic-1',
    });
  });
});
