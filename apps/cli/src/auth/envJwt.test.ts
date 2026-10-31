import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hydrateJwtFromFile, JWT_FILE_ENV } from './envJwt';

describe('hydrateJwtFromFile', () => {
  let dir: string;
  let jwtPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lh-envjwt-'));
    jwtPath = path.join(dir, 'jwt');
    await writeFile(jwtPath, '  header.payload.sig\n', { mode: 0o600 });
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('reads and trims the token from LOBEHUB_JWT_FILE when LOBEHUB_JWT is unset', () => {
    const env: NodeJS.ProcessEnv = { [JWT_FILE_ENV]: jwtPath };
    hydrateJwtFromFile(env);
    expect(env.LOBEHUB_JWT).toBe('header.payload.sig');
  });

  it('prefers the file over an inherited token, which goes stale after renewal', () => {
    // Codex's default policy passes the original LOBEHUB_JWT alongside the file;
    // only the file is rewritten when the operation token renews.
    const env: NodeJS.ProcessEnv = { LOBEHUB_JWT: 'expired', [JWT_FILE_ENV]: jwtPath };
    hydrateJwtFromFile(env);
    expect(env.LOBEHUB_JWT).toBe('header.payload.sig');
  });

  it('keeps an inherited token when the file is missing or empty', async () => {
    const missing: NodeJS.ProcessEnv = { LOBEHUB_JWT: 'from-env', [JWT_FILE_ENV]: `${jwtPath}x` };
    hydrateJwtFromFile(missing);
    expect(missing.LOBEHUB_JWT).toBe('from-env');

    await writeFile(jwtPath, '\n');
    const empty: NodeJS.ProcessEnv = { LOBEHUB_JWT: 'from-env', [JWT_FILE_ENV]: jwtPath };
    hydrateJwtFromFile(empty);
    expect(empty.LOBEHUB_JWT).toBe('from-env');
  });

  it('treats an explicitly empty LOBEHUB_JWT as an opt-out of the file', () => {
    const env: NodeJS.ProcessEnv = { LOBEHUB_JWT: '', [JWT_FILE_ENV]: jwtPath };
    hydrateJwtFromFile(env);
    expect(env.LOBEHUB_JWT).toBe('');
  });

  it('behaves as unset when the file is missing, empty, or the path is blank', async () => {
    const missing: NodeJS.ProcessEnv = { [JWT_FILE_ENV]: path.join(dir, 'nope') };
    hydrateJwtFromFile(missing);
    expect(missing.LOBEHUB_JWT).toBeUndefined();

    await writeFile(jwtPath, '\n');
    const empty: NodeJS.ProcessEnv = { [JWT_FILE_ENV]: jwtPath };
    hydrateJwtFromFile(empty);
    expect(empty.LOBEHUB_JWT).toBeUndefined();

    const blank: NodeJS.ProcessEnv = { [JWT_FILE_ENV]: '  ' };
    hydrateJwtFromFile(blank);
    expect(blank.LOBEHUB_JWT).toBeUndefined();
  });

  it('makes the file token the winning auth source', async () => {
    const saved = { file: process.env[JWT_FILE_ENV], jwt: process.env.LOBEHUB_JWT };
    delete process.env.LOBEHUB_JWT;
    process.env[JWT_FILE_ENV] = jwtPath;
    try {
      hydrateJwtFromFile();
      const { pickAuthSource } = await import('./source');
      expect(pickAuthSource()).toMatchObject({ kind: 'env-jwt', token: 'header.payload.sig' });
    } finally {
      if (saved.jwt === undefined) delete process.env.LOBEHUB_JWT;
      else process.env.LOBEHUB_JWT = saved.jwt;
      if (saved.file === undefined) delete process.env[JWT_FILE_ENV];
      else process.env[JWT_FILE_ENV] = saved.file;
    }
  });
});
