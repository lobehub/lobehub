import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildManagedCodexConfig, seedClaudeProfile, seedCodexProfile } from './profile';

let home: string;
let managed: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'lh-agent-profile-'));
  managed = path.join(home, 'managed');
  await mkdir(managed, { recursive: true });
});

afterEach(async () => {
  await rm(home, { force: true, recursive: true });
});

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

describe('seedClaudeProfile', () => {
  beforeEach(async () => {
    const userDir = path.join(home, '.claude');
    await mkdir(path.join(userDir, 'skills', 'my-skill'), { recursive: true });
    await writeFile(path.join(userDir, 'CLAUDE.md'), '# mine');
    await writeFile(
      path.join(userDir, 'settings.json'),
      JSON.stringify({
        apiKeyHelper: '/bin/print-key',
        env: { ANTHROPIC_BASE_URL: 'https://proxy', MY_FLAG: '1' },
        model: 'opus',
      }),
    );
    await writeFile(
      path.join(userDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'local' } }),
    );
    await writeFile(
      path.join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: { docs: { command: 'docs-mcp' } },
        oauthAccount: { emailAddress: 'me@example.com' },
        projects: { '/repo': {} },
      }),
    );
  });

  it('copies settings without login helpers and links instructions and skills', async () => {
    await seedClaudeProfile(managed, { env: {}, homeDir: home });

    expect(await readJson(path.join(managed, 'settings.json'))).toEqual({
      env: { MY_FLAG: '1' },
      model: 'opus',
    });
    expect((await lstat(path.join(managed, 'CLAUDE.md'))).isSymbolicLink()).toBe(
      process.platform !== 'win32',
    );
    expect(await readFile(path.join(managed, 'CLAUDE.md'), 'utf8')).toBe('# mine');
    expect((await lstat(path.join(managed, 'skills', 'my-skill'))).isDirectory()).toBe(true);
    await expect(lstat(path.join(managed, '.credentials.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('carries only the user-scope MCP servers out of .claude.json', async () => {
    await writeFile(path.join(managed, '.claude.json'), JSON.stringify({ numStartups: 3 }));

    await seedClaudeProfile(managed, { env: {}, homeDir: home });

    expect(await readJson(path.join(managed, '.claude.json'))).toEqual({
      mcpServers: { docs: { command: 'docs-mcp' } },
      numStartups: 3,
    });
  });

  it('leaves entries the agent created in the profile alone', async () => {
    await mkdir(path.join(managed, 'plugins'), { recursive: true });
    await mkdir(path.join(home, '.claude', 'plugins'), { recursive: true });

    await seedClaudeProfile(managed, { env: {}, homeDir: home });

    expect((await lstat(path.join(managed, 'plugins'))).isDirectory()).toBe(true);
  });
});

describe('Codex profile', () => {
  it('drops login settings from the user config and pins the file store first', () => {
    const config = buildManagedCodexConfig(
      [
        'model = "gpt-5"',
        'cli_auth_credentials_store = "keyring"',
        'preferred_auth_method = "apikey"',
        '',
        '[mcp_servers.docs]',
        'command = "docs-mcp"',
      ].join('\n'),
    );

    expect(config).toBe(
      [
        'cli_auth_credentials_store = "file"',
        'model = "gpt-5"',
        '',
        '[mcp_servers.docs]',
        'command = "docs-mcp"',
        '',
      ].join('\n'),
    );
  });

  it('writes the pinned config even when the user has none', async () => {
    await seedCodexProfile(managed, { env: {}, homeDir: home });

    expect(await readFile(path.join(managed, 'config.toml'), 'utf8')).toBe(
      'cli_auth_credentials_store = "file"\n',
    );
  });

  it('seeds concurrent runs started in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-01T00:00:00.000Z'));
    try {
      await expect(
        Promise.all([
          seedCodexProfile(managed, { env: {}, homeDir: home }),
          seedCodexProfile(managed, { env: {}, homeDir: home }),
        ]),
      ).resolves.toBeDefined();
    } finally {
      vi.restoreAllMocks();
    }
    expect(await readFile(path.join(managed, 'config.toml'), 'utf8')).toBe(
      'cli_auth_credentials_store = "file"\n',
    );
  });

  it('seeds from CODEX_HOME when the user set one', async () => {
    const userHome = path.join(home, 'codex-home');
    await mkdir(userHome, { recursive: true });
    await writeFile(path.join(userHome, 'config.toml'), 'model = "o3"\n');
    await writeFile(path.join(userHome, 'AGENTS.md'), '# codex');

    await seedCodexProfile(managed, { env: { CODEX_HOME: userHome }, homeDir: home });

    expect(await readFile(path.join(managed, 'config.toml'), 'utf8')).toContain('model = "o3"');
    expect(await readFile(path.join(managed, 'AGENTS.md'), 'utf8')).toBe('# codex');
  });
});
