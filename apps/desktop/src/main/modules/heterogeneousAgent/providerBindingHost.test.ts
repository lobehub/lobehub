import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareHostedProviderBinding } from './providerBindingHost';
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
