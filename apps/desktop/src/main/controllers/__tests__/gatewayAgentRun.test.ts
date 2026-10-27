import { describe, expect, it, vi } from 'vitest';

import { executeGatewayAgentRun, type GatewayAgentRunDeps } from '../gatewayAgentRun';

const createDeps = (ctr: Partial<GatewayAgentRunDeps['heterogeneousAgentCtr']> = {}) =>
  ({
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    getServerUrl: vi.fn().mockResolvedValue('https://app.lobehub.com'),
    heterogeneousAgentCtr: {
      getClaudeCodeInheritedRoutingEnv: vi.fn().mockResolvedValue({}),
      listClaudeCodeAccounts: vi.fn().mockResolvedValue([]),
      resolveClaudeCodeAccount: vi.fn().mockResolvedValue({ kind: 'missing' }),
      spawnLhHeteroExec: vi.fn().mockResolvedValue({ status: 'accepted' }),
      ...ctr,
    },
    platformTasks: new Map(),
  }) as unknown as GatewayAgentRunDeps;

const request = (extra: Record<string, unknown> = {}) =>
  ({
    agentType: 'claude-code',
    jwt: 'dispatch-jwt',
    operationId: 'op-1',
    prompt: 'hi',
    topicId: 'topic-1',
    type: 'agent_run_request',
    ...extra,
  }) as Parameters<typeof executeGatewayAgentRun>[0];

describe('executeGatewayAgentRun Claude Code account routing', () => {
  it('spawns an unrouted run without reading the local logins', async () => {
    const deps = createDeps();

    expect(await executeGatewayAgentRun(request(), deps)).toEqual({ status: 'accepted' });
    expect(deps.heterogeneousAgentCtr.listClaudeCodeAccounts).not.toHaveBeenCalled();
    expect(deps.heterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
      expect.objectContaining({ accountEnv: {}, jwt: 'access-token' }),
    );
  });

  it('spawns a routed run on the profile of its account', async () => {
    const deps = createDeps({
      listClaudeCodeAccounts: vi.fn().mockResolvedValue([
        { configDir: null, identity: { externalAccountId: 'acc-default' } },
        { configDir: '/profiles/acc-pinned', identity: { externalAccountId: 'acc-pinned' } },
      ]),
      resolveClaudeCodeAccount: vi
        .fn()
        .mockResolvedValue({ configDir: '/profiles/acc-pinned', kind: 'profile' }),
    });

    await executeGatewayAgentRun(
      request({
        claudeAccountRouting: { candidates: [{ externalAccountId: 'acc-pinned' }], mode: 'pinned' },
      }),
      deps,
    );

    expect(deps.heterogeneousAgentCtr.spawnLhHeteroExec).toHaveBeenCalledWith(
      expect.objectContaining({ accountEnv: { CLAUDE_CONFIG_DIR: '/profiles/acc-pinned' } }),
    );
  });

  it('rejects a run pinned to an account this desktop is not signed in to', async () => {
    const deps = createDeps({
      listClaudeCodeAccounts: vi
        .fn()
        .mockResolvedValue([{ configDir: null, identity: { externalAccountId: 'acc-default' } }]),
    });

    const ack = await executeGatewayAgentRun(
      request({
        claudeAccountRouting: {
          candidates: [{ externalAccountId: 'acc-pinned', name: 'pinned@example.com' }],
          mode: 'pinned',
        },
      }),
      deps,
    );

    expect(ack).toEqual({
      reason: expect.stringContaining('pinned@example.com'),
      status: 'rejected',
    });
    expect(deps.heterogeneousAgentCtr.spawnLhHeteroExec).not.toHaveBeenCalled();
  });
});
