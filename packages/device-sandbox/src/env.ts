import type { SandboxEnvironment, SandboxPolicy } from './types';

const DEFAULT_ENV_KEYS = [
  'COLORTERM',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'PATH',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
] as const;

export const createSandboxEnv = (
  source: SandboxEnvironment,
  policy: Pick<SandboxPolicy, 'envAllowlist'>,
): SandboxEnvironment => {
  const allowedKeys = new Set([...DEFAULT_ENV_KEYS, ...(policy.envAllowlist ?? [])]);
  const env: SandboxEnvironment = {};

  for (const key of allowedKeys) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }

  return env;
};
