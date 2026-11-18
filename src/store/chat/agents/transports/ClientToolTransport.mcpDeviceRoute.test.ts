import type { ToolRunContext } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useToolStore } from '@/store/tool';

import type { ClientMessageTransport } from './ClientMessageTransport';
import { ClientToolTransport } from './ClientToolTransport';

// T-14428, end to end on the client: a desktop conversation's call to a stdio
// connector goes from the run's tool transport through the chat store and the
// MCP service to the desktop's local MCP client (IPC), and a call that cannot
// run comes back with its reason instead of "no result returned".

const ipc = vi.hoisted(() => ({ callTool: vi.fn() }));
const trpc = vi.hoisted(() => ({ callTool: vi.fn(), getForEdit: vi.fn() }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isDesktop: true,
}));

vi.mock('@/store/serverConfig/store', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  // A cloud deployment: a device gateway is configured
  getServerConfigStoreState: () => ({
    featureFlags: { enableMcpApps: false },
    serverConfig: { deviceGatewayConfigured: true },
  }),
}));

vi.mock('@/store/electron', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'this-desktop' } }),
}));

vi.mock('@/libs/trpc/client', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  lambdaClient: {
    connector: {
      callTool: { mutate: trpc.callTool },
      getForEdit: { query: trpc.getForEdit },
    },
  },
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ mcp: { callTool: ipc.callTool } }),
}));

vi.mock('@/services/discover', () => ({
  discoverService: {
    reportPluginCall: vi.fn().mockResolvedValue(undefined),
    safeInjectMPToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: { updateMessageError: vi.fn(), updateToolMessage: vi.fn() },
}));

vi.mock('@/services/toolResultArchive', () => ({
  archiveToolResultViaServer: async ({ content }: { content: string }) => content,
}));

const AGENT_ID = 'agt_1';
const KEY = messageMapKey({ agentId: AGENT_ID });

const coach = {
  id: 'conn_coach',
  identifier: 'french-coach',
  isEnabled: true,
  mcpConnectionType: 'stdio',
  sourceType: 'custom',
  status: 'connected',
};
const coachDetail = {
  ...coach,
  mcpStdioConfig: { args: ['coach.js'], command: 'node', env: { LEVEL: 'b1' } },
  tools: [{ permission: 'auto', toolName: 'quiz' }],
};

const call: ChatToolPayload = {
  apiName: 'quiz',
  arguments: '{"topic":"verbs"}',
  id: 'call_1',
  identifier: 'french-coach',
  type: 'mcp',
};

const runCall = async () => {
  const optimisticUpdateToolMessage = vi.fn().mockResolvedValue(undefined);
  useChatStore.setState({
    dbMessagesMap: {
      [KEY]: [
        { agentId: AGENT_ID, id: 'assistant', role: 'assistant' } as any,
        { agentId: AGENT_ID, id: 'tool-message', parentId: 'assistant', role: 'tool' } as any,
      ],
    },
    messageOperationMap: {},
    optimisticUpdateToolMessage,
    replaceMessages: vi.fn(),
  });
  const { operationId } = useChatStore.getState().startOperation({
    context: { agentId: AGENT_ID, messageId: 'assistant' },
    type: 'execAgentRuntime',
  });

  const transport = new ClientToolTransport(
    () => useChatStore.getState(),
    KEY,
    operationId,
    {} as ClientMessageTransport,
  );
  const execution = await transport.run(call, {
    operationId,
    parentMessageId: 'tool-message',
    reuseExistingMessage: true,
    toolMessageId: 'tool-message',
    toolName: 'french-coach/quiz',
  } as unknown as ToolRunContext);

  return { execution, optimisticUpdateToolMessage };
};

beforeEach(() => {
  vi.clearAllMocks();
  trpc.getForEdit.mockResolvedValue(coachDetail);
  ipc.callTool.mockResolvedValue(
    superjson.serialize({
      content: 'Conjugate "aller" in the present tense',
      state: { content: [{ text: 'Conjugate "aller" in the present tense', type: 'text' }] },
      success: true,
    }),
  );
});

describe('a desktop conversation calling a stdio connector behind a device gateway', () => {
  it('runs an unbound connector on this desktop and records its result', async () => {
    useToolStore.setState({ connectors: [coach] as any });

    const { execution, optimisticUpdateToolMessage } = await runCall();

    // The device's local MCP client got the call, with the connector's fresh config
    expect(trpc.callTool).not.toHaveBeenCalled();
    expect(superjson.deserialize(ipc.callTool.mock.calls[0][0])).toMatchObject({
      args: { topic: 'verbs' },
      env: { LEVEL: 'b1' },
      params: { args: ['coach.js'], command: 'node', name: 'french-coach', type: 'stdio' },
      toolName: 'quiz',
    });
    expect(optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-message',
      expect.objectContaining({ content: 'Conjugate "aller" in the present tense' }),
      expect.objectContaining({ operationId: expect.any(String) }),
    );
    expect(execution.result.success).toBe(true);
    expect(execution.result.content).not.toContain('no result returned');
  });

  it("records the server's refusal for a connector bound to another device", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useToolStore.setState({
      connectors: [{ ...coach, metadata: { boundDeviceId: 'office-pc' } }] as any,
    });
    trpc.callTool.mockRejectedValue(
      Object.assign(new Error("Connector 'french-coach' runs on a device that is offline"), {
        data: { code: 'PRECONDITION_FAILED' },
      }),
    );

    const { execution, optimisticUpdateToolMessage } = await runCall();

    expect(ipc.callTool).not.toHaveBeenCalled();
    expect(optimisticUpdateToolMessage).toHaveBeenCalledWith(
      'tool-message',
      expect.objectContaining({
        content:
          "MCP tool french-coach/quiz failed: Connector 'french-coach' runs on a device that is offline",
        pluginError: expect.objectContaining({
          body: { code: 'PRECONDITION_FAILED', toolCallId: 'call_1' },
        }),
      }),
      expect.objectContaining({ operationId: expect.any(String) }),
    );
    // The run keeps the persisted reason rather than overwriting it
    expect(execution.resultPersisted).toBe(true);
    expect(execution.result.content).not.toContain('no result returned');
  });
});
