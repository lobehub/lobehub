// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { canPerformResourceAction, getResourceMeta } from '@/server/services/resourcePermission';

import {
  getResourceConfigAccess,
  redactAgentConfig,
  redactGroupConfig,
} from './resourceConfigGuard';
import { getWorkspaceAgentParentGroupIds } from './workspaceAgentGuard';

vi.mock('@/server/services/resourcePermission', () => ({
  canPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));
vi.mock('./workspaceAgentGuard', () => ({
  getWorkspaceAgentParentGroupIds: vi.fn(),
}));

const canPerformMock = vi.mocked(canPerformResourceAction);
const getResourceMetaMock = vi.mocked(getResourceMeta);
const getParentGroupIdsMock = vi.mocked(getWorkspaceAgentParentGroupIds);
const meta = { userId: 'creator', visibility: 'public', workspaceId: 'ws-1' };

const ctx = (workspaceId: string | null = 'ws-1') => ({
  db: {} as any,
  userId: 'member-1',
  workspaceId,
});

beforeEach(() => {
  vi.clearAllMocks();
  getResourceMetaMock.mockResolvedValue(meta);
  getParentGroupIdsMock.mockResolvedValue([]);
});

describe('getResourceConfigAccess', () => {
  it('returns full access in personal mode', async () => {
    await expect(getResourceConfigAccess(ctx(null), 'agent', 'agent-1')).resolves.toBe('full');

    expect(getResourceMetaMock).not.toHaveBeenCalled();
    expect(canPerformMock).not.toHaveBeenCalled();
  });

  it('returns full access when the caller can edit', async () => {
    canPerformMock.mockResolvedValueOnce(true);

    await expect(getResourceConfigAccess(ctx(), 'agent', 'agent-1')).resolves.toBe('full');

    expect(canPerformMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'edit' }));
    expect(canPerformMock).toHaveBeenCalledTimes(1);
  });

  it('returns profile-only access when the caller can view but not edit', async () => {
    canPerformMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(getResourceConfigAccess(ctx(), 'agent', 'agent-1')).resolves.toBe('profile');

    expect(canPerformMock.mock.calls.map(([params]) => params.action)).toEqual(['edit', 'view']);
  });

  it('returns none when the caller cannot view the resource', async () => {
    canPerformMock.mockResolvedValue(false);

    await expect(getResourceConfigAccess(ctx(), 'agent', 'agent-1')).resolves.toBe('none');
  });

  it('limits a virtual agent to the minimum access of its parent groups', async () => {
    getParentGroupIdsMock.mockResolvedValueOnce(['group-1']);
    canPerformMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(getResourceConfigAccess(ctx(), 'agent', 'agent-1')).resolves.toBe('profile');

    expect(canPerformMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'view', resourceId: 'group-1' }),
    );
  });

  it('rejects metadata from another workspace without evaluating permissions', async () => {
    getResourceMetaMock.mockResolvedValueOnce({ ...meta, workspaceId: 'ws-2' });

    await expect(getResourceConfigAccess(ctx(), 'agent', 'agent-1')).resolves.toBe('none');

    expect(canPerformMock).not.toHaveBeenCalled();
  });
});

describe('config redaction', () => {
  it('keeps only agent profile fields', () => {
    const result = redactAgentConfig({
      agencyConfig: {
        boundDeviceId: 'private-device',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
        heterogeneousProvider: { env: { SECRET: 'value' }, type: 'codex' },
        modelSelectionPolicy: 'fixed',
      },
      avatar: 'avatar.png',
      chatConfig: { enableAgentMode: false, runtimeEnv: { SECRET: 'value' } },
      description: 'Public description',
      files: [{ id: 'file-1' }],
      id: 'agent-1',
      model: 'shared-model',
      openingMessage: 'Hello',
      params: { temperature: 0.8 },
      plugins: ['private-tool'],
      provider: 'shared-provider',
      systemRole: 'private prompt',
      title: 'Public title',
    });

    expect(result).toEqual({
      agencyConfig: {
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
        heterogeneousProvider: { type: 'codex' },
        modelSelectionPolicy: 'fixed',
      },
      avatar: 'avatar.png',
      chatConfig: { enableAgentMode: false },
      description: 'Public description',
      id: 'agent-1',
      model: 'shared-model',
      openingMessage: 'Hello',
      provider: 'shared-provider',
      title: 'Public title',
    });
  });

  it('keeps a type-only hetero summary without leaking provider env', () => {
    const result = redactAgentConfig({
      agencyConfig: {
        heterogeneousProvider: {
          args: ['--dangerously-skip-permissions'],
          env: { API_KEY: 'secret' },
          type: 'claude-code',
        },
      },
      id: 'agent-1',
      title: 'Hetero agent',
    });

    expect(result.agencyConfig).toEqual({ heterogeneousProvider: { type: 'claude-code' } });
  });

  it('redacts group prompts and every member config', () => {
    const result = redactGroupConfig({
      agents: [
        {
          id: 'agent-1',
          isSupervisor: true,
          plugins: ['private-tool'],
          systemRole: 'private member prompt',
          title: 'Agent 1',
        },
      ],
      config: {
        allowDM: true,
        openingMessage: 'Welcome',
        openingQuestions: ['Start'],
        systemPrompt: 'private group prompt',
      },
      content: 'private editor content',
      id: 'group-1',
      supervisorAgentId: 'agent-1',
      title: 'Public group',
    });

    expect(result).toEqual({
      agents: [{ id: 'agent-1', isSupervisor: true, title: 'Agent 1' }],
      config: { openingMessage: 'Welcome', openingQuestions: ['Start'] },
      id: 'group-1',
      supervisorAgentId: 'agent-1',
      title: 'Public group',
    });
  });
});
