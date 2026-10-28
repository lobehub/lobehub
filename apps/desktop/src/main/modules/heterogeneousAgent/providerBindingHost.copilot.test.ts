import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { copilotDriver } from './drivers/copilot';
import {
  needsServerDefaultModelDescriptor,
  omitOwnedEnv,
  prepareHostedServerDefaultBinding,
  resolveHostedBindingSession,
} from './providerBindingHost';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('Copilot server-default binding lifecycle', () => {
  it('isolates Copilot state per model and only resumes the matching binding', async () => {
    const appStoragePath = await mkdtemp(path.join(tmpdir(), 'copilot-binding-'));
    roots.push(appStoragePath);
    const params = {
      agentType: 'copilot',
      appStoragePath,
      args: ['--model=gpt-5.4'],
      driver: copilotDriver,
      endpoint: 'https://lobehub.test',
      env: { COPILOT_PROVIDER_BEARER_TOKEN: 'user-byok-token', GH_TOKEN: 'github-identity' },
      model: 'model-a',
      sessionId: 'first',
    };

    const first = await prepareHostedServerDefaultBinding(params);
    expect(first.args).toEqual([]);
    expect(first.env.COPILOT_HOME).toBe(first.profileDir);
    expect((await stat(first.profileDir)).mode & 0o777).toBe(0o700);
    expect(first.env).not.toHaveProperty('COPILOT_PROVIDER_BEARER_TOKEN');
    expect(first.operationTokenEnvKey).toBe('COPILOT_PROVIDER_API_KEY');
    await first.cleanup();

    const resumed = await prepareHostedServerDefaultBinding({ ...params, sessionId: 'second' });
    expect(resumed.bindingKey).toBe(first.bindingKey);
    const resume = {
      agentType: 'copilot',
      resumeBindingKey: first.bindingKey,
      resumeSessionId: 'native-session',
    };
    expect(resolveHostedBindingSession({ ...resume, binding: resumed })).toEqual({
      model: 'lobehub/model-a',
      resumeSessionId: 'native-session',
    });

    const switched = await prepareHostedServerDefaultBinding({
      ...params,
      model: 'model-b',
      sessionId: 'switched',
    });
    expect(switched.profileDir).not.toBe(first.profileDir);
    expect(resolveHostedBindingSession({ ...resume, binding: switched })).toEqual({
      model: 'lobehub/model-b',
      resumeSessionId: undefined,
    });
    await resumed.cleanup();
    await switched.cleanup();
  });

  it('drops inherited Copilot provider settings so only the binding configures the relay', async () => {
    const appStoragePath = await mkdtemp(path.join(tmpdir(), 'copilot-binding-'));
    roots.push(appStoragePath);
    const binding = await prepareHostedServerDefaultBinding({
      agentType: 'copilot',
      appStoragePath,
      args: [],
      driver: copilotDriver,
      endpoint: 'https://lobehub.test',
      model: 'model-a',
      sessionId: 'inherited',
    });
    const inherited = {
      COPILOT_HOME: '/home/user/.copilot',
      COPILOT_PROVIDER_API_KEY_COMMAND: 'print-key',
      COPILOT_PROVIDER_WIRE_MODEL: 'gpt-5.4',
      GH_TOKEN: 'github-identity',
      PATH: '/usr/bin',
    };

    expect(omitOwnedEnv(inherited, binding)).toEqual({
      GH_TOKEN: 'github-identity',
      PATH: '/usr/bin',
    });
    expect(omitOwnedEnv(inherited, undefined)).toBe(inherited);
    expect(needsServerDefaultModelDescriptor('copilot')).toBe(true);
    expect(needsServerDefaultModelDescriptor('claude-code')).toBe(false);
    await binding.cleanup();
  });
});
