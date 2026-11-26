import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentCredentialSpawnEnv } from './spawnEnv';
import {
  installAgentCredential,
  readInstalledAgentCredential,
  removeAgentCredential,
} from './store';

const TOKEN = 'sk-ant-oat01-secret-token-value';
const AUTH_JSON = JSON.stringify({
  tokens: { access_token: 'codex-access-token-value', refresh_token: 'codex-refresh-value' },
});
const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const posix = process.platform !== 'win32';

let tempDir: string;
let rootDir: string;
const options = () => ({ now: () => NOW, rootDir });
/** Seeding reads the user's config from here, never the real home. */
const spawnOptions = () => ({ ...options(), homeDir: tempDir, inheritedEnv: {} });

const claudeDir = () => path.join(rootDir, 'claude-code');
const codexDir = () => path.join(rootDir, 'codex');

const claudeParams = (expiresAt = '2026-07-01T00:00:00Z') => ({
  provider: 'claude-code',
  secret: { expiresAt, token: TOKEN, type: 'claude-oauth-token' },
});
const codexParams = { provider: 'codex', secret: { authJson: AUTH_JSON, type: 'codex-auth-json' } };

const mode = async (target: string) => (await stat(target)).mode & 0o777;
const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'lh-agent-cred-'));
  rootDir = path.join(tempDir, 'agent-credentials');
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe('installAgentCredential', () => {
  it('stores the Claude Code token owner-only and returns no secret', async () => {
    const result = await installAgentCredential(claudeParams(), options());
    expect(result).toEqual({ installed: true, provider: 'claude-code' });

    const metadataFile = path.join(claudeDir(), 'credential.json');
    const stored = JSON.parse(await readFile(metadataFile, 'utf8'));
    expect(stored).toMatchObject({
      expiresAt: '2026-07-01T00:00:00.000Z',
      provider: 'claude-code',
      token: TOKEN,
    });
    if (posix) {
      expect(await mode(rootDir)).toBe(0o700);
      expect(await mode(claudeDir())).toBe(0o700);
      expect(await mode(path.join(claudeDir(), 'config'))).toBe(0o700);
      expect(await mode(metadataFile)).toBe(0o600);
    }
  });

  it('writes the Codex auth.json into a managed CODEX_HOME owner-only', async () => {
    await installAgentCredential(codexParams, options());

    const authFile = path.join(codexDir(), 'home', 'auth.json');
    expect(await readFile(authFile, 'utf8')).toBe(AUTH_JSON);
    if (posix) {
      expect(await mode(path.join(codexDir(), 'home'))).toBe(0o700);
      expect(await mode(authFile)).toBe(0o600);
    }
  });

  it('replaces an earlier credential', async () => {
    await installAgentCredential(claudeParams('2026-06-15T00:00:00Z'), options());
    await installAgentCredential(claudeParams('2026-08-01T00:00:00Z'), options());

    const installed = await readInstalledAgentCredential('claude-code', options());
    expect(installed).toMatchObject({ expiresAt: '2026-08-01T00:00:00.000Z', status: 'installed' });
  });

  it('leaves no Codex secret behind when a first install fails half-way', async () => {
    // A directory where the metadata file goes makes its write fail.
    await mkdir(path.join(codexDir(), 'credential.json'), { recursive: true });

    await expect(installAgentCredential(codexParams, options())).rejects.toThrow();
    expect(await exists(path.join(codexDir(), 'home', 'auth.json'))).toBe(false);
  });

  it('keeps the earlier Codex login when a replacement fails half-way', async () => {
    await installAgentCredential(codexParams, options());
    // A directory where the metadata file goes makes the replacement's write fail.
    await rm(path.join(codexDir(), 'credential.json'));
    await mkdir(path.join(codexDir(), 'credential.json'));
    const replacement = JSON.stringify({ tokens: { access_token: 'replacement-token' } });

    await expect(
      installAgentCredential(
        { provider: 'codex', secret: { authJson: replacement, type: 'codex-auth-json' } },
        options(),
      ),
    ).rejects.toThrow();
    expect(await readFile(path.join(codexDir(), 'home', 'auth.json'), 'utf8')).toBe(AUTH_JSON);
  });

  it.each([
    [{ provider: 'gemini', secret: { token: TOKEN, type: 'claude-oauth-token' } }, 'provider'],
    [{ provider: 'codex', secret: claudeParams().secret }, 'codex-auth-json'],
    [{ provider: 'claude-code', secret: { ...claudeParams().secret, expiresAt: 'soon' } }, 'ISO'],
    [{ provider: 'claude-code', secret: { ...claudeParams().secret, token: ' ' } }, 'token'],
    [
      { provider: 'codex', secret: { authJson: `{"tokens": "${TOKEN}"`, type: 'codex-auth-json' } },
      'JSON',
    ],
  ])('rejects invalid params without echoing the secret (%#)', async (params, field) => {
    const error = await installAgentCredential(params, options()).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(field);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

describe('removeAgentCredential', () => {
  it('deletes only the secrets, keeps the profile, then reports nothing to remove', async () => {
    await installAgentCredential(codexParams, options());
    const session = path.join(codexDir(), 'home', 'sessions', 'run.jsonl');
    await mkdir(path.dirname(session), { recursive: true });
    await writeFile(session, '{}');

    expect(await removeAgentCredential({ provider: 'codex' }, options())).toEqual({
      removed: true,
    });
    expect(await exists(path.join(codexDir(), 'home', 'auth.json'))).toBe(false);
    expect(await exists(path.join(codexDir(), 'credential.json'))).toBe(false);
    expect(await exists(session)).toBe(true);
    expect(await readInstalledAgentCredential('codex', options())).toEqual({ status: 'missing' });

    expect(await removeAgentCredential({ provider: 'codex' }, options())).toEqual({
      removed: false,
    });
  });

  it('keeps the Claude Code profile (transcripts, memory)', async () => {
    await installAgentCredential(claudeParams(), options());
    const transcript = path.join(claudeDir(), 'config', 'projects', 'p', 't.jsonl');
    await mkdir(path.dirname(transcript), { recursive: true });
    await writeFile(transcript, '{}');

    expect(await removeAgentCredential({ provider: 'claude-code' }, options())).toEqual({
      removed: true,
    });
    expect(await exists(transcript)).toBe(true);
    expect((await resolveAgentCredentialSpawnEnv('claude-code', spawnOptions())).kind).toBe('none');
  });

  it('is a no-op on a device that never stored anything', async () => {
    expect(await removeAgentCredential({ provider: 'claude-code' }, options())).toEqual({
      removed: false,
    });
  });
});

describe('resolveAgentCredentialSpawnEnv', () => {
  it('ignores agents and providers without an installed credential', async () => {
    expect(await resolveAgentCredentialSpawnEnv('claude-code', spawnOptions())).toEqual({
      kind: 'none',
    });
    expect(await resolveAgentCredentialSpawnEnv('kimi-code', spawnOptions())).toEqual({
      kind: 'none',
    });
  });

  it('rejects an expired Claude Code credential without naming the token', async () => {
    await installAgentCredential(claudeParams('2026-05-01T00:00:00Z'), options());

    const result = await resolveAgentCredentialSpawnEnv('claude-code', spawnOptions());
    expect(result.kind).toBe('reject');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('rejects a Codex install that lost its auth.json', async () => {
    await installAgentCredential(codexParams, options());
    await rm(path.join(codexDir(), 'home', 'auth.json'));

    expect((await resolveAgentCredentialSpawnEnv('codex', spawnOptions())).kind).toBe('reject');
  });

  it('rejects a Codex auth.json without its metadata instead of ignoring it', async () => {
    await installAgentCredential(codexParams, options());
    await rm(path.join(codexDir(), 'credential.json'));

    expect(await readInstalledAgentCredential('codex', options())).toEqual({ status: 'invalid' });
    expect((await resolveAgentCredentialSpawnEnv('codex', spawnOptions())).kind).toBe('reject');
  });
});
