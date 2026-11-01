import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { prepareHostedServerDefaultBinding } from '../providerBindingHost';
import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
} from '../types';
import { opencodeDriver } from './opencode';

const buildAgentInput = vi.fn(async () => ({
  args: ['--file', '/tmp/image.png'],
  stdin: 'raw prompt',
}));
const helpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers,
  promptInput: 'raw prompt',
  ...overrides,
});

describe('opencodeDriver', () => {
  it('binds a private OpenCode server to the selected relay model without storing credentials', async () => {
    const plan = await opencodeDriver.prepareServerDefaultBinding!({
      args: [
        '--model=other/model',
        '-m',
        'wrong/model',
        '--server',
        'https://other.test',
        '--continue',
        '--continue=true',
        '--standalone=false',
        '--fork=true',
        '--session',
        'other-session',
        '--agent',
        'custom',
        '--title',
        'Keep title',
      ],
      endpoint: 'https://example.test',
      env: {
        LOBEHUB_OPENCODE_API_KEY: 'stale-token',
        OPENCODE_CONFIG_CONTENT: '{"model":"other/model"}',
        KEEP: 'yes',
      },
      model: 'vendor/model',
      modelDescriptor: {
        abilities: { reasoning: true, vision: true },
        contextWindowTokens: 200_000,
        maxOutput: 16_000,
        model: 'vendor/model',
        nativeResponses: false,
      },
      profileDir: '/managed/opencode',
    });
    expect(plan.args).toEqual([
      '--standalone',
      '--model',
      'lobehub-server-default/lobehub/vendor/model',
      '--title',
      'Keep title',
    ]);
    expect(plan.operationTokenEnvKey).toBe('LOBEHUB_OPENCODE_API_KEY');
    expect(plan.env.LOBEHUB_OPENCODE_API_KEY).toBeUndefined();
    expect(plan.env.KEEP).toBe('yes');
    expect(plan.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
    const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT);
    expect(config.model).toBe('lobehub-server-default/lobehub/vendor/model');
    expect(config.small_model).toBe(config.model);
    expect(config.enabled_providers).toEqual(['lobehub-server-default']);
    expect(config.provider['lobehub-server-default']).toMatchObject({
      npm: '@ai-sdk/openai',
      options: {
        apiKey: '{env:LOBEHUB_OPENCODE_API_KEY}',
        baseURL: 'https://example.test/api/v1/openai/v1',
      },
      models: {
        'lobehub/vendor/model': {
          limit: { context: 200_000, output: 16_000 },
          modalities: { input: ['text', 'image'], output: ['text'] },
          reasoning: true,
        },
      },
    });
    expect(JSON.stringify(plan)).not.toContain('stale-token');
  });

  it('retains private session storage across turns and isolates model changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'opencode-binding-'));
    const prepare = (model: string, sessionId: string) =>
      prepareHostedServerDefaultBinding({
        agentType: 'opencode',
        appStoragePath: root,
        args: [],
        driver: opencodeDriver,
        endpoint: 'https://example.test',
        model,
        sessionId,
      });
    try {
      const first = await prepare('model-a', 'turn-1');
      const resumed = await prepare('model-a', 'turn-2');
      const switched = await prepare('model-b', 'turn-3');
      expect(resumed.bindingKey).toBe(first.bindingKey);
      expect(resumed.env.XDG_DATA_HOME).toBe(first.env.XDG_DATA_HOME);
      expect(switched.bindingKey).not.toBe(first.bindingKey);
      expect(switched.env.XDG_DATA_HOME).not.toBe(first.env.XDG_DATA_HOME);
      expect((await stat(first.profileDir)).mode & 0o777).toBe(0o700);
      expect(await readFile(first.env.OPENCODE_CONFIG, 'utf8')).toBe('{}\n');
      expect((await stat(first.env.OPENCODE_CONFIG)).mode & 0o777).toBe(0o600);
      const spawn = await opencodeDriver.buildSpawnPlan(
        buildParams({ args: resumed.args, resumeSessionId: 'native-session' }),
      );
      expect(spawn.args).toEqual(expect.arrayContaining(['--session', 'native-session']));
      expect(spawn.args).toContain('--standalone');
      await first.cleanup();
      await expect(stat(first.runDir)).rejects.toThrow();
      await expect(stat(first.profileDir)).resolves.toBeDefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('uses conservative model capabilities when the deployment has no model card', async () => {
    const plan = await opencodeDriver.prepareServerDefaultBinding!({
      args: [],
      endpoint: 'https://example.test',
      model: 'model',
      profileDir: '/managed/opencode',
    });
    const config = JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT);
    expect(config.provider['lobehub-server-default'].models['lobehub/model']).toMatchObject({
      limit: { context: 128_000, output: 16_384 },
      modalities: { input: ['text'], output: ['text'] },
      reasoning: false,
    });
  });

  it('is registered and composes base, resume, configured, and input args in order', async () => {
    expect(getHeterogeneousAgentDriver('opencode')).toBe(opencodeDriver);

    const plan = await opencodeDriver.buildSpawnPlan(
      buildParams({ args: ['--model', 'provider/model'], resumeSessionId: 'session-exact' }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('opencode', 'raw prompt');
    expect(plan).toEqual({
      args: [
        'run',
        '--format',
        'json',
        '--thinking',
        '--auto',
        '--session',
        'session-exact',
        '--model',
        'provider/model',
        '--file',
        '/tmp/image.png',
      ],
      stdinPayload: 'raw prompt',
    });
  });
});
