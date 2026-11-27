import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentRunCredential } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentCredentialSpawnEnv, resolveRunCredentialSpawnEnv } from './spawnEnv';
import { installAgentCredential } from './store';

const INSTALLED_TOKEN = 'sk-ant-oat01-installed-token-value';
const RUN_TOKEN = 'sk-ant-oat01-run-token-value';
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

const OVERRIDDEN_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
];

let tempDir: string;
let rootDir: string;
const options = () => ({ homeDir: tempDir, inheritedEnv: {}, now: () => NOW, rootDir });
const configDir = () => path.join(rootDir, 'claude-code', 'config');

const runCredential = (expiresAt = '2026-07-01T00:00:00.000Z'): AgentRunCredential => ({
  provider: 'claude-code',
  secret: { expiresAt, token: RUN_TOKEN, type: 'claude-oauth-token' },
});

/** Every file under `dir`, recursively, with its contents. */
const readTree = async (dir: string): Promise<string> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const contents = await Promise.all(
    files.map((entry) => readFile(path.join(entry.parentPath, entry.name), 'utf8')),
  );
  return contents.join('\n');
};

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'lh-run-cred-'));
  rootDir = path.join(tempDir, 'agent-credentials');
});

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true });
});

describe('resolveRunCredentialSpawnEnv', () => {
  it('spawns Claude Code on the run token in the managed config dir', async () => {
    const result = await resolveRunCredentialSpawnEnv('claude-code', runCredential(), options());

    expect(result).toEqual({
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: RUN_TOKEN,
        CLAUDE_CONFIG_DIR: configDir(),
      },
      kind: 'spawn',
      unsetEnv: OVERRIDDEN_ENV,
    });
    expect((await stat(configDir())).isDirectory()).toBe(true);
  });

  it('never writes the run token to disk', async () => {
    // Seed a user settings file so the profile seeding actually writes files.
    await mkdir(path.join(tempDir, '.claude'), { recursive: true });
    await writeFile(path.join(tempDir, '.claude', 'settings.json'), '{"theme":"dark"}');

    await resolveRunCredentialSpawnEnv('claude-code', runCredential(), options());

    expect(await readTree(rootDir)).not.toContain(RUN_TOKEN);
    // No installed credential appears: a later run without one stays on the device login.
    expect((await resolveAgentCredentialSpawnEnv('claude-code', options())).kind).toBe('none');
  });

  it.skipIf(process.platform === 'win32')('keeps the profile dirs owner-only', async () => {
    await resolveRunCredentialSpawnEnv('claude-code', runCredential(), options());

    expect((await stat(rootDir)).mode & 0o777).toBe(0o700);
    expect((await stat(configDir())).mode & 0o777).toBe(0o700);
  });

  it('takes precedence over an installed credential', async () => {
    await installAgentCredential(
      {
        provider: 'claude-code',
        secret: {
          expiresAt: '2026-07-01T00:00:00.000Z',
          token: INSTALLED_TOKEN,
          type: 'claude-oauth-token',
        },
      },
      { rootDir },
    );

    const result = await resolveRunCredentialSpawnEnv('claude-code', runCredential(), options());

    expect(result.kind === 'spawn' && result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(RUN_TOKEN);
  });

  it('rejects an expired run credential without naming the token', async () => {
    const result = await resolveRunCredentialSpawnEnv(
      'claude-code',
      runCredential('2026-05-31T23:59:59.000Z'),
      options(),
    );

    expect(result.kind).toBe('reject');
    expect(result.kind === 'reject' && result.reason).toContain('expired at 2026-05-31T23:59:59');
    expect(JSON.stringify(result)).not.toContain(RUN_TOKEN);
  });

  it.each([
    ['an unparsable expiry', { ...runCredential().secret, expiresAt: 'soon' }],
    ['an empty token', { ...runCredential().secret, token: '  ' }],
    ['another secret type', { authJson: '{}', type: 'codex-auth-json' }],
  ])('rejects a run credential with %s', async (_label, secret) => {
    const result = await resolveRunCredentialSpawnEnv(
      'claude-code',
      { provider: 'claude-code', secret } as unknown as AgentRunCredential,
      options(),
    );

    expect(result.kind).toBe('reject');
    expect(JSON.stringify(result)).not.toContain(RUN_TOKEN);
  });

  it('ignores a missing credential and other agent types', async () => {
    expect(await resolveRunCredentialSpawnEnv('claude-code', undefined, options())).toEqual({
      kind: 'none',
    });
    expect(await resolveRunCredentialSpawnEnv('codex', runCredential(), options())).toEqual({
      kind: 'none',
    });
  });
});

describe('resolveAgentCredentialSpawnEnv (installed Claude Code credential)', () => {
  it('also scrubs the token from Claude Code subprocesses', async () => {
    await installAgentCredential(
      {
        provider: 'claude-code',
        secret: {
          expiresAt: '2026-07-01T00:00:00.000Z',
          token: INSTALLED_TOKEN,
          type: 'claude-oauth-token',
        },
      },
      { rootDir },
    );

    expect(await resolveAgentCredentialSpawnEnv('claude-code', options())).toEqual({
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: INSTALLED_TOKEN,
        CLAUDE_CONFIG_DIR: configDir(),
      },
      kind: 'spawn',
      unsetEnv: OVERRIDDEN_ENV,
    });
  });
});
