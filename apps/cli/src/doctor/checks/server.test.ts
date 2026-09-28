import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCheck } from '../testUtils';
import { enabledProviders, serverChecks } from './server';

const state = vi.hoisted(() => ({
  agentGatewayUrl: 'wss://agent-gateway.lobehub.com',
  globalConfig: {} as any,
  providers: [] as any[],
  userState: {} as any,
  userStateError: undefined as Error | undefined,
}));

vi.mock('../../settings', () => ({ resolveAgentGatewayUrl: () => state.agentGatewayUrl }));
vi.mock('../../constants/urls', () => ({
  OFFICIAL_AGENT_GATEWAY_URL: 'wss://agent-gateway.lobehub.com',
}));

vi.mock('../probes', () => ({
  probeClient: async () => ({
    user: {
      getUserState: {
        query: async () => {
          if (state.userStateError) throw state.userStateError;
          return state.userState;
        },
      },
    },
  }),
  probeGlobalConfig: async () => state.globalConfig,
  probeProviders: async () => state.providers,
}));

describe('enabledProviders', () => {
  it('unions account-enabled providers with the ones the server enables from env', () => {
    expect(
      enabledProviders(
        [
          { enabled: true, id: 'openai' },
          { enabled: false, id: 'anthropic' },
        ],
        {
          fireworksai: { enabled: true },
          groq: { enabled: false },
        },
      ),
    ).toEqual(['fireworksai', 'openai']);
  });
});

describe('server.identity', () => {
  beforeEach(() => {
    state.userStateError = undefined;
    state.userState = { subscriptionPlan: 'pro', userId: 'user_1', username: 'me' };
  });

  it('names the account the server accepted', async () => {
    const outcome = await runCheck(serverChecks, 'server.identity');

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('me');
  });

  it('separates a rejected credential from a broken call', async () => {
    state.userStateError = new Error('UNAUTHORIZED');

    const outcome = await runCheck(serverChecks, 'server.identity');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('Log in again');
  });
});

describe('server.capabilities', () => {
  it('flags an agent gateway the CLI and the server disagree about', async () => {
    state.globalConfig = {
      serverConfig: {
        agentGatewayUrl: 'wss://gateway.internal',
        enableGatewayMode: true,
        enableUploadFileToServer: true,
      },
    };

    const outcome = await runCheck(serverChecks, 'server.capabilities');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('AGENT_GATEWAY_URL=wss://gateway.internal');
  });

  it('does not escalate an unrelated capability to a failure', async () => {
    state.agentGatewayUrl = 'wss://agent-gateway.lobehub.com';
    state.globalConfig = {
      serverConfig: {
        agentGatewayUrl: 'wss://agent-gateway.lobehub.com',
        enableGatewayMode: true,
        enableUploadFileToServer: false,
      },
    };

    const outcome = await runCheck(serverChecks, 'server.capabilities');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('file storage is off');
  });

  it('warns when gateway mode is off server-side', async () => {
    state.agentGatewayUrl = 'wss://gateway.internal';
    state.globalConfig = {
      serverConfig: {
        agentGatewayUrl: 'wss://gateway.internal',
        enableGatewayMode: false,
        enableUploadFileToServer: true,
      },
    };

    const outcome = await runCheck(serverChecks, 'server.capabilities');

    expect(outcome.status).toBe('warn');
    expect(outcome.detail).toContain('gateway mode is off');
  });
});

describe('server.providers', () => {
  it('fails when no provider is enabled at all', async () => {
    state.providers = [{ enabled: false, id: 'openai' }];
    state.globalConfig = { serverConfig: { aiProvider: {} } };

    const outcome = await runCheck(serverChecks, 'server.providers');

    expect(outcome.status).toBe('fail');
    expect(outcome.fix).toContain('<PROVIDER>_API_KEY');
  });

  it('claims enablement, not a usable key, for the providers it lists', async () => {
    state.providers = [{ enabled: true, id: 'openai' }];
    state.globalConfig = { serverConfig: { aiProvider: {} } };

    const outcome = await runCheck(serverChecks, 'server.providers');

    expect(outcome.status).toBe('ok');
    expect(outcome.detail).toContain('1 enabled provider(s)');
    expect(outcome.detail).not.toContain('usable');
  });
});
