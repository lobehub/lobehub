/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { type AgentExecutionParams } from '../types';
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

  describe('executeStep - tool result extraction', () => {
    const mockParams: AgentExecutionParams = {
      operationId: 'test-operation-1',
      stepIndex: 1,
      context: {
        phase: 'user_input',
        payload: {
          message: { content: 'test' },
          sessionId: 'test-operation-1',
          isFirstMessage: false,
        },
        session: {
          sessionId: 'test-operation-1',
          status: 'running',
          stepCount: 1,
          messageCount: 1,
        },
      },
    };

    const mockState = {
      operationId: 'test-operation-1',
      status: 'running',
      stepCount: 1,
      messages: [],
      events: [],
      lastModified: new Date().toISOString(),
    };

    const mockMetadata = {
      userId: 'user-123',
      agentConfig: { name: 'test-agent' },
      modelRuntimeConfig: { model: 'gpt-4' },
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: 'running',
      totalCost: 0,
      totalSteps: 1,
    };

    beforeEach(() => {
      mockCoordinator.loadAgentState.mockResolvedValue(mockState);
      mockCoordinator.getOperationMetadata.mockResolvedValue(mockMetadata);
    });

    it('should extract tool output from data field for single tool_result', async () => {
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: {
          phase: 'tool_result',
          payload: {
            data: 'Search found 3 results for "weather"',
            executionTime: 120,
            isSuccess: true,
            toolCall: { identifier: 'lobe-web-browsing', apiName: 'search', id: 'tc-1' },
            toolCallId: 'tc-1',
          },
          session: {
            sessionId: 'test-operation-1',
            status: 'running',
            stepCount: 2,
            messageCount: 2,
          },
        },
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep(mockParams);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'afterStep',
        expect.objectContaining({
          toolsResult: [
            expect.objectContaining({
              apiName: 'search',
              identifier: 'lobe-web-browsing',
              output: 'Search found 3 results for "weather"',
            }),
          ],
        }),
        undefined,
      );

      dispatchSpy.mockRestore();
    });

    it('should extract tool output from data field for tools_batch_result', async () => {
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: {
          phase: 'tools_batch_result',
          payload: {
            parentMessageId: 'msg-1',
            toolCount: 2,
            toolResults: [
              {
                data: 'Result from tool A',
                executionTime: 100,
                isSuccess: true,
                toolCall: { identifier: 'builtin', apiName: 'searchA', id: 'tc-1' },
                toolCallId: 'tc-1',
              },
              {
                data: { items: [1, 2, 3] },
                executionTime: 200,
                isSuccess: true,
                toolCall: { identifier: 'lobe-skills', apiName: 'activateSkill', id: 'tc-2' },
                toolCallId: 'tc-2',
              },
            ],
          },
          session: {
            sessionId: 'test-operation-1',
            status: 'running',
            stepCount: 2,
            messageCount: 3,
          },
        },
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep(mockParams);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'afterStep',
        expect.objectContaining({
          toolsResult: [
            expect.objectContaining({
              apiName: 'searchA',
              identifier: 'builtin',
              output: 'Result from tool A',
            }),
            expect.objectContaining({
              apiName: 'activateSkill',
              identifier: 'lobe-skills',
              output: JSON.stringify({ items: [1, 2, 3] }),
            }),
          ],
        }),
        undefined,
      );

      dispatchSpy.mockRestore();
    });

    it('should handle tool result with undefined data', async () => {
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: {
          phase: 'tool_result',
          payload: {
            data: undefined,
            toolCall: { identifier: 'builtin', apiName: 'noop', id: 'tc-1' },
            toolCallId: 'tc-1',
          },
          session: {
            sessionId: 'test-operation-1',
            status: 'running',
            stepCount: 2,
            messageCount: 2,
          },
        },
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep(mockParams);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'afterStep',
        expect.objectContaining({
          toolsResult: [
            expect.objectContaining({
              apiName: 'noop',
              identifier: 'builtin',
              output: undefined,
            }),
          ],
        }),
        undefined,
      );

      dispatchSpy.mockRestore();
    });
  });
});
