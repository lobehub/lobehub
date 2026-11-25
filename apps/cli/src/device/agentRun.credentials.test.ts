import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { installAgentCredential } from '@lobechat/device-control/agent-credentials';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroAgentRun } from './agentRun';

const { spawnMock, credentialRoot, identityMock, hasLoginMock } = vi.hoisted(() => ({
  credentialRoot: { dir: '' },
  hasLoginMock: vi.fn(),
  identityMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('./agentCredentials', () => ({ agentCredentialRootDir: () => credentialRoot.dir }));
vi.mock('@lobechat/heterogeneous-agents/quota-sampler', () => ({
  hasClaudeCodeLogin: hasLoginMock,
  readClaudeCodeIdentity: identityMock,
}));
vi.mock('../daemon/taskRegistry', () => ({
  getTask: vi.fn(),
  removeTask: vi.fn(),
  saveTask: vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, statSync: vi.fn() };
});

const TOKEN = 'sk-ant-oat01-installed-token-value';
const NOW = Date.parse('2026-06-01T00:00:00.000Z');

const makeFakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  };
  child.stdin = { end: vi.fn(), write: vi.fn() };
  return child;
};

const baseParams = {
  assistantMessageId: 'asst',
  jwt: 'jwt',
  operationId: 'op',
  prompt: 'hi',
  serverUrl: 'https://app.lobehub.com',
  topicId: 'tpc',
};

/** Run to the spawn and return the env the wrapper CLI got. */
const spawnedEnv = async (params: Parameters<typeof spawnHeteroAgentRun>[0]) => {
  const child = makeFakeChild();
  spawnMock.mockReturnValue(child);
  const ack = spawnHeteroAgentRun(params);
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
  child.emit('spawn');
  expect(await ack).toEqual({ status: 'accepted' });
  return spawnMock.mock.calls[0][2].env as Record<string, string | undefined>;
};

describe('spawnHeteroAgentRun with an installed agent credential', () => {
  beforeEach(async () => {
    credentialRoot.dir = await mkdtemp(path.join(os.tmpdir(), 'lh-agent-cred-run-'));
    // Profile seeding reads the user's own config from HOME: keep it hermetic.
    vi.stubEnv('HOME', credentialRoot.dir);
    vi.stubEnv('USERPROFILE', credentialRoot.dir);
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
    vi.stubEnv('CODEX_HOME', undefined);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    identityMock.mockResolvedValue({ externalAccountId: 'acc-default' });
    hasLoginMock.mockResolvedValue(true);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    spawnMock.mockReset();
    vi.unstubAllEnvs();
    await rm(credentialRoot.dir, { force: true, recursive: true });
  });

  const installClaude = (expiresAt: string) =>
    installAgentCredential(
      {
        provider: 'claude-code',
        secret: { expiresAt, token: TOKEN, type: 'claude-oauth-token' },
      },
      { rootDir: credentialRoot.dir },
    );

  it('runs Claude Code on the installed token in an isolated config dir', async () => {
    await installClaude('2026-07-01T00:00:00.000Z');
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/home/me/.claude-stale');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-local-api-key');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://proxy.example.com');

    const env = await spawnedEnv({ ...baseParams, agentType: 'claude-code' });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(credentialRoot.dir, 'claude-code', 'config'));
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
  });

  it('wins over Claude Code account routing, even a pin the device lacks', async () => {
    await installClaude('2026-07-01T00:00:00.000Z');

    const env = await spawnedEnv({
      ...baseParams,
      agentType: 'claude-code',
      claudeAccountRouting: {
        candidates: [{ externalAccountId: 'acc-elsewhere', name: 'elsewhere@example.com' }],
        mode: 'pinned',
      },
    });

    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(identityMock).not.toHaveBeenCalled();
  });

  it('rejects the run when the installed Claude Code credential has expired', async () => {
    await installClaude('2026-05-31T23:59:59.000Z');
    const error = vi.fn();

    const ack = await spawnHeteroAgentRun(
      { ...baseParams, agentType: 'claude-code' },
      { error, info: vi.fn() },
    );

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('expired at 2026-05-31T23:59:59.000Z');
    expect(ack.reason).not.toContain(TOKEN);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });

  it('points Codex at the managed CODEX_HOME', async () => {
    await installAgentCredential(
      {
        provider: 'codex',
        secret: {
          authJson: JSON.stringify({ tokens: { access_token: 'x' } }),
          type: 'codex-auth-json',
        },
      },
      { rootDir: credentialRoot.dir },
    );
    vi.stubEnv('CODEX_API_KEY', 'sk-local');

    const env = await spawnedEnv({ ...baseParams, agentType: 'codex' });

    expect(env.CODEX_HOME).toBe(path.join(credentialRoot.dir, 'codex', 'home'));
    expect(env).not.toHaveProperty('CODEX_API_KEY');
  });

  it('keeps the device login and account routing when nothing is installed', async () => {
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', undefined);
    const env = await spawnedEnv({
      ...baseParams,
      agentType: 'claude-code',
      claudeAccountRouting: { candidates: [{ externalAccountId: 'acc-default' }], mode: 'pinned' },
    });

    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(identityMock).toHaveBeenCalled();
  });
});
