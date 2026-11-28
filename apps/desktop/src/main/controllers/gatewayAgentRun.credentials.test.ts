import os from 'node:os';
import path from 'node:path';

import { resolveRunCredentialSpawnEnv } from '@lobechat/device-control/agent-credentials';
import { describe, expect, it, vi } from 'vitest';

import { buildLhHeteroExecEnv } from '@/modules/heterogeneousAgent/lhHeteroExecEnv';

import { executeGatewayAgentRun, type GatewayAgentRunDeps } from './gatewayAgentRun';

vi.mock('@/modules/cliEmbedding', () => ({
  withEmbeddedCliEnv: (env: Record<string, string | undefined>) => env,
}));

const TOKEN = 'sk-ant-oat01-installed-token';
/** Never created: a run credential for another agent writes nothing. */
const credentialRoot = path.join(os.tmpdir(), 'lh-run-cred-unused', 'store');

const createDeps = (
  credential: Awaited<ReturnType<NonNullable<GatewayAgentRunDeps['resolveAgentCredential']>>>,
) =>
  ({
    getServerUrl: vi.fn().mockResolvedValue('https://app.lobehub.com'),
    heterogeneousAgentCtr: {
      getClaudeCodeInheritedRoutingEnv: vi.fn().mockResolvedValue({}),
      listClaudeCodeAccounts: vi
        .fn()
        .mockResolvedValue([{ configDir: null, identity: { externalAccountId: 'acc-default' } }]),
      resolveClaudeCodeAccount: vi.fn().mockResolvedValue({ kind: 'missing' }),
      spawnLhHeteroExec: vi.fn().mockResolvedValue({ status: 'accepted' }),
    },
    platformTasks: new Map(),
    resolveAgentCredential: vi.fn().mockResolvedValue(credential),
  }) as unknown as GatewayAgentRunDeps;

const pinnedElsewhere = {
  agentType: 'claude-code',
  claudeAccountRouting: {
    candidates: [{ externalAccountId: 'acc-elsewhere', name: 'elsewhere@example.com' }],
    mode: 'pinned',
  },
  jwt: 'dispatch-jwt',
  operationId: 'op-1',
  prompt: 'hi',
  topicId: 'topic-1',
  type: 'agent_run_request',
} as unknown as Parameters<typeof executeGatewayAgentRun>[0];

describe('executeGatewayAgentRun with an installed agent credential', () => {
  it('runs on the installed credential ahead of account routing', async () => {
    const deps = createDeps({
      env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_CONFIG_DIR: '/store/claude-code/config' },
      kind: 'spawn',
      unsetEnv: ['ANTHROPIC_API_KEY'],
    });

    expect(await executeGatewayAgentRun(pinnedElsewhere, deps)).toEqual({ status: 'accepted' });
    expect(deps.heterogeneousAgentCtr.listClaudeCodeAccounts).not.toHaveBeenCalled();
    expect(deps.resolveAgentCredential).toHaveBeenCalledWith('claude-code');
    expect(deps.heterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
      expect.objectContaining({
        accountEnv: expect.objectContaining({
          CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
          CLAUDE_CONFIG_DIR: '/store/claude-code/config',
        }),
        accountUnsetEnv: ['ANTHROPIC_API_KEY'],
      }),
    );
  });

  it('rejects the run when the installed credential is unusable', async () => {
    const deps = createDeps({ kind: 'reject', reason: 'The credential expired.' });

    expect(await executeGatewayAgentRun(pinnedElsewhere, deps)).toEqual({
      reason: 'The credential expired.',
      status: 'rejected',
    });
    expect(deps.heterogeneousAgentCtr.spawnLhHeteroExec).not.toHaveBeenCalled();
  });

  it('falls back to account routing when nothing is installed', async () => {
    const deps = createDeps({ kind: 'none' });

    const ack = await executeGatewayAgentRun(pinnedElsewhere, deps);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('elsewhere@example.com');
  });
});

