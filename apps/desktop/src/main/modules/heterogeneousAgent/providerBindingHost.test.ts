import { mkdtemp, readFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  gcHostedProviderBindingProfiles,
  prepareHostedProviderBinding,
  prepareHostedServerDefaultBinding,
} from './providerBindingHost';
import type { HeterogeneousAgentDriver } from './types';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const makeParams = async (driver: HeterogeneousAgentDriver) => {
  const appStoragePath = await mkdtemp(path.join(tmpdir(), 'provider-binding-host-'));
  roots.push(appStoragePath);
  return {
    agentType: 'codex',
    appStoragePath,
    args: [],
    driver,
    reference: {
      apiConfig: { model: 'gpt-test', providerId: 'provider-test' },
      kind: 'provider' as const,
    },
    resolution: {
      agentType: 'codex' as const,
      apiConfig: { model: 'gpt-test', providerId: 'provider-test' },
      endpoint: 'https://example.com/v1',
      protocol: 'openai-responses' as const,
      providerId: 'provider-test',
      runtimeConfig: {
        config: { enableResponseApi: true },
        keyVaults: { apiKey: 'secret' },
        settings: { sdkType: 'openai' as const, supportResponsesApi: true },
      },
    },
    sessionId: 'session-test',
  };
};

describe('prepareHostedProviderBinding', () => {
  it('creates private profile/run directories, keeps profile state, and cleans the run', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const driver: HeterogeneousAgentDriver = {
      buildSpawnPlan: async () => ({ args: [] }),
      prepareProviderBinding: ({ profileDir }) => ({
        args: ['--model', 'gpt-test'],
        cleanup,
        env: { CODEX_HOME: profileDir, SECRET_ENV: 'secret' },
        profileFiles: [{ content: 'env_key = "SECRET_ENV"\n', path: 'config.toml' }],
        runFiles: [{ content: 'temporary', path: 'request.tmp' }],
      }),
    };
    const binding = await prepareHostedProviderBinding(await makeParams(driver));

    expect(binding.bindingKey).toMatch(/^provider-binding:v1:/);
    expect((await stat(binding.profileDir)).mode & 0o777).toBe(0o700);
    expect((await stat(binding.runDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(binding.profileDir, 'config.toml'))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(binding.profileDir, 'config.toml'), 'utf8')).not.toContain(
      'secret',
    );

    await binding.cleanup();
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(stat(binding.runDir)).rejects.toThrow();
    await expect(stat(binding.profileDir)).resolves.toBeDefined();
  });

  it('rejects file traversal and cleans the partially created run directory', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const driver: HeterogeneousAgentDriver = {
      buildSpawnPlan: async () => ({ args: [] }),
      prepareProviderBinding: () => ({
        args: [],
        cleanup,
        env: {},
        runFiles: [{ content: 'escape', path: '../escape' }],
      }),
    };
    const params = await makeParams(driver);
    await expect(prepareHostedProviderBinding(params)).rejects.toThrow(/managed directory/);
    await expect(
      stat(path.join(params.appStoragePath, 'heteroAgent', 'runs', params.sessionId)),
    ).rejects.toThrow();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('releases driver resources synchronously during app shutdown', async () => {
    const cleanupSync = vi.fn();
    const driver: HeterogeneousAgentDriver = {
      buildSpawnPlan: async () => ({ args: [] }),
      prepareProviderBinding: () => ({ args: [], cleanupSync, env: {} }),
    };
    const binding = await prepareHostedProviderBinding(await makeParams(driver));

    binding.cleanupSync();

    expect(cleanupSync).toHaveBeenCalledOnce();
    await expect(stat(binding.runDir)).rejects.toThrow();
  });

  it('isolates Pi profiles by model while reusing an identity after API-key rotation', async () => {
    const driver: HeterogeneousAgentDriver = {
      buildSpawnPlan: async () => ({ args: [] }),
      prepareProviderBinding: ({ resolution }) => ({
        args: [],
        env: {},
        profileFiles: [{ content: resolution.apiConfig.model, path: 'models.json' }],
      }),
    };
    const base = await makeParams(driver);
    const piParams = (model: string, sessionId: string, apiKey = 'secret') => ({
      ...base,
      agentType: 'pi',
      reference: {
        apiConfig: { model, providerId: 'provider-test' },
        kind: 'provider' as const,
      },
      resolution: {
        ...base.resolution,
        agentType: 'pi' as const,
        apiConfig: { model, providerId: 'provider-test' },
        protocol: 'openai-chat-completions' as const,
        runtimeConfig: {
          ...base.resolution.runtimeConfig,
          keyVaults: { apiKey, baseURL: 'https://example.com/v1' },
        },
      },
      sessionId,
    });

    const [first, second] = await Promise.all([
      prepareHostedProviderBinding(piParams('model-a', 'session-a')),
      prepareHostedProviderBinding(piParams('model-b', 'session-b')),
    ]);
    const rotated = await prepareHostedProviderBinding(
      piParams('model-a', 'session-c', 'rotated-secret'),
    );

    expect(first.bindingKey).toMatch(/^provider-binding:v2:/);
    expect(first.profileDir).not.toBe(second.profileDir);
    expect(first.bindingKey).not.toBe(second.bindingKey);
    expect(rotated.profileDir).toBe(first.profileDir);
    expect(rotated.bindingKey).toBe(first.bindingKey);
    expect(await readFile(path.join(first.profileDir, 'models.json'), 'utf8')).toBe('model-a');
    expect(await readFile(path.join(second.profileDir, 'models.json'), 'utf8')).toBe('model-b');
  });

  it.each(['grok-build', 'trae'] as const)(
    'isolates %s profiles by model because the managed catalog is profile-scoped',
    async (agentType) => {
      const driver: HeterogeneousAgentDriver = {
        buildSpawnPlan: async () => ({ args: [] }),
        prepareProviderBinding: ({ profileDir }) => ({
          args: [],
          env: { PROFILE_HOME: profileDir },
        }),
      };
      const base = await makeParams(driver);
      const firstParams = {
        ...base,
        agentType,
        reference: {
          ...base.reference,
          apiConfig: { ...base.reference.apiConfig, model: 'model-a' },
        },
        resolution: {
          ...base.resolution,
          agentType,
          apiConfig: { ...base.resolution.apiConfig, model: 'model-a' },
        },
      };
      const secondParams = {
        ...firstParams,
        reference: {
          ...firstParams.reference,
          apiConfig: { ...firstParams.reference.apiConfig, model: 'model-b' },
        },
        resolution: {
          ...firstParams.resolution,
          apiConfig: { ...firstParams.resolution.apiConfig, model: 'model-b' },
        },
        sessionId: 'session-test-2',
      };

      const first = await prepareHostedProviderBinding(firstParams);
      const second = await prepareHostedProviderBinding(secondParams);

      expect(second.profileDir).not.toBe(first.profileDir);
      expect(second.bindingKey).not.toBe(first.bindingKey);
    },
  );
});

