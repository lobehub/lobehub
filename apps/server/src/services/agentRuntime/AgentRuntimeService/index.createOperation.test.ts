/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { type OperationCreationParams } from '../types';
import { AgentRuntimeService } from '.';
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
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator } = setUpService(AgentRuntimeService, mockUserId));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  describe('createOperation', () => {
    const mockParams: OperationCreationParams = {
      operationId: 'test-operation-1',
      initialContext: {
        phase: 'user_input',
        payload: {
          message: { content: 'test' },
          sessionId: 'test-operation-1',
          isFirstMessage: true,
        },
        session: { sessionId: 'test-operation-1', status: 'idle', stepCount: 0, messageCount: 0 },
      },
      appContext: {},
      agentConfig: { name: 'test-agent' },
      modelRuntimeConfig: { model: 'gpt-4' },
      toolSet: { manifestMap: {} },
      userId: 'user-123',
      autoStart: true,
      initialMessages: [],
    };

    it.each([undefined, 'parent-operation'])(
      'persists only caller hooks for a run with parent %s',
      async (parentOperationId) => {
        vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'http://webhook-service/ingress');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-env-secret');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'beforeToolCall, afterToolCall, beforeToolCall');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'block');
        const hooks = [
          {
            id: 'internal-callback',
            type: 'afterToolCall' as const,
            webhook: { url: 'http://webhook-service/internal' },
          },
        ];
        await service.createOperation({
          ...mockParams,
          autoStart: false,
          parentOperationId,
          hooks,
        });
        const state = await mockCoordinator.loadAgentState(mockParams.operationId);
        expect(state.host.hooks).toEqual(hooks);
        expect(JSON.stringify(state.host.hooks)).not.toContain('synthetic-env-secret');
        expect(hookDispatcher.hasHooks(mockParams.operationId)).toBe(true);
      },
    );

    it.each([undefined, false, true])(
      'persists the snapshot opt-in for resumed steps (%s)',
      async (includeFinalState) => {
        await service.createOperation({ ...mockParams, autoStart: false, includeFinalState });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.includeFinalState === true).toBe(includeFinalState === true);
      },
    );

    describe('file Works declaration (host.acceptsFileWorks)', () => {
      it('stores the declaration the client made', async () => {
        await service.createOperation({ ...mockParams, acceptsFileWorks: true, autoStart: false });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.acceptsFileWorks).toBe(true);
      });

      it("lets a group member inherit its supervisor's declaration", async () => {
        await mockCoordinator.saveAgentState('parent-op', { host: { acceptsFileWorks: true } });
        mockCoordinator.saveAgentState.mockClear();

        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, orchestrationRole: 'member' },
          autoStart: false,
          parentOperationId: 'parent-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.acceptsFileWorks).toBe(true);
      });

      it.each([undefined, false])('carries no declaration for %s', async (acceptsFileWorks) => {
        await service.createOperation({ ...mockParams, acceptsFileWorks, autoStart: false });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host).not.toHaveProperty('acceptsFileWorks');
      });
    });
  });
});
