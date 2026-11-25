import { describe, expect, it, vi } from 'vitest';

import { buildLhHeteroExecEnv } from '@/modules/heterogeneousAgent/lhHeteroExecEnv';

import { executeGatewayAgentRun, type GatewayAgentRunDeps } from './gatewayAgentRun';

vi.mock('@/modules/cliEmbedding', () => ({
  withEmbeddedCliEnv: (env: Record<string, string | undefined>) => env,
}));

const TOKEN = 'sk-ant-oat01-installed-token';

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
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
  });
});
