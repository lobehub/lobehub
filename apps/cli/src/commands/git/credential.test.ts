import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGitCredential } from './credential';

const mutate = vi.fn();
const createClient = vi.fn(() => ({ scmCredential: { github: { mutate } } }));

const run = async (action: string, input: string, env: Record<string, string | undefined>) => {
  const stdin = new PassThrough();
  stdin.end(input);
  let stdout = '';
  let stderr = '';
  const code = await runGitCredential(action, {
    createClient: createClient as any,
    env,
    serverUrl: 'https://app.example.com',
    stderr: { write: (chunk: string) => ((stderr += chunk), true) },
    stdin,
    stdout: { write: (chunk: string) => ((stdout += chunk), true) },
  });
  return { code, stderr, stdout };
};

const request = 'protocol=https\nhost=github.com\npath=lobehub/lobehub.git\n\n';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lh git credential', () => {
  it('answers get with the credential the run token exchanges for', async () => {
    mutate.mockResolvedValue({
      expiresAt: '2026-11-17T18:00:00.000Z',
      gitEmail: '42+arvinxx@users.noreply.github.com',
      gitName: 'Arvin Xu',
      ok: true,
      password: 'ghu_requester',
      username: 'x-access-token',
    });

    const result = await run('get', request, { LOBEHUB_JWT: 'jwt-op' });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `username=x-access-token\npassword=ghu_requester\npassword_expiry_utc=${Date.parse('2026-11-17T18:00:00.000Z') / 1000}\n`,
    );
    expect(createClient).toHaveBeenCalledWith({
      serverUrl: 'https://app.example.com',
      token: 'jwt-op',
      tokenType: 'jwt',
    });
    expect(mutate).toHaveBeenCalledWith({
      host: 'github.com',
      path: 'lobehub/lobehub.git',
      protocol: 'https',
    });
  });

  it('stops git and points the requester at the authorize page when none is issued', async () => {
    mutate.mockResolvedValue({
      authorizeUrl: 'https://app.example.com/api/webhooks/github/authorize',
      message: 'Connect your GitHub account to LobeHub to push from a shared device.',
      ok: false,
      reason: 'not_authorized',
    });

    const result = await run('get', request, { LOBEHUB_JWT: 'jwt-op' });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('quit=1\n');
    expect(result.stderr).toContain('Connect your GitHub account to LobeHub');
    expect(result.stderr).toContain('https://app.example.com/api/webhooks/github/authorize');
  });

  it('stops git when the exchange is refused outright', async () => {
    mutate.mockRejectedValue(new Error('Operation token does not grant this request'));

    const result = await run('get', request, { LOBEHUB_JWT: 'jwt-op' });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('quit=1\n');
    expect(result.stderr).toContain('Operation token does not grant this request');
  });

  it('prefers the renewing credential JWT file over the spawn-time token', async () => {
    mutate.mockResolvedValue({ ok: false, message: 'm', reason: 'unavailable' });
    const jwtFile = path.join(mkdtempSync(path.join(tmpdir(), 'lh-cred-')), 'jwt');
    writeFileSync(jwtFile, 'jwt-renewed\n');

    await run('get', request, { LOBEHUB_JWT: 'jwt-spawned', LOBEHUB_SCM_JWT_FILE: jwtFile });

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ token: 'jwt-renewed' }));
  });

  it('refuses outside a run instead of falling back to the device login', async () => {
    const result = await run('get', request, {});

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('quit=1\n');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('stays silent for hosts other than github.com', async () => {
    const result = await run('get', 'protocol=https\nhost=gitlab.com\n\n', {
      LOBEHUB_JWT: 'jwt-op',
    });

    expect(result).toEqual({ code: 0, stderr: '', stdout: '' });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('ignores store and erase, since the token lives on the server', async () => {
    await expect(run('store', request, { LOBEHUB_JWT: 'jwt-op' })).resolves.toEqual({
      code: 0,
      stderr: '',
      stdout: '',
    });
    await expect(run('erase', request, { LOBEHUB_JWT: 'jwt-op' })).resolves.toMatchObject({
      code: 0,
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