describe('prepareHostedServerDefaultBinding', () => {
  // Mirrors claude-code: the plan writes no profileFiles, so the profile
  // directory itself is never touched after creation (transcripts land in
  // subdirectories, which do not update the root mtime).
  const claudeCodeLikeDriver: HeterogeneousAgentDriver = {
    buildSpawnPlan: async () => ({ args: [] }),
    prepareServerDefaultBinding: ({ profileDir }) => ({
      args: [],
      env: { CLAUDE_CONFIG_DIR: profileDir },
      operationTokenEnvKey: 'ANTHROPIC_AUTH_TOKEN',
    }),
  };

  const makeServerDefaultParams = async () => {
    const appStoragePath = await mkdtemp(path.join(tmpdir(), 'server-default-binding-host-'));
    roots.push(appStoragePath);
    return {
      agentType: 'claude-code',
      appStoragePath,
      args: [],
      driver: claudeCodeLikeDriver,
      endpoint: 'https://example.com',
      model: 'lobehub-default',
      sessionId: 'session-test',
    };
  };

  it('creates private profile/run directories and cleans only the run', async () => {
    const binding = await prepareHostedServerDefaultBinding(await makeServerDefaultParams());

    expect((await stat(binding.profileDir)).mode & 0o777).toBe(0o700);
    expect((await stat(binding.runDir)).mode & 0o777).toBe(0o700);
    expect(binding.operationTokenEnvKey).toBe('ANTHROPIC_AUTH_TOKEN');

    await binding.cleanup();
    await expect(stat(binding.runDir)).rejects.toThrow();
    await expect(stat(binding.profileDir)).resolves.toBeDefined();
  });

  it('records last use on prepare so GC never collects an in-use profile', async () => {
    const params = await makeServerDefaultParams();
    const binding = await prepareHostedServerDefaultBinding(params);
    const marker = path.join(binding.profileDir, '.lobehub-last-used');
    await expect(stat(marker)).resolves.toBeDefined();

    // Regression: the profile root mtime stays at creation for claude-code
    // server-default profiles. Only the marker may keep them alive.
    const staleTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(binding.profileDir, staleTime, staleTime);

    const removed = await gcHostedProviderBindingProfiles(params.appStoragePath);
    expect(removed).toEqual([]);
    await expect(stat(binding.profileDir)).resolves.toBeDefined();

    // The same profile, idle beyond the max age, is still collected.
    await utimes(marker, staleTime, staleTime);
    const collected = await gcHostedProviderBindingProfiles(params.appStoragePath);
    expect(collected).toEqual([binding.profileDir]);
  });
});

