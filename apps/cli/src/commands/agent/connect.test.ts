import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatModule from '../../utils/format';
import { log } from '../../utils/logger';
import { registerAgentConnectCommand } from './connect';

const { mockTrpcClient, mockConfirm, mockWorkspaceId } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockTrpcClient: {
    agent: { createAgent: { mutate: vi.fn() }, getAgentConfigById: { query: vi.fn() } },
    device: {
      getAgentProfile: { query: vi.fn() },
      getDeviceActivity: { query: vi.fn() },
      listDevices: { query: vi.fn() },
      scanAgents: { query: vi.fn() },
    },
    user: { getUserState: { query: vi.fn() } },
  },
  mockWorkspaceId: { current: undefined as string | undefined },
}));

vi.mock('../../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));
vi.mock('../../api/workspace', () => ({ resolveWorkspaceId: () => mockWorkspaceId.current }));
vi.mock('../../device/register', () => ({
  resolveDeviceIdentity: (userId?: string) =>
    userId ? { deviceId: `personal-${userId}`, identitySource: 'machine' } : undefined,
  resolveWorkspaceDeviceIdentity: (workspaceId: string) => ({
    deviceId: `ws-${workspaceId}`,
    identitySource: 'machine',
  }),
}));
vi.mock('../../settings', () => ({ loadOrCreateConnectionId: () => 'conn-1' }));
vi.mock('../task/url', () => ({
  resolveAppUrlBuilder: async () => (path: string) => `https://app.test${path}`,
}));
vi.mock('../../utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof FormatModule>()),
  confirm: mockConfirm,
}));

const PERSONAL_DEVICE = {
  deviceId: 'personal-u1',
  hostname: 'mac',
  online: true,
  scope: 'personal',
};
const WORKSPACE_DEVICE = { deviceId: 'ws-ws1', hostname: 'mac', online: true, scope: 'workspace' };

