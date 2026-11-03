import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { droidDriver } from './drivers/droid';
import {
  prepareHostedServerDefaultBinding,
  resolveHostedBindingSession,
} from './providerBindingHost';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Droid server-default binding lifecycle', () => {
  it('reuses a credential-free model profile for continuation and isolates switched models', async () => {
    const appStoragePath = await mkdtemp(path.join(tmpdir(), 'droid-binding-'));
    roots.push(appStoragePath);
    const params = {
      agentType: 'droid',
      appStoragePath,
      args: ['--tag', 'lobe'],
      driver: droidDriver,
      endpoint: 'https://example.test',
      env: { FACTORY_API_KEY: 'native-identity', LOBEHUB_DROID_API_KEY: 'expired-token' },
      model: 'model-a',
      sessionId: 'first',
    };
    const first = await prepareHostedServerDefaultBinding(params);
    const settingsPath = path.join(first.profileDir, 'settings.json');
    const settings = await readFile(settingsPath, 'utf8');
    expect(first.args).toEqual(['--tag', 'lobe']);
    expect(first.settingsPath).toBe(settingsPath);
    expect(first.env).toEqual({ FACTORY_API_KEY: 'native-identity' });
    expect(first.operationTokenEnvKey).toBe('LOBEHUB_DROID_API_KEY');
    expect(settings).toContain('${LOBEHUB_DROID_API_KEY}');
    expect(settings).not.toContain('expired-token');
    expect(settings).not.toContain('native-identity');
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
    await first.cleanup();
    await expect(stat(first.runDir)).rejects.toThrow();
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(settings);

    const resumed = await prepareHostedServerDefaultBinding({ ...params, sessionId: 'second' });
    expect(resumed.profileDir).toBe(first.profileDir);
    expect(resumed.bindingKey).toBe(first.bindingKey);
    const resume = {
      agentType: 'droid',
      initialModel: params.model,
      resumeBindingKey: first.bindingKey,
      resumeSessionId: 'native-session',
    };
    expect(resolveHostedBindingSession({ ...resume, binding: resumed })).toEqual({
      model: 'custom:LobeHub-Server-Default-0',
      resumeSessionId: 'native-session',
    });

    const switched = await prepareHostedServerDefaultBinding({
      ...params,
      model: 'model-b',
      sessionId: 'switched',
    });
    expect(switched.profileDir).not.toBe(first.profileDir);
    expect(
      resolveHostedBindingSession({ ...resume, binding: switched }).resumeSessionId,
    ).toBeUndefined();
    expect(
      JSON.parse(await readFile(path.join(switched.profileDir, 'settings.json'), 'utf8')),
    ).toMatchObject({ customModels: [{ model: 'lobehub/model-b' }] });
    await resumed.cleanup();
    await switched.cleanup();
  });
});
