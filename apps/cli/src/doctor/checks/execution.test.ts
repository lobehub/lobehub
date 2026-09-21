import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeContext, runCheck } from '../testUtils';
import { executionChecks } from './execution';

const state = vi.hoisted(() => ({
  agentConfig: {} as any,
  builtinAgent: null as any,
  globalConfig: {} as any,
  providerDetail: undefined as any,
  providerDetailThrows: false,
  providers: [] as any[],
  started: {} as any,
  statuses: [] as any[],
}));

const heteroDetect = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  DEFAULT_HETERO_COMMAND: { 'claude-code': 'claude', 'codex': 'codex' },
  detectHeterogeneousCliCommand: heteroDetect,
}));

vi.mock('../probes', () => ({
  probeClient: async () => ({
    agent: {
      getAgentConfigById: {
        query: async ({ agentId }: { agentId: string }) =>
          agentId === 'agt_known' ? state.agentConfig : null,
      },
      getBuiltinAgent: { query: async () => state.builtinAgent },
    },
    aiAgent: {
      execAgent: { mutate: async () => state.started },
      getOperationStatus: { query: async () => state.statuses.shift() ?? null },
    },
    aiProvider: {
      getAiProviderById: {
        query: async () => {
          if (state.providerDetailThrows) throw new Error('nope');
          return state.providerDetail;
        },
      },
    },
  }),
  probeGlobalConfig: async () => state.globalConfig,
  probeProviders: async () => state.providers,
}));

const deepContext = () => makeContext({ agent: 'agt_known', deep: true, timeoutMs: 1000 });

describe('execution.agent', () => {
  beforeEach(() => {
    state.agentConfig = { model: 'glm-5.3-flash', provider: 'lobehub', title: 'Architect' };
    state.builtinAgent = null;
    state.globalConfig = { serverConfig: { aiProvider: { lobehub: { enabled: true } } } };
    state.providers = [];
    state.providerDetail = { id: 'lobehub', keyVaults: { apiKey: 'stored-key' } };
    state.providerDetailThrows = false;
  });

  it('skips itself when no agent was named', async () => {
    const outcome = await runCheck(executionChecks, 'execution.agent', makeContext());

    expect(outcome.status).toBe('skip');
    expect(outcome.skippedBecause).toBe('--agent');
  });

  it('names the env var to set when the agent’s provider is not enabled anywhere', async () => {
    state.agentConfig = { model: 'kimi-k3', provider: 'fireworksai' };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('FIREWORKSAI_API_KEY');
  });

  it('passes when the provider has a key on the account', async () => {
    state.providers = [{ enabled: true, id: 'lobehub' }];
    state.globalConfig = { serverConfig: { aiProvider: {} } };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('key stored on the account');
  });

  it('fails a provider that is enabled but has an empty key vault', async () => {
    // `getAiProviderList` reports the toggle, not the key — enabling a provider
    // with no key is exactly what makes a run die with InvalidProviderAPIKey.
    state.providers = [{ enabled: true, id: 'lobehub' }];
    state.globalConfig = { serverConfig: { aiProvider: {} } };
    state.providerDetail = { id: 'lobehub', keyVaults: {} };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('no key stored');
  });

  it('does not fail a local runtime configured with only an endpoint', async () => {
    // Ollama / LM Studio store a baseURL and no secret, and need none.
    state.providers = [{ enabled: true, id: 'lobehub' }];
    state.globalConfig = { serverConfig: { aiProvider: {} } };
    state.providerDetail = { id: 'lobehub', keyVaults: { baseURL: 'http://127.0.0.1:1234/v1' } };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('endpoint and no key');
  });

  it('does not claim a key exists just because the server enables the provider', async () => {
    // `deepseek` is enabled unconditionally server-side, and server keys are
    // invisible to the CLI — so this may pass, but not as a key verification.
    state.providers = [];
    state.providerDetail = { id: 'lobehub', keyVaults: {} };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('reports as enabled');
    expect(outcome.detail).not.toContain('with a key');
  });

  it('says so instead of passing when the key vault cannot be read', async () => {
    // A restricted API key gets the provider back without its `keyVaults`.
    state.providers = [{ enabled: true, id: 'lobehub' }];
    state.globalConfig = { serverConfig: { aiProvider: {} } };
    state.providerDetail = { id: 'lobehub' };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('not verified');
  });

  it('falls back to a slug lookup when the value is not an id', async () => {
    state.builtinAgent = { id: 'agt_known' };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'inbox' }),
    );

    expect(outcome.status).toBe('ok');
  });

  it('fails when nothing matches', async () => {
    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'nope' }),
    );

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('No agent matches');
  });

  it('warns when the agent has no model pinned', async () => {
    state.agentConfig = { title: 'Architect' };

    const outcome = await runCheck(
      executionChecks,
      'execution.agent',
      makeContext({ agent: 'agt_known' }),
    );

    expect(outcome.status).toBe('warn');
  });
});