describe('agent connect', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceId.current = undefined;
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    mockTrpcClient.user.getUserState.query.mockResolvedValue({ fullName: 'Arvin', userId: 'u1' });
    mockTrpcClient.device.listDevices.query.mockResolvedValue([PERSONAL_DEVICE, WORKSPACE_DEVICE]);
    mockTrpcClient.device.scanAgents.query.mockResolvedValue({
      agents: {
        'antigravity': { available: true, version: '1.5.14' },
        'claude-code': { available: true, version: '2.0.0' },
        'codex': { available: false, reason: 'codex not found' },
      },
    });
    mockTrpcClient.device.getDeviceActivity.query.mockResolvedValue({ agents: [] });
    let n = 0;
    mockTrpcClient.agent.createAgent.mutate.mockImplementation(async () => ({
      agentId: `agt_${++n}`,
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerAgentConnectCommand(program.command('agent'));
    return program.parseAsync(['node', 'test', 'agent', 'connect', ...args]).catch(() => {});
  };

  const createdConfigs = () =>
    mockTrpcClient.agent.createAgent.mutate.mock.calls.map(([input]) => input);

  it('binds a named agent to this machine with the wizard config', async () => {
    await run('antigravity', '--yes');

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockTrpcClient.device.scanAgents.query).toHaveBeenCalledWith({
      deviceId: 'personal-u1',
    });
    expect(createdConfigs()).toEqual([
      {
        config: expect.objectContaining({
          agencyConfig: {
            boundDeviceId: 'personal-u1',
            executionTarget: 'device',
            heterogeneousProvider: { command: 'agy', type: 'antigravity' },
          },
          name: 'Antigravity',
          provider: 'antigravity',
          title: 'Antigravity',
        }),
      },
    ]);
  });

  it('connects every available agent when no type is named', async () => {
    await run('--yes');

    expect(createdConfigs().map((input) => input.config.provider)).toEqual([
      'antigravity',
      'claude-code',
    ]);
  });

  it('binds the workspace device and prefixes a shared agent with its owner', async () => {
    mockWorkspaceId.current = 'ws1';

    await run('claude-code', '--visibility', 'public', '--yes');

    expect(createdConfigs()).toEqual([
      {
        config: expect.objectContaining({
          agencyConfig: expect.objectContaining({ boundDeviceId: 'ws-ws1' }),
          name: 'Arvin’s Claude Code',
        }),
        visibility: 'public',
      },
    ]);
  });

  it('refuses a personal device inside a workspace', async () => {
    mockWorkspaceId.current = 'ws1';
    mockTrpcClient.device.listDevices.query.mockResolvedValue([PERSONAL_DEVICE]);

    await run('antigravity', '--yes');

    expect(errorSpy).toHaveBeenCalledWith('This machine is not connected to workspace ws1.');
    expect(mockTrpcClient.device.scanAgents.query).not.toHaveBeenCalled();
    expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
  });

  it('fails when the named agent is not installed on the device', async () => {
    await run('codex', '--yes');

    expect(errorSpy).toHaveBeenCalledWith('Codex was not found on the device: codex not found');
    expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
  });

  it('fails on an offline device before scanning', async () => {
    mockTrpcClient.device.listDevices.query.mockResolvedValue([
      { ...PERSONAL_DEVICE, online: false },
    ]);

    await run('antigravity', '--yes');

    expect(errorSpy).toHaveBeenCalledWith('Device mac is offline.');
    expect(mockTrpcClient.device.scanAgents.query).not.toHaveBeenCalled();
  });

  it('creates nothing when the confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false);

    await run('antigravity');

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockTrpcClient.agent.createAgent.mutate).not.toHaveBeenCalled();
  });

  it('skips agent types already connected to the device', async () => {
    mockTrpcClient.device.getDeviceActivity.query.mockResolvedValue({
      agents: [{ id: 'agt_old' }],
    });
    mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
      agencyConfig: { heterogeneousProvider: { type: 'antigravity' } },
      userId: 'u1',
    });
    const jsonSpy = vi.fn();
    consoleSpy.mockImplementation(jsonSpy);

    await run('--yes', '--json');

    expect(createdConfigs().map((input) => input.config.provider)).toEqual(['claude-code']);
    expect(JSON.parse(jsonSpy.mock.calls[0][0])).toEqual({
      created: [expect.objectContaining({ id: 'agt_1', type: 'claude-code', version: '2.0.0' })],
      deviceId: 'personal-u1',
      skipped: [{ id: 'agt_old', title: 'Antigravity', type: 'antigravity' }],
    });
  });

  it("does not skip a teammate's agent on a shared device", async () => {
    mockTrpcClient.device.getDeviceActivity.query.mockResolvedValue({
      agents: [{ id: 'agt_ann' }],
    });
    mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
      agencyConfig: { heterogeneousProvider: { type: 'antigravity' } },
      userId: 'ann',
    });

    await run('antigravity', '--yes');

    expect(createdConfigs()).toHaveLength(1);
  });

  it('still connects when the existing-agent lookup fails', async () => {
    mockTrpcClient.device.getDeviceActivity.query.mockRejectedValue(new Error('boom'));

    await run('antigravity', '--yes');

    expect(createdConfigs()).toHaveLength(1);
  });

  it('rejects an unknown type before touching the network', async () => {
    await run('claud', '--yes');

    expect(errorSpy).toHaveBeenCalledWith('Unknown agent type: claud');
    expect(mockTrpcClient.device.listDevices.query).not.toHaveBeenCalled();
  });

  it('binds an explicit --device of the current pool', async () => {
    const other = { deviceId: 'dev-2', friendlyName: 'Build box', online: true, scope: 'personal' };
    mockTrpcClient.device.listDevices.query.mockResolvedValue([PERSONAL_DEVICE, other]);

    await run('antigravity', '--device', 'dev-2', '--yes');

    expect(mockTrpcClient.device.scanAgents.query).toHaveBeenCalledWith({ deviceId: 'dev-2' });
    expect(createdConfigs()[0].config.agencyConfig.boundDeviceId).toBe('dev-2');
  });

  it('prefills a platform agent from its device profile', async () => {
    mockTrpcClient.device.scanAgents.query.mockResolvedValue({
      agents: { openclaw: { available: true } },
    });
    mockTrpcClient.device.getAgentProfile.query.mockResolvedValue({
      description: 'My claw',
      title: 'Clawd',
    });

    await run('openclaw', '--yes');

    expect(mockTrpcClient.device.getAgentProfile.query).toHaveBeenCalledWith({
      deviceId: 'personal-u1',
      platform: 'openclaw',
    });
    expect(createdConfigs()[0].config).toMatchObject({
      agencyConfig: {
        boundDeviceId: 'personal-u1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'openclaw' },
      },
      description: 'My claw',
      name: 'Clawd',
      title: 'Clawd',
    });
  });

  it('reports the agents created before a failure', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    mockTrpcClient.agent.createAgent.mutate
      .mockResolvedValueOnce({ agentId: 'agt_a' })
      .mockRejectedValueOnce(new Error('quota'));

    await run('--yes');

    expect(warnSpy).toHaveBeenCalledWith('Created before the failure: agt_a');
    expect(errorSpy).toHaveBeenCalledWith('Failed to create the Claude Code agent: quota');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects --name with several types', async () => {
    await run('antigravity', 'claude-code', '--name', 'Mine', '--yes');

    expect(errorSpy).toHaveBeenCalledWith(
      '--name and --description need exactly one agent type, e.g. lh agent connect codex',
    );
    expect(mockTrpcClient.device.listDevices.query).not.toHaveBeenCalled();
  });
});
