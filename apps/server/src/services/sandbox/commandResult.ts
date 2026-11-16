import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';

import type { SandboxCommandResult } from './types';

export const normalizeSandboxCommandResult = (
  result: SandboxCallToolResult,
): SandboxCommandResult => {
  const sessionState = result.sessionExpiredAndRecreated
    ? { sessionExpiredAndRecreated: true }
    : {};
  if (!result.success) {
    return {
      ...sessionState,
      exitCode: 1,
      output: '',
      stderr: result.error?.message || 'Command execution failed',
      success: false,
    };
  }

  const raw = result.result || {};
  const rawExitCode = raw.exitCode ?? raw.exit_code;
  const exitCode = typeof rawExitCode === 'number' ? rawExitCode : 0;
  const output = String(raw.stdout || raw.output || '');
  const stderr = raw.stderr === undefined ? undefined : String(raw.stderr);
  const success = typeof raw.success === 'boolean' ? raw.success : exitCode === 0;

  return {
    ...sessionState,
    exitCode,
    output,
    stderr,
    success,
  };
};
