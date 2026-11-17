import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveCliDirName } from '../constants/identity';
import { applyScmCredentialEnv, SCM_CREDENTIAL_BLOCKED_ENV } from './credentialEnv';
import { ensureGhShim } from './ghShim';
import { scmHelperInvocation } from './runEnv';

export const SCM_CREDENTIAL_TOOL_ARG = '__scmCredential';

const TOKEN_LIFETIME_MS = 5 * 60 * 1000;

interface ToolCallScmCredential {
  gitEmail?: string;
  gitName?: string;
  jwt: string;
}

const readCredential = (value: unknown): ToolCallScmCredential | undefined => {
  if (!value || typeof value !== 'object') return;
  const { gitEmail, gitName, jwt } = value as Record<string, unknown>;
  if (typeof jwt !== 'string' || !jwt) return;
  return {
    gitEmail: typeof gitEmail === 'string' ? gitEmail : undefined,
    gitName: typeof gitName === 'string' ? gitName : undefined,
    jwt,
  };
};

const commandFinished = (result: unknown) =>
  (result as { state?: { exitCode?: unknown } } | null)?.state?.exitCode !== undefined;

export const withToolCallScmCredential = async <T>(
  args: Record<string, any>,
  run: (args: Record<string, any>) => Promise<T>,
): Promise<T> => {
  const { [SCM_CREDENTIAL_TOOL_ARG]: rawCredential, ...commandArgs } = args;
  const credential = readCredential(rawCredential);
  if (!credential) return run(commandArgs);

  const jwtDir = await mkdtemp(path.join(os.tmpdir(), 'lh-scm-'));
  const jwtFile = path.join(jwtDir, 'jwt');
  await writeFile(jwtFile, credential.jwt, { mode: 0o600 });
  const removeJwt = () => rm(jwtDir, { force: true, recursive: true });

  let result: T | undefined;
  try {
    const shimDir = path.join(os.homedir(), resolveCliDirName(), 'scm', 'tool-call');
    const invocation = scmHelperInvocation();
    await ensureGhShim(shimDir, invocation);

    const modelEnv = (commandArgs.env ?? {}) as Record<string, string>;
    const base = { ...process.env, ...modelEnv };
    const env = applyScmCredentialEnv(base, {
      gitEmail: credential.gitEmail,
      gitName: credential.gitName,
      helperCommand: `!${invocation}`,
      jwtFile,
      shimDir,
    });
    // The shell merges this over the device's own env, so a token the device
    // carries must be blanked here: leaving the key out would let it through.
    for (const key of SCM_CREDENTIAL_BLOCKED_ENV) if (base[key] !== undefined) env[key] = '';

    result = await run({ ...commandArgs, env });
    return result;
  } finally {
    if (result !== undefined && !commandFinished(result)) {
      setTimeout(() => void removeJwt(), TOKEN_LIFETIME_MS).unref();
    } else {
      await removeJwt();
    }
  }
};