describe('gcHostedProviderBindingProfiles', () => {
  const driver: HeterogeneousAgentDriver = {
    buildSpawnPlan: async () => ({ args: [] }),
    prepareProviderBinding: ({ profileDir }) => ({
      args: [],
      env: { CODEX_HOME: profileDir },
      profileFiles: [{ content: 'state', path: 'config.toml' }],
    }),
  };

  it('records last use on prepare and only removes profiles idle beyond the max age', async () => {
    const params = await makeParams(driver);
    const binding = await prepareHostedProviderBinding(params);
    const marker = path.join(binding.profileDir, '.lobehub-last-used');
    await expect(stat(marker)).resolves.toBeDefined();

    // A freshly used profile survives the sweep.
    const kept = await gcHostedProviderBindingProfiles(params.appStoragePath);
    expect(kept).toEqual([]);
    await expect(stat(binding.profileDir)).resolves.toBeDefined();

    // The same profile, idle beyond the max age, is collected.
    const staleTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(marker, staleTime, staleTime);
    const removed = await gcHostedProviderBindingProfiles(params.appStoragePath);
    expect(removed).toEqual([binding.profileDir]);
    await expect(stat(binding.profileDir)).rejects.toThrow();
  });

  it('collects pre-marker profiles by directory mtime so legacy orphans are not immortal', async () => {
    const params = await makeParams(driver);
    const binding = await prepareHostedProviderBinding(params);
    const { rm } = await import('node:fs/promises');
    await rm(path.join(binding.profileDir, '.lobehub-last-used'), { force: true });

    const staleTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(binding.profileDir, staleTime, staleTime);

    const removed = await gcHostedProviderBindingProfiles(params.appStoragePath);
    expect(removed).toEqual([binding.profileDir]);
  });

  it('returns nothing when no binding root exists yet', async () => {
    const appStoragePath = await mkdtemp(path.join(tmpdir(), 'provider-binding-gc-'));
    roots.push(appStoragePath);
    await expect(gcHostedProviderBindingProfiles(appStoragePath)).resolves.toEqual([]);
  });
});
