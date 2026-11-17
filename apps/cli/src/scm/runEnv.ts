import os from 'node:os';
import path from 'node:path';

import { resolveCliDirName } from '../constants/identity';
import type { ScmCredentialEnvOptions } from './credentialEnv';
import { applyScmCredentialEnv } from './credentialEnv';
import { ensureGhShim } from './ghShim';

const SCM_CREDENTIAL_CAPABILITY = 'scm:github-credential';

export interface RunScmCredential {
  gitEmail?: string;
  gitName?: string;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const scmHelperInvocation = () =>
  [
    ...[process.execPath, ...process.execArgv, process.argv[1]].map(shellQuote),
    'git',
    'credential',
  ].join(' ');

// Read without verifying: it only decides whether to isolate, and a forged
// claim can only switch isolation on. The identity field rides a gateway that
// may drop new fields; the token always arrives, so isolation fails closed.
export const jwtGrantsScmCredential = (jwt: string): boolean => {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return (
      Array.isArray(payload?.capabilities) &&
      payload.capabilities.includes(SCM_CREDENTIAL_CAPABILITY)
    );
  } catch {
    return false;
  }
};

export const prepareRunScmCredentialEnv = async (
  operationId: string,
  credential: RunScmCredential,
): Promise<(env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv> => {
  const shimDir = path.join(
    os.homedir(),
    resolveCliDirName(),
    'scm',
    operationId.replaceAll(/[^\w.-]/g, '_'),
  );
  const invocation = scmHelperInvocation();
  await ensureGhShim(shimDir, invocation);

  const options: ScmCredentialEnvOptions = {
    gitEmail: credential.gitEmail,
    gitName: credential.gitName,
    helperCommand: `!${invocation}`,
    shimDir,
  };
  return (env) => applyScmCredentialEnv(env, options);
};
