import { buildHeteroExecArgs } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnProviderBoundAgentRun } from './providerBoundAgentRun';

const { runtime, prepare, spawn, cleanup, client } = vi.hoisted(() => ({
  runtime: vi.fn(),
  prepare: vi.fn(),
  spawn: vi.fn(),
  cleanup: vi.fn(),
  client: vi.fn(),
}));
vi.mock('../api/client', () => ({ createLambdaClient: client }));
vi.mock('@lobechat/heterogeneous-agents/providerBindingHost', () => ({
  prepareHostedProviderBinding: prepare,
}));
vi.mock('./agentRun', () => ({ spawnHeteroAgentRun: spawn }));

const auth = {
  serverUrl: 'https://example.test',
  token: 'full-user-token',
  tokenType: 'jwt' as const,
  userId: 'user',
};
const logger = { error: vi.fn(), info: vi.fn() };
const request = {
  agentType: 'codex',
  args: ['--model', 'native-model', '--effort', 'low'],
  assistantMessageId: 'message',
  jwt: 'operation-token',
  operationId: 'op',
  prompt: 'hello',
  topicId: 'topic',
  resumeSessionId: 'native-session',
  providerBinding: { kind: 'provider', apiConfig: { model: 'gpt-api', providerId: 'openai' } },
};

/** @example A provider request never silently falls back to the connector's native login. */
describe('provider-bound device execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.mockReturnValue({ aiProvider: { getProviderBindingRuntime: { mutate: runtime } } });
    runtime.mockResolvedValue({
      enabled: true,
      enabledModels: [{ id: 'gpt-api', providerId: 'openai', type: 'chat' }],
      runtimeConfig: {
        config: { enableResponseApi: true },
        keyVaults: { apiKey: 'private-test-key' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      },
    });
    prepare.mockResolvedValue({
      args: ['--effort', 'low', '--model', 'gpt-api'],
      bindingKey: 'provider-binding:v1:test',
      env: { CODEX_HOME: 'private-profile', LOBEHUB_CODEX_API_KEY: 'private-test-key' },
      cleanup,
    });
    spawn.mockResolvedValue({ status: 'accepted' });
  });

  // ROOT CAUSE:
  // The legacy agent_run_request carries no provider reference. Removing only the
  // server guard would launch the native ChatGPT profile with an API model name.
  // The dedicated RPC resolves credentials on-device and supplies a private profile.
  /** @example Personal lookup uses full auth, while the child receives only operation auth. */
  it('resolves provider auth locally and discards the native session on the first API run', async () => {
    await spawnProviderBoundAgentRun(request, auth, undefined, logger);
    /** @example No workspace header is borrowed from ambient CLI state. */
    expect(client).toHaveBeenCalledWith(auth);
    /** @example The profile host owns credentials; argv carries only the selected model. */
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        jwt: 'operation-token',
        resumeSessionId: undefined,
        args: ['--effort', 'low', '--model', 'gpt-api'],
        sessionBindingKey: 'provider-binding:v1:test',
        preparedEnv: { CODEX_HOME: 'private-profile', LOBEHUB_CODEX_API_KEY: 'private-test-key' },
      }),
      logger,
    );
  });

  /** @example Workspace members cannot query the connector owner's personal provider. */
  it('rejects a workspace connection before provider lookup or spawning', async () => {
    /** @example Fail closed at the scope boundary. */
    await expect(spawnProviderBoundAgentRun(request, auth, 'workspace', logger)).rejects.toThrow(
      'personal connection',
    );
    /** @example No secret-bearing request was made. */
    expect(runtime).not.toHaveBeenCalled();
    /** @example Native fallback is forbidden. */
    expect(spawn).not.toHaveBeenCalled();
  });

  /** @example Disabling the selected provider prevents device execution. */
  it('rejects unavailable providers without falling back to native auth', async () => {
    runtime.mockResolvedValue({ enabled: false });
    /** @example The resolver's safe error code reaches the caller. */
    await expect(spawnProviderBoundAgentRun(request, auth, undefined, logger)).rejects.toThrow(
      'providerUnavailable',
    );
    /** @example The child was never started. */
    expect(spawn).not.toHaveBeenCalled();
  });

  /** @example A matching binding key preserves API continuation; a changed endpoint does not. */
  it('resumes only the profile that owns the recorded session', async () => {
    await spawnProviderBoundAgentRun(
      {
        ...request,
        providerBinding: {
          ...request.providerBinding,
          resumeBindingKey: 'provider-binding:v1:test',
        },
      },
      auth,
      undefined,
      logger,
    );
    /** @example The selected provider owns this session. */
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ resumeSessionId: 'native-session' }),
      logger,
    );
  });
  /** @example Config overrides encoded for the wrapper cannot replace the resolved provider endpoint. */
  it('sanitizes native overrides after decoding the real dispatch argv', async () => {
    const args = buildHeteroExecArgs({
      type: 'codex',
      authMode: 'api',
      apiConfig: { model: 'gpt-api', providerId: 'openai' },
      args: [
        '-c',
        'model_provider="foreign"',
        '--config=model_providers.lobehub.base_url="https://foreign.invalid"',
        '-m',
        'foreign-model',
        '-c',
        'model_reasoning_effort="low"',
      ],
    });
    await spawnProviderBoundAgentRun({ ...request, args }, auth, undefined, logger);
    /** @example Only non-binding custom settings survive wrapper encoding. */
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: ['--agent-arg=-c', '--agent-arg=model_reasoning_effort="low"'],
      }),
    );
  });
});