describe('executeGatewayAgentRun with a run credential', () => {
  const RUN_TOKEN = 'sk-ant-oat01-run-token';
  const runCredential = {
    provider: 'claude-code' as const,
    secret: {
      expiresAt: '2026-12-01T00:00:00.000Z',
      token: RUN_TOKEN,
      type: 'claude-oauth-token' as const,
    },
  };
  const withRunCredential = { ...pinnedElsewhere, runCredential } as typeof pinnedElsewhere;
  const runEnv = {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: RUN_TOKEN,
      CLAUDE_CONFIG_DIR: '/store/claude-code/config',
    },
    kind: 'spawn' as const,
    unsetEnv: ['ANTHROPIC_API_KEY'],
  };

  it('spawns on the run credential ahead of an installed one and account routing', async () => {
    const deps = createDeps({
      env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, CLAUDE_CONFIG_DIR: '/store/claude-code/config' },
      kind: 'spawn',
      unsetEnv: [],
    });
    deps.resolveRunCredential = vi.fn().mockResolvedValue(runEnv);

    expect(await executeGatewayAgentRun(withRunCredential, deps)).toEqual({ status: 'accepted' });
    expect(deps.resolveRunCredential).toHaveBeenCalledWith('claude-code', runCredential);
    expect(deps.resolveAgentCredential).not.toHaveBeenCalled();
    expect(deps.heterogeneousAgentCtr.listClaudeCodeAccounts).not.toHaveBeenCalled();
    const spawnParams = vi.mocked(deps.heterogeneousAgentCtr.spawnLhHeteroExec).mock.calls[0][0];
    expect(spawnParams).toMatchObject({
      accountEnv: runEnv.env,
      accountUnsetEnv: ['ANTHROPIC_API_KEY'],
    });
    // The token reaches the child's env only, not a param that could be persisted.
    const { accountEnv: _env, ...rest } = spawnParams;
    expect(JSON.stringify(rest)).not.toContain(RUN_TOKEN);
  });

  it('rejects the run when the run credential is unusable, without falling back', async () => {
    const deps = createDeps({ kind: 'none' });
    deps.resolveRunCredential = vi
      .fn()
      .mockResolvedValue({ kind: 'reject', reason: 'The run credential expired.' });

    expect(await executeGatewayAgentRun(withRunCredential, deps)).toEqual({
      reason: 'The run credential expired.',
      status: 'rejected',
    });
    expect(deps.resolveAgentCredential).not.toHaveBeenCalled();
    expect(deps.heterogeneousAgentCtr.spawnLhHeteroExec).not.toHaveBeenCalled();
  });

  it('resolves the real run credential env for Claude Code only', async () => {
    const deps = createDeps({ kind: 'none' });
    deps.resolveRunCredential = (agentType, credential) =>
      resolveRunCredentialSpawnEnv(agentType, credential, {
        homeDir: '/nonexistent-home',
        inheritedEnv: {},
        rootDir: credentialRoot,
      });

    const codexRun = {
      ...withRunCredential,
      agentType: 'codex',
      claudeAccountRouting: undefined,
    } as typeof withRunCredential;
    expect(await executeGatewayAgentRun(codexRun, deps)).toEqual({ status: 'accepted' });
    expect(deps.resolveAgentCredential).toHaveBeenCalledWith('codex');
    const codexEnv = vi.mocked(deps.heterogeneousAgentCtr.spawnLhHeteroExec).mock.calls[0][0]
      .accountEnv as Record<string, string>;
    expect(codexEnv).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });
});

describe('buildLhHeteroExecEnv', () => {
  it('drops inherited env that would outrank the installed credential', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-local');
    const env = buildLhHeteroExecEnv({
      accountEnv: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
      accountUnsetEnv: ['ANTHROPIC_API_KEY'],
      jwt: 'jwt',
      operationId: 'op',
      proxyEnv: {},
      serverUrl: 'https://app.lobehub.com',
      topicId: 'tpc',
    });
    vi.unstubAllEnvs();

    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  });
});
