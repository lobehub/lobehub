// @vitest-environment node
/**
 * Integration test: hooks e2e chain
 *
 * Verifies the full data flow from AgentRuntimeService.executeStep
 * through HookDispatcher to hook handlers — with enriched step
 * presentation data that bot consumers depend on.
 *
 * This catches payload format regressions that unit tests miss because
 * they mock the dispatch layer.
 */
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { hookDispatcher } from '../hooks';
import type { AgentHookEvent } from '../hooks/types';

// ── Mocks ──────────────────────────────────────────
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({
    createAgentOperation: vi.fn(),
    getOperationMetadata: vi.fn(),
    loadAgentState: vi.fn(),
    releaseStepLock: vi.fn().mockResolvedValue(undefined),
    saveAgentState: vi.fn(),
    saveStepResult: vi.fn(),
    tryClaimStep: vi.fn().mockResolvedValue(true),
  })),
  createStreamEventManager: vi.fn(() => ({
    cleanupOperation: vi.fn(),
    publishAgentRuntimeEnd: vi.fn(),
    publishAgentRuntimeInit: vi.fn(),
    publishStreamEvent: vi.fn(),
  })),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(() => ({})),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(() => ({
    getImpl: vi.fn(() => ({})),
    scheduleMessage: vi.fn(),
  })),
}));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class {},
  isQueueAgentRuntimeEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

describe('Hooks integration — afterStep event carries step presentation data', () => {
  const createService = () => new AgentRuntimeService({} as any, 'user-1', { queueService: null });

  it('should include content, stepType, totalTokens, toolsCalling in afterStep event', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;

    // Simulate a running operation with afterStep hooks in metadata
    coordinator.loadAgentState.mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messages: [{ content: 'Hello', role: 'user' }],
      metadata: {
        _hooks: [{ id: 'bot-step', type: 'afterStep', webhook: { url: '/test' } }],
        agentId: 'agent-1',
        userId: 'user-1',
      },
      operationId: 'op-1',
      status: 'running',
      stepCount: 0,
      usage: { llm: { tokens: { total: 150 } }, tools: { totalCalls: 0 } },
    });

    // Mock runtime.step to return an LLM step with content
    // nextContext.phase is NOT tool_result, so content is extracted from llm_result event
    const stepResult = {
      events: [{ result: { content: 'Let me search for that.' }, type: 'llm_result' }],
      newState: {
        cost: { total: 0.01 },
        createdAt: new Date().toISOString(),
        messages: [
          { content: 'Hello', role: 'user' },
          { content: 'Let me search for that.', role: 'assistant' },
        ],
        metadata: {
          _hooks: [{ id: 'bot-step', type: 'afterStep', webhook: { url: '/test' } }],
          agentId: 'agent-1',
          topicId: 'topic-1',
          userId: 'user-1',
        },
        status: 'running',
        stepCount: 1,
        usage: {
          llm: {
            apiCalls: 1,
            tokens: { input: 50, output: 100, total: 150 },
          },
          tools: { totalCalls: 0 },
        },
      },
      nextContext: {
        payload: { message: [{ content: 'Let me search for that.' }] },
        phase: 'user_input',
        session: { sessionId: 'op-1', status: 'running', stepCount: 1 },
      },
    };

    vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({
      runtime: { step: vi.fn().mockResolvedValue(stepResult) },
    });

    // Capture the actual hook event
    const capturedEvents: AgentHookEvent[] = [];
    const dispatchSpy = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockImplementation(async (_opId, type, event) => {
        if (type === 'afterStep') capturedEvents.push(event);
      });

    await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-1',
      stepIndex: 0,
    });

    expect(capturedEvents).toHaveLength(1);
    const event = capturedEvents[0];

    // ── Core identification ──
    expect(event.operationId).toBe('op-1');
    expect(event.agentId).toBe('agent-1');
    expect(event.userId).toBe('user-1');

    // ── Step presentation data (what bot renderers need) ──
    expect(event.content).toBe('Let me search for that.');
    expect(event.stepType).toMatch(/call_llm|call_tool/);
    expect(typeof event.executionTimeMs).toBe('number');
    expect(event.totalTokens).toBe(150);
    expect(event.totalCost).toBe(0.01);
    expect(event.totalSteps).toBe(1);
    expect(event.shouldContinue).toBe(true);
    expect(event.topicId).toBe('topic-1');

    // ── Tracking data (cross-step accumulator for bot progress) ──
    expect(typeof event.totalToolCalls).toBe('number');
    // elapsedMs should be calculated from state.createdAt
    expect(typeof event.elapsedMs).toBe('number');

    // ── Full state available for local mode consumers ──
    expect(event.finalState).toBeDefined();
    expect(event.finalState.status).toBe('running');

    dispatchSpy.mockRestore();
  });

  it('should include toolsResult for tool_result phase', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;

    coordinator.loadAgentState.mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messages: [],
      metadata: {
        _hooks: [{ id: 'bot-step', type: 'afterStep', webhook: { url: '/test' } }],
        _stepTracking: { lastLLMContent: 'previous content', totalToolCalls: 1 },
        agentId: 'agent-1',
        userId: 'user-1',
      },
      operationId: 'op-2',
      status: 'running',
      stepCount: 1,
    });

    // stepResult.nextContext has tool_result phase — this is where toolsResult is extracted from
    const stepResult = {
      events: [{ type: 'done' }],
      newState: {
        createdAt: new Date().toISOString(),
        messages: [],
        metadata: {
          _hooks: [{ id: 'bot-step', type: 'afterStep', webhook: { url: '/test' } }],
          _stepTracking: { lastLLMContent: 'previous content', totalToolCalls: 1 },
          agentId: 'agent-1',
          userId: 'user-1',
        },
        status: 'running',
        stepCount: 2,
        usage: { llm: { tokens: { total: 200 } }, tools: { totalCalls: 1 } },
      },
      nextContext: {
        payload: {
          data: 'Search found 3 results',
          toolCall: { apiName: 'search', id: 'tc-1', identifier: 'lobe-web-browsing' },
          toolCallId: 'tc-1',
        },
        phase: 'tool_result',
        session: { sessionId: 'op-2', status: 'running', stepCount: 2 },
      },
    };

    vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({
      runtime: { step: vi.fn().mockResolvedValue(stepResult) },
    });

    const capturedEvents: AgentHookEvent[] = [];
    const dispatchSpy = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockImplementation(async (_opId, type, event) => {
        if (type === 'afterStep') capturedEvents.push(event);
      });

    await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-2',
      stepIndex: 1,
    });

    expect(capturedEvents).toHaveLength(1);
    const event = capturedEvents[0];

    // Tool result extracted from stepResult.nextContext.payload
    expect(event.toolsResult).toBeDefined();
    expect(event.toolsResult).toEqual([
      expect.objectContaining({
        apiName: 'search',
        identifier: 'lobe-web-browsing',
        output: 'Search found 3 results',
      }),
    ]);

    // Tracking data carries forward from previous steps
    expect(event.lastLLMContent).toBe('previous content');
    // totalToolCalls includes current step (1 previous + 0 new tool calls in this step)
    expect(event.totalToolCalls).toBe(1);

    dispatchSpy.mockRestore();
  });
});

