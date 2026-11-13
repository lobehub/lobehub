// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { stubRunningDurableOperation } from '../AgentRuntimeService/__tests__/testUtils';
import { hookDispatcher } from '../hooks';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return { query: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return {
      createAgentOperation: vi.fn(),
      getOperationMetadata: vi.fn(),
      hasQueuedMessages: vi.fn().mockResolvedValue(false),
      isInterrupted: vi.fn().mockResolvedValue(false),
      loadAgentState: vi.fn(),
      refreshStepLock: vi.fn().mockResolvedValue(true),
      releaseStepLock: vi.fn().mockResolvedValue(undefined),
      saveAgentState: vi.fn(),
      saveStepResult: vi.fn(),
      tryClaimStep: vi.fn().mockResolvedValue(true),
    };
  }),
  createStreamEventManager: vi.fn(function () {
    return {
      cleanupOperation: vi.fn(),
      publishAgentRuntimeEnd: vi.fn(),
      publishAgentRuntimeInit: vi.fn(),
      publishStreamEvent: vi.fn(),
    };
  }),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(function () {
    return { getImpl: vi.fn(() => ({})), scheduleMessage: vi.fn() };
  }),
}));
vi.mock('@/server/services/queue/impls', () => ({ LocalQueueServiceImpl: class {} }));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

beforeEach(() => {
  stubRunningDurableOperation();
});

// The agent-document index rows a step froze must reach the state the
// step saves, or the next step renders the edited document live and rewrites
// the prompt-cache prefix behind the index.
describe('AgentRuntimeService.executeStep - agent-document index facts', () => {
  it('writes the facts the step bound into binding.agentDocumentIndex', async () => {
    const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
    const coordinator = (service as any).coordinator;
    const completionLifecycle = (service as any).completionLifecycle;

    const state: any = {
      binding: { device: { id: 'device-1' } },
      cost: { currency: 'USD', total: 0 },
      host: { hooks: [] },
      lastModified: new Date().toISOString(),
      messages: [],
      operationId: 'op-doc-index',
      status: 'running',
      stepCount: 0,
      usage: {},
    };
    let savedState: any;
    coordinator.loadAgentState = vi.fn().mockResolvedValue(state);
    coordinator.saveStepResult = vi.fn().mockImplementation(async (_operationId, stepResult) => {
      savedState = stepResult.newState;
    });

    const facts = {
      'agent-doc-1': { contentCharCount: 9400, updatedAt: '2026-05-01T00:00:00.000Z' },
    };
    vi.spyOn(service as any, 'createAgentRuntime').mockImplementation(
      async ({ bindAgentDocumentIndex }: any) => ({
        runtime: {
          step: vi.fn().mockImplementation(async () => {
            bindAgentDocumentIndex(facts);
            return { events: [], newState: { ...state, status: 'done', stepCount: 1 } };
          }),
        },
      }),
    );
    vi.spyOn(completionLifecycle, 'emitSignalEvents').mockResolvedValue([]);
    vi.spyOn(completionLifecycle as any, 'persistCompletion').mockResolvedValue(true);
    vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined as any);

    await service.executeStep({
      context: { phase: 'agent_step' } as any,
      operationId: 'op-doc-index',
      stepIndex: 0,
    });

    expect(savedState.binding).toEqual({
      agentDocumentIndex: facts,
      device: { id: 'device-1' },
    });
  });
});
