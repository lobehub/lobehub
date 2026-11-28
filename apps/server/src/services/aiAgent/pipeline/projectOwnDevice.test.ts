import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectFallsBackToSandbox, withProjectSandboxFallback } from './projectOwnDevice';

const { onlineDevices } = vi.hoisted(() => ({ onlineDevices: vi.fn() }));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: onlineDevices,
}));

const claudeCode = {
  boundDeviceId: 'dev-1',
  executionTarget: 'device' as const,
  heterogeneousProvider: { type: 'claude-code' as const },
};
const base = {
  agencyConfig: claudeCode,
  boundDeviceId: undefined,
  interactive: true,
  projectId: 'prj',
  requestedDeviceId: undefined,
};

describe('projectFallsBackToSandbox', () => {
  it('may fall back for a project conversation without a directory of a Claude Code agent', () => {
    expect(projectFallsBackToSandbox(base)).toBe(true);
  });

  it('keeps a conversation already on a machine, or outside a project', () => {
    expect(projectFallsBackToSandbox({ ...base, boundDeviceId: 'dev-1' })).toBe(false);
    expect(projectFallsBackToSandbox({ ...base, requestedDeviceId: 'dev-2' })).toBe(false);
    expect(projectFallsBackToSandbox({ ...base, projectId: undefined })).toBe(false);
  });

  it('leaves tasks, device-only providers and regular agents on their own target', () => {
    expect(projectFallsBackToSandbox({ ...base, interactive: false })).toBe(false);
    expect(
      projectFallsBackToSandbox({
        ...base,
        agencyConfig: { ...claudeCode, heterogeneousProvider: { type: 'cursor' as const } },
      }),
    ).toBe(false);
    expect(
      projectFallsBackToSandbox({
        ...base,
        agencyConfig: { boundDeviceId: 'dev-1', executionTarget: 'device' },
      }),
    ).toBe(false);
  });
});

describe('withProjectSandboxFallback', () => {
  const topicModel = { findById: vi.fn(), updateMetadata: vi.fn() };
  const deps = { db: {} as never, topicModel: topicModel as never, userId: 'u', workspaceId: 'w' };
  const turn = { boundDeviceId: undefined, projectId: 'prj', topicId: 'tpc' };
  const chat = { trigger: 'chat' };
  const target = (run: object = chat) =>
    withProjectSandboxFallback(deps, run, { agencyConfig: claudeCode }, turn).then(
      (config) => config?.executionTarget,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    topicModel.findById.mockResolvedValue({ id: 'tpc', metadata: {} });
    onlineDevices.mockResolvedValue([{ deviceId: 'dev-1', online: true }]);
  });

  // Lin (11-27): with no project folder on its device, the agent runs there in
  // its own working directory instead of being moved off the device.
  it('keeps the agent on its online device, in its own working directory', async () => {
    expect(await target()).toBe('device');
    expect(topicModel.updateMetadata).not.toHaveBeenCalled();
  });

  it('runs in the sandbox when the device is offline, and marks the conversation', async () => {
    onlineDevices.mockResolvedValue([{ deviceId: 'dev-1', online: false }]);

    expect(await target()).toBe('sandbox');
    expect(topicModel.updateMetadata).toHaveBeenCalledWith('tpc', {
      projectSandboxFallback: true,
    });
  });

  it('keeps a fallen-back conversation in the sandbox after its device returns', async () => {
    topicModel.findById.mockResolvedValue({ metadata: { projectSandboxFallback: true } });

    expect(await target()).toBe('sandbox');
  });

  it('keeps a conversation that already ran on the device there', async () => {
    onlineDevices.mockResolvedValue([]);
    topicModel.findById.mockResolvedValue({ metadata: { boundDeviceId: 'dev-1' } });

    expect(await target()).toBe('device');
  });

  // Review: a project channel's first run (no device picked) was forced into
  // the sandbox instead of running where the agent's own settings say.
  it('keeps runs another trigger started on the agent device', async () => {
    onlineDevices.mockResolvedValue([]);
    for (const trigger of ['channel', 'cron', undefined])
      expect(await target({ trigger })).toBe('device');
    expect(await target({ ...chat, operationTaskId: 'task' })).toBe('device');
  });
});
