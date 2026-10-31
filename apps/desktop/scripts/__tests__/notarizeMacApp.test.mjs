import { describe, expect, it, vi } from 'vitest';

import {
  notarizeMacApp,
  resolveNotaryCredentialArgs,
  stapleWithRetry,
} from '../notarizeMacApp.mjs';

const logger = { info: vi.fn(), warn: vi.fn() };
const appleIdEnv = {
  APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
  APPLE_ID: 'dev@example.com',
  APPLE_TEAM_ID: 'TEAM123',
};

const createExecute = ({ stapleFailures = 0, status = 'Accepted' } = {}) => {
  let stapleCalls = 0;
  return vi.fn((command, args) => {
    if (command === 'xcrun' && args[0] === 'notarytool')
      return JSON.stringify({ id: 'sub-1', status });
    if (command === 'xcrun' && args[0] === 'stapler') {
      stapleCalls += 1;
      if (stapleCalls <= stapleFailures)
        throw new Error('The staple and validate action failed! Error 68.');
    }
    return '';
  });
};

describe('macOS notarization', () => {
  it('resolves Apple ID and API key credentials', () => {
    expect(resolveNotaryCredentialArgs(appleIdEnv)).toEqual([
      '--apple-id',
      'dev@example.com',
      '--password',
      'app-password',
      '--team-id',
      'TEAM123',
    ]);
    expect(
      resolveNotaryCredentialArgs({
        APPLE_API_ISSUER: 'issuer',
        APPLE_API_KEY: '/keys/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEY1',
      }),
    ).toEqual(['--key', '/keys/AuthKey.p8', '--key-id', 'KEY1', '--issuer', 'issuer']);
    expect(resolveNotaryCredentialArgs({})).toBeNull();
    expect(() => resolveNotaryCredentialArgs({ APPLE_ID: 'dev@example.com' })).toThrow();
  });

  it('retries stapling after a transient CloudKit failure instead of failing the build', async () => {
    const execute = createExecute({ stapleFailures: 2 });
    const wait = vi.fn();

    await expect(stapleWithRetry('/build/LobeHub.app', { execute, logger, wait })).resolves.toBe(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('fails once every staple attempt is exhausted', async () => {
    const execute = createExecute({ stapleFailures: 5 });

    await expect(
      stapleWithRetry('/build/LobeHub.app', { attempts: 3, execute, logger, wait: vi.fn() }),
    ).rejects.toThrow('after 3 attempts');
  });

  it('submits once and staples after the notary accepts the app', async () => {
    const execute = createExecute({ stapleFailures: 1 });

    await expect(
      notarizeMacApp('/build/LobeHub.app', {
        environment: appleIdEnv,
        execute,
        logger,
        staple: { wait: vi.fn() },
      }),
    ).resolves.toEqual({ notarized: true });

    const submits = execute.mock.calls.filter(([, args]) => args[0] === 'notarytool');
    expect(submits).toHaveLength(1);
    expect(submits[0][1]).toEqual(expect.arrayContaining(['--wait', '--team-id', 'TEAM123']));
  });

  it('rejects a submission the notary did not accept', async () => {
    const execute = createExecute({ status: 'Invalid' });

    await expect(
      notarizeMacApp('/build/LobeHub.app', { environment: appleIdEnv, execute, logger }),
    ).rejects.toThrow('Apple notarization Invalid (submission sub-1)');
    expect(execute.mock.calls.some(([, args]) => args[0] === 'stapler')).toBe(false);
  });

  it('skips notarization without credentials', async () => {
    const execute = createExecute();

    await expect(
      notarizeMacApp('/build/LobeHub.app', { environment: {}, execute, logger }),
    ).resolves.toEqual({ notarized: false });
    expect(execute).not.toHaveBeenCalled();
  });
});
