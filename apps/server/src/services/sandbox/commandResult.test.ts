import { describe, expect, it } from 'vitest';

import { normalizeSandboxCommandResult } from './commandResult';

describe('normalizeSandboxCommandResult', () => {
  it('preserves recreation when the command fails inside a successful response', async () => {
    expect(
      normalizeSandboxCommandResult({
        result: { exitCode: 1, stderr: 'missing input file', stdout: '' },
        sessionExpiredAndRecreated: true,
        success: true,
      }),
    ).toEqual({
      exitCode: 1,
      output: '',
      sessionExpiredAndRecreated: true,
      stderr: 'missing input file',
      success: false,
    });
  });

  it.each([undefined, false])('does not report recreation for flag %s', async (flag) => {
    expect(
      normalizeSandboxCommandResult({
        result: { exitCode: 0, stdout: 'output' },
        sessionExpiredAndRecreated: flag,
        success: true,
      }),
    ).toEqual({ exitCode: 0, output: 'output', stderr: undefined, success: true });
  });

  it.each([true, false])('preserves recreation when transport success is %s', async (success) => {
    expect(
      normalizeSandboxCommandResult({
        error: success ? undefined : { message: 'missing file' },
        result: { exitCode: 0, stdout: 'output' },
        sessionExpiredAndRecreated: true,
        success,
      }),
    ).toMatchObject({ sessionExpiredAndRecreated: true, success });
  });
});