describe('execution.round-trip', () => {
  beforeEach(() => {
    state.started = { operationId: 'op_1', success: true, topicId: 'tpc_1' };
    state.statuses = [];
  });

  it('waits out the non-terminal states and reports tokens and cost', async () => {
    state.statuses = [
      { currentState: { status: 'idle' }, isCompleted: false },
      {
        currentState: { status: 'done', usage: { llm: { tokens: { total: 54_396 } } } },
        isCompleted: true,
        stats: { totalCost: 0.005_524, totalSteps: 1 },
      },
    ];

    const outcome = await runCheck(executionChecks, 'execution.round-trip', deepContext());

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('54396 tokens');
    expect(outcome.detail).toContain('$0.0055');
  });

  it('reports the run error rather than the transport', async () => {
    state.statuses = [
      {
        hasError: true,
        recentEvents: [{ data: { errorType: 'InvalidProviderAPIKey' }, type: 'error' }],
      },
    ];

    const outcome = await runCheck(executionChecks, 'execution.round-trip', deepContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('InvalidProviderAPIKey');
  });

  it('surfaces a headless run that still stopped for human input', async () => {
    state.statuses = [{ isCompleted: false, needsHumanInput: true }];

    const outcome = await runCheck(executionChecks, 'execution.round-trip', deepContext());

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('waiting for human input');
  });

  it('does not call a run that disappears mid-flight a success', async () => {
    // Null also means lost state (an expired key, a lost Redis entry), so only
    // `isCompleted` proves the round trip.
    state.statuses = [{ currentState: { status: 'idle' }, isCompleted: false }];

    const outcome = await runCheck(executionChecks, 'execution.round-trip', deepContext());

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('without reporting completion');
  });

  it('does not call a run that was never observed a success', async () => {
    // The server also returns null when there is no state yet; passing on that
    // would make this check incapable of failing.
    state.statuses = [];

    const outcome = await runCheck(executionChecks, 'execution.round-trip', deepContext());

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('nothing was observed to run');
  });

  it('reports the server refusing to start the run', async () => {
    state.started = { error: 'quota exhausted', success: false };

    const outcome = await runCheck(executionChecks, 'execution.round-trip', deepContext());

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toContain('quota exhausted');
  });
});

describe('execution.hetero', () => {
  beforeEach(() => {
    heteroDetect.mockReset();
  });

  it('reports the resolved binaries', async () => {
    heteroDetect.mockImplementation(async (type: string) => ({
      available: true,
      path: `/usr/bin/${type}`,
      version: '1.2.3',
    }));

    const outcome = await runCheck(executionChecks, 'execution.hetero', makeContext());

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('claude-code 1.2.3');
  });

  it('only fails on a missing agent the caller asked for', async () => {
    heteroDetect.mockImplementation(async (type: string) => ({
      available: type === 'codex',
      error: 'not found',
      path: '/usr/bin/codex',
    }));

    const ambient = await runCheck(executionChecks, 'execution.hetero', makeContext());
    const explicit = await runCheck(
      executionChecks,
      'execution.hetero',
      makeContext({ hetero: ['claude-code', 'codex'] }),
    );

    expect(ambient.status).toBe('ok');
    expect(explicit.status).toBe('fail');
  });
});
