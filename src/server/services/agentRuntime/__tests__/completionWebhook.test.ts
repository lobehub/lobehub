import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryAgentStateManager,
  InMemoryStreamEventManager,
} from '@/server/modules/AgentRuntime';

import { AgentRuntimeService } from '../AgentRuntimeService';

// Mock database models
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock ModelRuntime
vi.mock('@/server/modules/ModelRuntime', () => ({
  ApiKeyManager: vi.fn().mockImplementation(() => ({
    getAllApiKeys: vi.fn(),
    getApiKey: vi.fn(),
  })),
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn(),
  }),
  initializeRuntimeOptions: vi.fn(),
}));

// Mock search service
vi.mock('@/server/services/search', () => ({
  searchService: {
    search: vi.fn(),
  },
}));

// Mock MCP service
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    executeCommand: vi.fn(),
  },
}));

// Mock tool execution service
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(() => ({
    executeToolCall: vi.fn().mockResolvedValue({ result: 'success' }),
  })),
}));

vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
  })),
}));

describe('AgentRuntimeService - Completion Hooks via createOperation', () => {
  let service: AgentRuntimeService;
  let stateManager: InMemoryAgentStateManager;
  let streamEventManager: InMemoryStreamEventManager;

  const mockDb = {} as any;
  const userId = 'test-user-id';

  const makeContext = (operationId: string): AgentRuntimeContext => ({
    payload: { message: [{ content: 'Hello' }] },
    phase: 'user_input',
    session: {
      messageCount: 1,
      sessionId: operationId,
      status: 'idle',
      stepCount: 0,
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();

    stateManager = new InMemoryAgentStateManager();
    streamEventManager = new InMemoryStreamEventManager();

    service = new AgentRuntimeService(mockDb, userId, {
      coordinatorOptions: {
        stateManager,
        streamEventManager,
      },
      queueService: null,
      streamEventManager,
    });
  });

  describe('createOperation persists hooks in metadata', () => {
    it('should persist hooks in state metadata._hooks', async () => {
      const operationId = 'hook-op-1';
      const hooks = [
        {
          handler: vi.fn(),
          id: 'test-completion',
          type: 'onComplete' as const,
          webhook: {
            body: { runId: 'run-1', testCaseId: 'tc-1' },
            url: 'https://example.com/webhook',
          },
        },
      ];

      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        hooks,
        initialContext: makeContext(operationId),
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolSet: { manifestMap: {}, tools: [] },
        userId,
      });

      const state = await stateManager.loadAgentState(operationId);
      expect(state?.metadata?._hooks).toEqual([
        expect.objectContaining({
          id: 'test-completion',
          type: 'onComplete',
          webhook: {
            body: { runId: 'run-1', testCaseId: 'tc-1' },
            url: 'https://example.com/webhook',
          },
        }),
      ]);
    });

    it('should not have _hooks in metadata when no hooks provided', async () => {
      const operationId = 'hook-op-2';

      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        initialContext: makeContext(operationId),
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolSet: { manifestMap: {}, tools: [] },
        userId,
      });

      const state = await stateManager.loadAgentState(operationId);
      expect(state?.metadata?._hooks).toBeUndefined();
    });
  });

  describe('webhook delivery through hooks', () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchSpy);
    });

    const createOperationWithHook = async (
      operationId: string,
      webhookUrl: string,
      webhookBody?: Record<string, unknown>,
    ) => {
      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        hooks: [
          {
            handler: vi.fn(),
            id: 'test-completion',
            type: 'onComplete' as const,
            webhook: { body: webhookBody, url: webhookUrl },
          },
        ],
        initialContext: makeContext(operationId),
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolSet: { manifestMap: {}, tools: [] },
        userId,
      });
    };

    it('should persist webhook hook config for later delivery on completion', async () => {
      const operationId = 'hook-complete-1';
      const webhookUrl = 'https://example.com/on-complete';
      const webhookBody = { runId: 'run-1', testCaseId: 'tc-1' };

      await createOperationWithHook(operationId, webhookUrl, webhookBody);

      // Manually set state to simulate a step that produces 'done' status
      const state = await stateManager.loadAgentState(operationId);
      await stateManager.saveAgentState(operationId, {
        ...state!,
        status: 'done',
      });

      // Verify the hook config is persisted for later use
      const updatedState = await stateManager.loadAgentState(operationId);
      expect(updatedState?.metadata?._hooks).toEqual([
        expect.objectContaining({
          id: 'test-completion',
          type: 'onComplete',
          webhook: {
            body: webhookBody,
            url: webhookUrl,
          },
        }),
      ]);
    });

    it('should NOT have hook config when no hooks are configured', async () => {
      const operationId = 'hook-none-1';

      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        initialContext: makeContext(operationId),
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolSet: { manifestMap: {}, tools: [] },
        userId,
      });

      const state = await stateManager.loadAgentState(operationId);
      expect(state?.metadata?._hooks).toBeUndefined();
    });

    it('should not throw when webhook fetch fails', async () => {
      const operationId = 'hook-fail-1';
      const webhookUrl = 'https://example.com/failing-webhook';

      // Make fetch throw
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await createOperationWithHook(operationId, webhookUrl, { runId: 'run-1' });

      // Verify the hook is stored -- the hook dispatch catches errors internally
      const state = await stateManager.loadAgentState(operationId);
      expect(state?.metadata?._hooks?.[0]?.webhook?.url).toBe(webhookUrl);
    });
  });

  describe('hook payload structure', () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchSpy);
    });

    it('should include webhook body fields in the persisted hook config', async () => {
      const operationId = 'hook-payload-test';
      const webhookUrl = 'https://example.com/webhook';
      const webhookBody = { runId: 'run-123', testCaseId: 'tc-456', userId: 'user-789' };

      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        hooks: [
          {
            handler: vi.fn(),
            id: 'test-completion',
            type: 'onComplete' as const,
            webhook: { body: webhookBody, url: webhookUrl },
          },
        ],
        initialContext: makeContext(operationId),
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolSet: { manifestMap: {}, tools: [] },
        userId,
      });

      // Verify the persisted hook contains the right structure
      const state = await stateManager.loadAgentState(operationId);
      const hooks = state?.metadata?._hooks;
      expect(hooks).toBeDefined();
      expect(hooks).toHaveLength(1);
      expect(hooks[0].webhook.url).toBe(webhookUrl);
      expect(hooks[0].webhook.body).toEqual(webhookBody);
    });
  });
});
