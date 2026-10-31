/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../../hooks';
import { AgentRuntimeService, createEvalToolForwardingHook } from '..';
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
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    setUpService(AgentRuntimeService, mockUserId);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  describe('eval tool forwarding hook', () => {
    const event = {
      apiName: 'search_tweets',
      args: { query: 'test' },
      callIndex: 2,
      identifier: 'twitter',
      mock: vi.fn(),
      operationId: 'op-forwarding',
      stepIndex: 3,
    };

    beforeEach(() => {
      event.mock.mockReset();
      mockSsrfSafeFetch.mockReset();
      // The tests' endpoints live on the server's trusted mock.
      vi.stubEnv('EVAL_TOOL_MOCK_BASE_URL', 'https://mock.test');
    });

    it('refuses an endpoint off the trusted mock: no request, no token, a failed tool result', async () => {
      vi.stubEnv('EVAL_TOOL_FORWARDING_TOKEN', 'secret-token');
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://evil.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
      expect(event.mock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, content: expect.stringContaining('refused') }),
      );
    });

    it('refuses every endpoint when the server has no trusted mock configured', async () => {
      vi.stubEnv('EVAL_TOOL_MOCK_BASE_URL', '');
      vi.stubEnv('EVAL_TOOL_FORWARDING_TOKEN', 'secret-token');
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
      expect(event.mock).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('refuses a same-host endpoint outside the trusted path prefix', async () => {
      vi.stubEnv('EVAL_TOOL_MOCK_BASE_URL', 'https://mock.test/bench');
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
      expect(event.mock).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('never follows a redirect, so the token cannot leave the trusted mock', async () => {
      vi.stubEnv('EVAL_TOOL_FORWARDING_TOKEN', 'secret-token');
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(null, { headers: { location: 'https://evil.test/' }, status: 302 }),
      );
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(1);
      expect(mockSsrfSafeFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
      expect(event.mock).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, content: expect.stringContaining('redirect') }),
      );
    });

    it('forwards the beforeToolCall payload and preserves the returned tool result', async () => {
      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      const result = { content: 'fixture result', state: { source: 'mock' }, success: true };
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: result, success: true })),
      );
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
        'https://mock.test/tool-calls',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(JSON.parse(mockSsrfSafeFetch.mock.calls[0][1].body)).toEqual({
        data: { apiName: 'search_tweets', args: { query: 'test' }, identifier: 'twitter' },
        metadata: { callIndex: 2, operationId: 'op-forwarding', stepIndex: 3 },
        type: 'toolCall',
      });
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
      expect(event.mock).toHaveBeenCalledWith(result);
      timeoutSpy.mockRestore();
    });

    it('includes the dataset case id in forwarding metadata', async () => {
      const result = { content: 'fixture result', success: true };
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: result, success: true })),
      );
      const hook = createEvalToolForwardingHook(
        { twitter: { endpoint: 'https://mock.test/tool-calls' } },
        'case-42',
      );

      await hook.handler!(event as any);

      expect(JSON.parse(mockSsrfSafeFetch.mock.calls[0][1].body)).toMatchObject({
        metadata: { caseId: 'case-42' },
      });
    });

    it('includes the attempt id so a mock can keep one session per attempt', async () => {
      const result = { content: 'fixture result', success: true };
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: result, success: true })),
      );
      const hook = createEvalToolForwardingHook(
        { twitter: { endpoint: 'https://mock.test/tool-calls' } },
        'case-42',
        'run_1_tpc_1',
      );

      await hook.handler!(event as any);

      expect(JSON.parse(mockSsrfSafeFetch.mock.calls[0][1].body)).toMatchObject({
        metadata: { attemptId: 'run_1_tpc_1', caseId: 'case-42', operationId: 'op-forwarding' },
      });
    });

    it('authenticates to the mock with the server-side forwarding token when one is set', async () => {
      const previous = process.env.EVAL_TOOL_FORWARDING_TOKEN;
      process.env.EVAL_TOOL_FORWARDING_TOKEN = 'secret-token';
      try {
        mockSsrfSafeFetch.mockResolvedValue(
          new Response(JSON.stringify({ data: { content: 'ok', success: true }, success: true })),
        );
        const hook = createEvalToolForwardingHook({
          twitter: { endpoint: 'https://mock.test/tool-calls' },
        });

        await hook.handler!(event as any);

        expect(mockSsrfSafeFetch.mock.calls[0][1].headers).toMatchObject({
          Authorization: 'Bearer secret-token',
        });
      } finally {
        if (previous === undefined) delete process.env.EVAL_TOOL_FORWARDING_TOKEN;
        else process.env.EVAL_TOOL_FORWARDING_TOKEN = previous;
      }
    });

    it('mocks a failed result without executing the real tool', async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'fixture unavailable', success: false })),
      );
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(event.mock).toHaveBeenCalledWith({
        content: 'fixture unavailable',
        error: 'fixture unavailable',
        success: false,
      });
    });

    it('mocks a placeholder when a successful response has no tool result', async () => {
      mockSsrfSafeFetch.mockResolvedValue(new Response(JSON.stringify({ success: true })));
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(event.mock).toHaveBeenCalledWith({ content: 'No tool result', success: true });
    });

    it('mocks a placeholder when a successful response has an invalid tool result', async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: { content: 1, success: true }, success: true })),
      );
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(event.mock).toHaveBeenCalledWith({ content: 'No tool result', success: true });
    });

    it('mocks a failed result when the forwarding response is not JSON', async () => {
      mockSsrfSafeFetch.mockResolvedValue(new Response('not-json'));
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(event.mock).toHaveBeenCalledWith({
        content: expect.stringContaining('SyntaxError'),
        error: expect.any(SyntaxError),
        success: false,
      });
    });

    it('releases the unread body of a non-2xx forwarding response', async () => {
      const cancel = vi.fn();
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(new ReadableStream({ cancel, pull: () => new Promise(() => {}) }), {
          status: 503,
        }),
      );
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(event.mock).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('HTTP 503'), success: false }),
      );
      expect(cancel).toHaveBeenCalled();
    });

    it('mocks transport failures', async () => {
      mockSsrfSafeFetch.mockRejectedValue('SSRF blocked');
      const hook = createEvalToolForwardingHook({
        twitter: { endpoint: 'https://mock.test/tool-calls' },
      });

      await hook.handler!(event as any);

      expect(event.mock).toHaveBeenCalledWith({
        content: 'SSRF blocked',
        error: 'SSRF blocked',
        success: false,
      });
    });
  });
});
