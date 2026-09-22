import { describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import * as agentStore from '@/store/agent';
import * as serverConfigStore from '@/store/serverConfig';
import { useUserStore } from '@/store/user';

import { readConversationMessages } from './conversationMessageRead';

const mockGatewayMode = ({
  gatewayMode,
  protocolV2 = true,
}: {
  gatewayMode: boolean;
  protocolV2?: boolean;
}) => {
  vi.spyOn(serverConfigStore, 'getServerConfigStoreState').mockReturnValue({
    featureFlags: { enableGatewayMux: protocolV2 },
    serverConfig: {
      ...(protocolV2 && { agentGatewayProtocol: 2 }),
      ...(gatewayMode && { agentGatewayUrl: 'https://gateway.test', enableGatewayMode: true }),
    },
  } as unknown as ReturnType<typeof serverConfigStore.getServerConfigStoreState>);
  vi.spyOn(agentStore, 'getAgentStoreState').mockReturnValue({
    activeAgentId: 'agent-1',
    agentMap: { 'agent-1': { chatConfig: {} } },
  } as unknown as ReturnType<typeof agentStore.getAgentStoreState>);
  useUserStore.setState({ settings: {} } as never);
};

describe('readConversationMessages', () => {
  it('asks for projected tool payloads when the run executes on the server', async () => {
    mockGatewayMode({ gatewayMode: true });
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);

    await readConversationMessages({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectToolPayloads: true,
      topicId: 'topic-1',
    });
  });

  it('keeps whole payloads outside the protocol-v2 rollout', async () => {
    mockGatewayMode({ gatewayMode: true, protocolV2: false });
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);

    await readConversationMessages({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ projectToolPayloads: false }),
    );
  });

  it('keeps whole payloads when the run can execute in the browser', async () => {
    // The browser assembles its LLM context from this very list, so a projected
    // tool result would silently disappear from the model's view.
    mockGatewayMode({ gatewayMode: false });
    const getMessages = vi.spyOn(messageService, 'getMessages').mockResolvedValue([]);

    await readConversationMessages({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(getMessages).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectToolPayloads: false,
      topicId: 'topic-1',
    });
  });
});