describe('Hooks integration — onComplete event for early-terminal states', () => {
  const createService = () => new AgentRuntimeService({} as any, 'user-1', { queueService: null });

  it('should dispatch onComplete with correct reason when operation is interrupted', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;

    coordinator.loadAgentState.mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messages: [
        { content: 'Hello', role: 'user' },
        { content: 'I was working on it...', role: 'assistant' },
      ],
      metadata: { agentId: 'agent-1', userId: 'user-1' },
      status: 'interrupted',
      stepCount: 3,
      usage: { llm: { apiCalls: 2, tokens: { total: 500 } }, tools: { totalCalls: 1 } },
    });

    const capturedEvents: AgentHookEvent[] = [];
    const dispatchSpy = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockImplementation(async (_opId, type, event) => {
        if (type === 'onComplete') capturedEvents.push(event);
      });

    await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-interrupted',
      stepIndex: 4,
    });

    expect(capturedEvents).toHaveLength(1);
    const event = capturedEvents[0];

    expect(event.reason).toBe('interrupted');
    expect(event.operationId).toBe('op-interrupted');
    expect(event.lastAssistantContent).toBe('I was working on it...');
    expect(event.finalState).toBeDefined();

    dispatchSpy.mockRestore();
  });
});

describe('Hooks integration — afterStep event is compatible with renderStepProgress', () => {
  const createService = () => new AgentRuntimeService({} as any, 'user-1', { queueService: null });

  it('afterStep event fields map to RenderStepParams without undefined required fields', async () => {
    const service = createService();
    const coordinator = (service as any).coordinator;

    coordinator.loadAgentState.mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messages: [],
      metadata: {
        _hooks: [{ id: 'bot-step', type: 'afterStep', webhook: { url: '/test' } }],
        agentId: 'agent-1',
        userId: 'user-1',
      },
      operationId: 'op-compat',
      status: 'running',
      stepCount: 0,
    });

    const stepResult = {
      events: [{ type: 'done' }],
      newState: {
        createdAt: new Date().toISOString(),
        messages: [{ content: 'Result', role: 'assistant' }],
        metadata: {
          _hooks: [{ id: 'bot-step', type: 'afterStep', webhook: { url: '/test' } }],
          agentId: 'agent-1',
          userId: 'user-1',
        },
        status: 'done',
        stepCount: 1,
        usage: { llm: { tokens: { total: 100 } } },
      },
      nextContext: null,
    };

    vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({
      runtime: { step: vi.fn().mockResolvedValue(stepResult) },
    });

    const capturedEvents: AgentHookEvent[] = [];
    const dispatchSpy = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockImplementation(async (_opId, type, event) => {
        if (type === 'afterStep') capturedEvents.push(event);
      });

    await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-compat',
      stepIndex: 0,
    });

    expect(capturedEvents).toHaveLength(1);
    const event = capturedEvents[0];

    // Verify all fields needed by renderStepProgress are present and typed correctly
    // These map to RenderStepParams = StepPresentationData + { elapsedMs, lastContent, lastToolsCalling, totalToolCalls }
    expect(event.stepType).toBeDefined();
    expect(['call_llm', 'call_tool']).toContain(event.stepType);
    expect(typeof event.executionTimeMs).toBe('number');
    expect(typeof event.totalSteps).toBe('number');
    expect(typeof event.totalTokens).toBe('number');
    expect(typeof event.totalCost).toBe('number');
    expect(typeof event.totalInputTokens).toBe('number');
    expect(typeof event.totalOutputTokens).toBe('number');
    expect(typeof event.thinking).toBe('boolean');
    // These can be undefined but must be present as keys
    expect('content' in event).toBe(true);
    expect('reasoning' in event).toBe(true);
    expect('toolsCalling' in event).toBe(true);
    expect('toolsResult' in event).toBe(true);
    expect('elapsedMs' in event).toBe(true);
    expect('lastLLMContent' in event).toBe(true);
    expect('lastToolsCalling' in event).toBe(true);
    expect('totalToolCalls' in event).toBe(true);

    dispatchSpy.mockRestore();
  });
});
