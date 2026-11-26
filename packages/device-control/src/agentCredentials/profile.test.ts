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

  it('drops custom provider routing so the run bills the installed login', () => {
    const config = buildManagedCodexConfig(
      [
        'model = "gpt-5"',
        'model_provider = "proxy"',
        'profile = "work"',
        'model_providers.inline.base_url = "https://inline"',
        '',
        '[model_providers.proxy]',
        'base_url = "https://proxy.example"',
        'env_key = "PROXY_KEY"',
        'requires_openai_auth = false',
        '',
        '[profiles.work]',
        'model = "o3"',
        'model_provider = "proxy"',
        '',
        '[mcp_servers.docs]',
        'command = "docs-mcp"',
      ].join('\n'),
    );

    expect(config).not.toMatch(/proxy|inline|env_key|requires_openai_auth|profile =/);
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain('[profiles.work]\nmodel = "o3"');
    expect(config).toContain('[mcp_servers.docs]\ncommand = "docs-mcp"');
  });

  it('treats quoted and dotted keys like their bare form', () => {
    const config = buildManagedCodexConfig(
      [
        '"model_provider" = "evil"',
        '"cli_auth_credentials_store" = "keyring"',
        'profiles.work.model_provider = "evil"',
        "'model_providers'.inline.base_url = 'https://inline'",
        'model = "gpt-5"',
        '',
        '[profiles]',
        'home.model_provider = "evil"',
        'home.model = "o3"',
        '',
        '["model_providers".evil]',
        'base_url = "https://evil.example"',
      ].join('\n'),
    );

    expect(config).not.toMatch(/evil|inline|keyring/);
    expect(config.match(/cli_auth_credentials_store/g)).toHaveLength(1);
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain('home.model = "o3"');
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

describe('instruction copies on Windows', () => {
  const platform = process.platform;
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });

  const userAgents = () => path.join(home, '.codex', 'AGENTS.md');
  const managedAgents = () => path.join(managed, 'AGENTS.md');
  const seed = () => seedCodexProfile(managed, { env: {}, homeDir: home });

  beforeEach(async () => {
    await mkdir(path.join(home, '.codex'), { recursive: true });
    await writeFile(userAgents(), '# v1');
  });

  it('refreshes an untouched copy and drops it when the source goes away', async () => {
    await seed();
    expect(await readFile(managedAgents(), 'utf8')).toBe('# v1');

    await writeFile(userAgents(), '# v2');
    await seed();
    expect(await readFile(managedAgents(), 'utf8')).toBe('# v2');

    await rm(userAgents());
    await seed();
    await expect(lstat(managedAgents())).rejects.toThrow();
  });

  it('keeps a copy the agent edited', async () => {
    await seed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(managedAgents(), '# edited by the agent');

    await writeFile(userAgents(), '# v2');
    await seed();
    expect(await readFile(managedAgents(), 'utf8')).toBe('# edited by the agent');
  });
});
