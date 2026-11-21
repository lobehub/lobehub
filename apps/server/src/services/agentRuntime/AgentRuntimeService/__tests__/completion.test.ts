/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../../hooks';
import { AgentRuntimeService } from '..';
import { setUpService } from './testUtils';

vi.mock('@lobechat/model-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

const { ssrfSafeFetch: mockSsrfSafeFetch } = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mockSsrfSafeFetch }));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', (...args) =>
  import('./testUtils').then((m) => (m.libsTrustedClientModule as (...a: any[]) => any)(...args)),
);

// Mock database and models
vi.mock('@/server/services/file', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesFileModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/message', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsMessageModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/database/models/agent', (...args) =>
  import('./testUtils').then((m) => (m.databaseModelsAgentModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/plugin', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsPluginModule as (...a: any[]) => any)(...args),
  ),
);

// Mock ModelRuntime to avoid server-side env access
vi.mock('@/server/modules/ModelRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Mock search service to avoid server-side env access
vi.mock('@/server/services/search', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverServicesSearchModule as (...a: any[]) => any)(...args),
  ),
);

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
vi.mock('@/server/modules/AgentRuntime/factory', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeFactoryModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime/redis', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeRedisModule as (...a: any[]) => any)(...args),
  ),
);

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
vi.mock('@/server/modules/AgentRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Spread the real module and override only `AgentRuntime` (to stub `.step()`).
// Keeps the real status predicates + package-hosted executors (e.g. `finish`),
// so this mock survives future executor migrations without edits.
vi.mock('@lobechat/agent-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/services/queue', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesQueueModule as (...a: any[]) => any)(...args)),
);

// Mock Mecha module
vi.mock('@/server/modules/Mecha', (...args) =>
  import('./testUtils').then((m) => (m.serverModulesMechaModule as (...a: any[]) => any)(...args)),
);

// Mock model-bank
vi.mock('model-bank', (...args) =>
  import('./testUtils').then((m) => (m.modelBankModule as (...a: any[]) => any)(...args)),
);

