import { vi } from 'vitest';

/**
 * `@/server/modules/AgentRuntime` replacement for executeStep tests: a stub
 * coordinator whose step lock always succeeds and whose interrupt checks report
 * a running operation, plus a no-op stream event manager. Tests override
 * individual methods on `(service as any).coordinator`.
 */
export const executeStepAgentRuntimeModule = () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return {
      createAgentOperation: vi.fn(),
      getOperationMetadata: vi.fn(),
      hasQueuedMessages: vi.fn().mockResolvedValue(false),
      isInterrupted: vi.fn().mockResolvedValue(false),
      loadAgentState: vi.fn(),
      loadAgentStatus: vi.fn().mockResolvedValue(null),
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
});
