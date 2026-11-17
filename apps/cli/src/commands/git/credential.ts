import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { createLambdaClient } from '../../api/client';

interface Writer {
  write: (chunk: string) => boolean;
}

type CredentialResult =
  | { expiresAt: string; ok: true; password: string; username: string }
  | { authorizeUrl?: string; message: string; ok: false; reason: string };

interface CredentialClient {
  scmCredential: {
    github: {
      mutate: (input: {
        host: string;
        path?: string;
        protocol?: string;
      }) => Promise<CredentialResult>;
    };
  };
}

export interface GitCredentialIo {
  createClient?: (auth: { serverUrl: string; token: string; tokenType: 'jwt' }) => CredentialClient;
  env?: NodeJS.ProcessEnv;
  serverUrl: string;
  stderr: Writer;
  stdin: Readable;
  stdout: Writer;
}

const GITHUB_HOST = 'github.com';

const readRequest = async (stdin: Readable) => {
  let raw = '';
  for await (const chunk of stdin) raw += chunk.toString();

  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    if (!line.trim()) break;
    const separator = line.indexOf('=');
    if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields;
};

// Only `lh git credential` reads this file: `LOBEHUB_JWT_FILE` would hand the
// credential-only token to every other `lh` command in the same shell.
const readRunToken = async (env: NodeJS.ProcessEnv) => {
  const filePath = env.LOBEHUB_SCM_JWT_FILE?.trim();
  if (filePath) {
    const token = await readFile(filePath, 'utf8').then(
      (value) => value.trim(),
      () => '',
    );
    if (token) return token;
  }
  return env.LOBEHUB_JWT;
};

const refuse = (io: GitCredentialIo, message: string) => {
  io.stderr.write(`lh git credential: ${message}\n`);
  // `quit` stops git from consulting a later helper or prompting, so a device
  // login can never answer once the run's own credential is refused.
  io.stdout.write('quit=1\n');
  return 1;
};

export const runGitCredential = async (action: string, io: GitCredentialIo): Promise<number> => {
  const request = await readRequest(io.stdin);
  if (action !== 'get') return 0;
  if (request.host?.toLowerCase() !== GITHUB_HOST) return 0;

  const token = await readRunToken(io.env ?? process.env);
  if (!token) {
    return refuse(io, 'GitHub credentials are only issued inside a LobeHub run on this device.');
  }

  const createClient =
    io.createClient ?? ((auth) => createLambdaClient(auth) as unknown as CredentialClient);
  let result: CredentialResult;
  try {
    result = await createClient({
      serverUrl: io.serverUrl,
      token,
      tokenType: 'jwt',
    }).scmCredential.github.mutate({
      host: request.host,
      path: request.path,
      protocol: request.protocol,
    });
  } catch (error) {
    return refuse(io, error instanceof Error ? error.message : String(error));
  }

  if (!result.ok) {
    return refuse(
      io,
      result.authorizeUrl ? `${result.message}\n  ${result.authorizeUrl}` : result.message,
    );
  }

  io.stdout.write(
    `username=${result.username}\npassword=${result.password}\npassword_expiry_utc=${Math.floor(Date.parse(result.expiresAt) / 1000)}\n`,
  );
  return 0;
};