describe('AgentRuntimeService', () => {
  let service: AgentRuntimeService;
  let mockCoordinator: any;
  let mockDb: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockDb } = setUpService(AgentRuntimeService, mockUserId));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  describe('constructor', () => {
    it('should initialize with default base URL', () => {
      delete process.env.AGENT_RUNTIME_BASE_URL;
      const newService = new AgentRuntimeService(mockDb, mockUserId);
      expect((newService as any).baseURL).toBe('http://localhost:3210/api/agent');
    });

    it('should initialize with custom base URL from environment', () => {
      process.env.AGENT_RUNTIME_BASE_URL = 'http://custom:3000';
      const newService = new AgentRuntimeService(mockDb, mockUserId);
      expect((newService as any).baseURL).toBe('http://custom:3000/api/agent');
    });
  });

  describe('determineCompletionReason', () => {
    const reasonFor = (state: Record<string, any>) =>
      (service as any).determineCompletionReason(state);

    it('should report a plain completion as done', () => {
      expect(reasonFor({ status: 'done', stepCount: 3 })).toBe('done');
    });

    // The guard finalizes the turn without tool calls, which is indistinguishable
    // from a real answer by status alone — so these runs were all filed as 'done'
    // and could not be counted.
    it('should name a run the tool-call repeat guard cut short', () => {
      expect(
        reasonFor({
          status: 'done',
          stepCount: 250,
          toolCallRepeatGuard: { counts: {}, stoppedByRepeatLimit: true },
        }),
      ).toBe('tool_call_repeat_limit');
    });

    it('should let a real failure outrank the repeat-guard marker', () => {
      expect(
        reasonFor({
          status: 'error',
          stepCount: 250,
          toolCallRepeatGuard: { counts: {}, stoppedByRepeatLimit: true },
        }),
      ).toBe('error');
      expect(
        reasonFor({
          status: 'interrupted',
          stepCount: 250,
          toolCallRepeatGuard: { counts: {}, stoppedByRepeatLimit: true },
        }),
      ).toBe('interrupted');
    });

    it('should ignore a guard that counted repeats without ever stopping', () => {
      expect(
        reasonFor({ status: 'done', stepCount: 3, toolCallRepeatGuard: { counts: { sig: 4 } } }),
      ).toBe('done');
    });

    it('should still report the step and cost caps', () => {
      expect(reasonFor({ status: 'running', maxSteps: 10, stepCount: 10 })).toBe('max_steps');
      expect(
        reasonFor({
          status: 'running',
          stepCount: 3,
          cost: { total: 5 },
          costLimit: { maxTotalCost: 5 },
        }),
      ).toBe('cost_limit');
    });
  });

  describe('private methods', () => {
    describe('shouldContinueExecution', () => {
      it('should return false for completed status', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'done' },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return false for a plain interrupt with nothing left to settle', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'interrupted' },
          { phase: 'tool_result' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return false when waiting for human input', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'waiting_for_human' },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should not check maxSteps — delegated to runtime.step()', () => {
        // maxSteps is handled by runtime.step() which sets forceFinish → status:'done'
        // shouldContinueExecution only checks status, not maxSteps
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running', maxSteps: 10, stepCount: 10 },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(true);
      });

      it('should continue when forceFinish is active even at maxSteps', () => {
        // When runtime sets forceFinish, the service must allow one more step
        // for the LLM to produce a final text response without tools
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running', maxSteps: 5, stepCount: 6, forceFinish: true },
          { phase: 'llm_result' },
        );
        expect(shouldContinue).toBe(true);
      });

      it('should return false when cost limit exceeded with stop action', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          {
            status: 'running',
            cost: { total: 1 },
            costLimit: { maxTotalCost: 0.5, onExceeded: 'stop' },
          },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return true when cost limit exceeded with continue action', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          {
            status: 'running',
            cost: { total: 1 },
            costLimit: { maxTotalCost: 0.5, onExceeded: 'continue' },
          },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(true);
      });

      it('should return false when no context provided', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running' },
          null,
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return true for normal running state', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running' },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(true);
      });
    });

    describe('calculateStepDelay', () => {
      it('should return base delay for normal step', () => {
        const delay = (service as any).calculateStepDelay({
          events: [{ type: 'llm_response' }],
        });
        expect(delay).toBe(50);
      });

      it('should return longer delay for tool calls', () => {
        const delay = (service as any).calculateStepDelay({
          events: [{ type: 'tool_result' }],
        });
        expect(delay).toBe(100);
      });

      it('should return exponential backoff delay for errors', () => {
        const delay = (service as any).calculateStepDelay({
          events: [{ type: 'error' }],
        });
        expect(delay).toBe(100);
      });
    });

    describe('calculatePriority', () => {
      it('should return high priority for human input needed', () => {
        const priority = (service as any).calculatePriority({
          newState: { status: 'waiting_for_human' },
          events: [],
        });
        expect(priority).toBe('high');
      });

      it('should return normal priority for errors', () => {
        const priority = (service as any).calculatePriority({
          newState: { status: 'running' },
          events: [{ type: 'error' }],
        });
        expect(priority).toBe('normal');
      });

      it('should return normal priority by default', () => {
        const priority = (service as any).calculatePriority({
          newState: { status: 'running' },
          events: [{ type: 'llm_response' }],
        });
        expect(priority).toBe('normal');
      });
    });
  });

  describe('setQueuedMessages', () => {
    it('writes the flag for an operation owned by the caller', async () => {
      mockCoordinator.getOperationMetadata.mockResolvedValue({ userId: mockUserId });
      mockCoordinator.setQueuedMessages.mockResolvedValue(undefined);

      await expect(service.setQueuedMessages('op-1', true)).resolves.toBe(true);

      expect(mockCoordinator.setQueuedMessages).toHaveBeenCalledWith('op-1', true);
    });

    it("refuses another user's operation", async () => {
      mockCoordinator.getOperationMetadata.mockResolvedValue({ userId: 'someone-else' });

      await expect(service.setQueuedMessages('op-1', true)).resolves.toBe(false);

      expect(mockCoordinator.setQueuedMessages).not.toHaveBeenCalled();
    });

    it('refuses an unknown operation', async () => {
      mockCoordinator.getOperationMetadata.mockResolvedValue(null);

      await expect(service.setQueuedMessages('op-missing', false)).resolves.toBe(false);

      expect(mockCoordinator.setQueuedMessages).not.toHaveBeenCalled();
    });
  });
});
