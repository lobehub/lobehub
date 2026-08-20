import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentShare } from './useAgentShare';

const mocks = vi.hoisted(() => ({
  enableShare: vi.fn(),
  getShareStatus: vi.fn(),
  updateShareConfig: vi.fn(),
  updateVisibility: vi.fn(),
}));

vi.mock('@/services/agentShare', () => ({
  agentShareService: mocks,
}));

const shareRow = (agentId: string) => ({
  agentId,
  id: `share-${agentId}`,
  shareConfig: {
    allowReadMemory: false,
    enabledToolIds: [],
    filePermissionConfig: { agentFiles: 'none', knowledgeBase: 'none', uploadAllowed: false },
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
  },
  visibility: 'private',
});

describe('useAgentShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-creates a private share record when none exists', async () => {
    mocks.getShareStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValue(shareRow('agent-auto-create'));
    mocks.enableShare.mockResolvedValue(shareRow('agent-auto-create'));

    const { result } = renderHook(() => useAgentShare('agent-auto-create', true));

    await waitFor(() => {
      expect(mocks.enableShare).toHaveBeenCalledWith('agent-auto-create');
    });
    await waitFor(() => {
      expect(result.current.shareInfo?.id).toBe('share-agent-auto-create');
    });
  });

  it('does not fetch or create anything while disabled', async () => {
    renderHook(() => useAgentShare('agent-disabled', false));

    // Give any stray async work a tick to surface before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.getShareStatus).not.toHaveBeenCalled();
    expect(mocks.enableShare).not.toHaveBeenCalled();
  });

  it('merges config patches over the server-normalized config before submitting', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-merge'));
    mocks.updateShareConfig.mockResolvedValue(shareRow('agent-merge'));

    const { result } = renderHook(() => useAgentShare('agent-merge', true));
    await waitFor(() => {
      expect(result.current.shareInfo).toBeTruthy();
    });

    await result.current.updateConfig({ enabledToolIds: ['dalle'], maxTurnsPerTopic: 50 });

    // The strict whole-replace schema requires untouched fields to survive.
    expect(mocks.updateShareConfig).toHaveBeenCalledWith('agent-merge', {
      allowReadMemory: false,
      enabledToolIds: ['dalle'],
      filePermissionConfig: { agentFiles: 'none', knowledgeBase: 'none', uploadAllowed: false },
      maxTopicsPerVisitor: 5,
      maxTurnsPerTopic: 50,
    });
  });
});
