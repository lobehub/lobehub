import { describe, expect, it } from 'vitest';

import { stripInheritedRunIdentity } from './runIdentityEnv';

describe('stripInheritedRunIdentity', () => {
  it('drops the ancestor run identity and JWT file, keeping everything else', () => {
    const env = {
      HOME: '/home/u',
      LOBEHUB_AGENT_ID: 'agt',
      LOBEHUB_ASSISTANT_MESSAGE_ID: 'msg',
      LOBEHUB_JWT: 'launcher-token',
      LOBEHUB_JWT_FILE: '/tmp/ancestor/jwt',
      LOBEHUB_TASK_ID: 'task',
      LOBEHUB_WORKSPACE_ID: 'ws',
    };

    // The launcher overwrites LOBEHUB_JWT itself; only the file pointer could outrank it.
    expect(stripInheritedRunIdentity(env)).toEqual({
      HOME: '/home/u',
      LOBEHUB_JWT: 'launcher-token',
    });
    expect(env.LOBEHUB_JWT_FILE).toBe('/tmp/ancestor/jwt');
  });
});
