import { mkdtemp, readFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  gcHostedProviderBindingProfiles,
  prepareHostedProviderBinding,
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
    reference: { apiConfig: { model: 'gpt-test', providerId: 'provider-test' } },
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
    const driver: HeterogeneousAgentDriver = {
      buildSpawnPlan: async () => ({ args: [] }),
      prepareProviderBinding: ({ profileDir }) => ({
        args: ['--model', 'gpt-test'],
        env: { CODEX_HOME: profileDir, SECRET_ENV: 'secret' },
        profileFiles: [{ content: 'env_key = "SECRET_ENV"\n', path: 'config.toml' }],
        runFiles: [{ content: 'temporary', path: 'request.tmp' }],
      }),
    };
    const binding = await prepareHostedProviderBinding(await makeParams(driver));

    expect((await stat(binding.profileDir)).mode & 0o777).toBe(0o700);
    expect((await stat(binding.runDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(binding.profileDir, 'config.toml'))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(binding.profileDir, 'config.toml'), 'utf8')).not.toContain(
      'secret',
    );

    await binding.cleanup();
    await expect(stat(binding.runDir)).rejects.toThrow();
    await expect(stat(binding.profileDir)).resolves.toBeDefined();
  });

  it('rejects file traversal and cleans the partially created run directory', async () => {
    const driver: HeterogeneousAgentDriver = {
      buildSpawnPlan: async () => ({ args: [] }),
      prepareProviderBinding: () => ({
        args: [],
        env: {},
        runFiles: [{ content: 'escape', path: '../escape' }],
      }),
    };
    const params = await makeParams(driver);
    await expect(prepareHostedProviderBinding(params)).rejects.toThrow(/managed directory/);
    await expect(
      stat(path.join(params.appStoragePath, 'heteroAgent', 'runs', params.sessionId)),
    ).rejects.toThrow();
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
