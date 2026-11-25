import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentCredentialSpawnEnv } from './spawnEnv';
import {
  agentCredentialPaths,
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

let rootDir: string;
const options = () => ({ now: () => NOW, rootDir });

const claudeParams = (expiresAt = '2026-07-01T00:00:00Z') => ({
  provider: 'claude-code',
  secret: { expiresAt, token: TOKEN, type: 'claude-oauth-token' },
});
const codexParams = { provider: 'codex', secret: { authJson: AUTH_JSON, type: 'codex-auth-json' } };

const mode = async (target: string) => (await stat(target)).mode & 0o777;

beforeEach(async () => {
  rootDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'lh-agent-cred-')), 'agent-credentials');
});

afterEach(async () => {
  await rm(path.dirname(rootDir), { force: true, recursive: true });
});

describe('installAgentCredential', () => {
  it('stores the Claude Code token owner-only and returns no secret', async () => {
    const result = await installAgentCredential(claudeParams(), options());
    expect(result).toEqual({ installed: true, provider: 'claude-code' });

    const paths = agentCredentialPaths(rootDir, 'claude-code');
    const stored = JSON.parse(await readFile(paths.metadataFile, 'utf8'));
    expect(stored).toMatchObject({
      expiresAt: '2026-07-01T00:00:00.000Z',
      provider: 'claude-code',
      token: TOKEN,
    });
    if (posix) {
      expect(await mode(rootDir)).toBe(0o700);
      expect(await mode(paths.dir)).toBe(0o700);
      expect(await mode(paths.claudeConfigDir)).toBe(0o700);
      expect(await mode(paths.metadataFile)).toBe(0o600);
    }
  });

  it('writes the Codex auth.json into a managed CODEX_HOME owner-only', async () => {
    await installAgentCredential(codexParams, options());

    const { codexHome } = agentCredentialPaths(rootDir, 'codex');
    expect(await readFile(path.join(codexHome, 'auth.json'), 'utf8')).toBe(AUTH_JSON);
    expect(await readFile(path.join(codexHome, 'config.toml'), 'utf8')).toContain(
      'cli_auth_credentials_store = "file"',
    );
    if (posix) {
      expect(await mode(codexHome)).toBe(0o700);
      expect(await mode(path.join(codexHome, 'auth.json'))).toBe(0o600);
    }
  });

  it('replaces an earlier credential', async () => {
    await installAgentCredential(claudeParams('2026-06-15T00:00:00Z'), options());
    await installAgentCredential(claudeParams('2026-08-01T00:00:00Z'), options());

    const installed = await readInstalledAgentCredential('claude-code', options());
    expect(installed).toMatchObject({ expiresAt: '2026-08-01T00:00:00.000Z', status: 'installed' });
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
  it('deletes the credential and its managed config, then reports nothing to remove', async () => {
    await installAgentCredential(codexParams, options());

    expect(await removeAgentCredential({ provider: 'codex' }, options())).toEqual({
      removed: true,
    });
    await expect(stat(agentCredentialPaths(rootDir, 'codex').dir)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await removeAgentCredential({ provider: 'codex' }, options())).toEqual({
      removed: false,
    });
  });

  it('is a no-op on a device that never stored anything', async () => {
    expect(await removeAgentCredential({ provider: 'claude-code' }, options())).toEqual({
      removed: false,
    });
  });
});

describe('resolveAgentCredentialSpawnEnv', () => {
  it('ignores agents and providers without an installed credential', async () => {
    expect(await resolveAgentCredentialSpawnEnv('claude-code', options())).toEqual({
      kind: 'none',
    });
    expect(await resolveAgentCredentialSpawnEnv('kimi-code', options())).toEqual({ kind: 'none' });
  });

  it('rejects an expired Claude Code credential without naming the token', async () => {
    await installAgentCredential(claudeParams('2026-05-01T00:00:00Z'), options());

    const result = await resolveAgentCredentialSpawnEnv('claude-code', options());
    expect(result.kind).toBe('reject');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('rejects an unreadable credential instead of falling back', async () => {
    await installAgentCredential(codexParams, options());
    await rm(path.join(agentCredentialPaths(rootDir, 'codex').codexHome, 'auth.json'));

    expect((await resolveAgentCredentialSpawnEnv('codex', options())).kind).toBe('reject');
  });
});
