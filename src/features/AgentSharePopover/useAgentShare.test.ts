import { act, renderHook, waitFor } from '@testing-library/react';
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
    mocks.getShareStatus.mockResolvedValue(null);
    mocks.enableShare.mockResolvedValue(shareRow('agent-auto-create'));

    const { result } = renderHook(() => useAgentShare('agent-auto-create', true));

    await waitFor(() => {
      expect(mocks.enableShare).toHaveBeenCalledWith('agent-auto-create');
    });
    await waitFor(() => {
      expect(result.current.shareInfo?.id).toBe('share-agent-auto-create');
    });
  });

  it('surfaces creation failures and retries on demand', async () => {
    mocks.getShareStatus.mockResolvedValue(null);
    mocks.enableShare
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(shareRow('agent-create-retry'));

    const { result } = renderHook(() => useAgentShare('agent-create-retry', true));

    await waitFor(() => expect(result.current.createError).toBeInstanceOf(Error));
    expect(mocks.enableShare).toHaveBeenCalledOnce();

    await act(async () => result.current.retryCreate());

    expect(mocks.enableShare).toHaveBeenCalledTimes(2);
    expect(result.current.createError).toBeUndefined();
    expect(result.current.shareInfo?.id).toBe('share-agent-create-retry');
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
    mocks.updateShareConfig.mockImplementation(async (agentId, config) => ({
      ...shareRow(agentId),
      shareConfig: config,
    }));

    const { result } = renderHook(() => useAgentShare('agent-merge', true));
    await waitFor(() => {
      expect(result.current.shareInfo).toBeTruthy();
    });

    await act(async () => {
      await result.current.updateConfig({ enabledToolIds: ['dalle'], maxTurnsPerTopic: 50 });
    });

    // The strict whole-replace schema requires untouched fields to survive.
    expect(mocks.updateShareConfig).toHaveBeenCalledWith('agent-merge', {
      allowReadMemory: false,
      enabledToolIds: ['dalle'],
      filePermissionConfig: { agentFiles: 'none', knowledgeBase: 'none', uploadAllowed: false },
      maxTopicsPerVisitor: 5,
      maxTurnsPerTopic: 50,
    });
  });

  it('serializes rapid config patches over the latest submitted snapshot', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-queue'));

    let resolveFirst!: (value: ReturnType<typeof shareRow>) => void;
    mocks.updateShareConfig
      .mockImplementationOnce(
        (agentId, config) =>
          new Promise((resolve) => {
            resolveFirst = () => resolve({ ...shareRow(agentId), shareConfig: config });
          }),
      )
      .mockImplementationOnce(async (agentId, config) => ({
        ...shareRow(agentId),
        shareConfig: config,
      }));

    const { result } = renderHook(() => useAgentShare('agent-queue', true));
    await waitFor(() => expect(result.current.shareInfo).toBeTruthy());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.updateConfig({ allowReadMemory: true })!;
      second = result.current.updateConfig({ maxTurnsPerTopic: 50 })!;
    });

    await waitFor(() => expect(mocks.updateShareConfig).toHaveBeenCalledTimes(1));
    resolveFirst(shareRow('agent-queue'));
    await act(async () => Promise.all([first, second]));

    expect(mocks.updateShareConfig).toHaveBeenNthCalledWith(2, 'agent-queue', {
      allowReadMemory: true,
      enabledToolIds: [],
      filePermissionConfig: { agentFiles: 'none', knowledgeBase: 'none', uploadAllowed: false },
      maxTopicsPerVisitor: 5,
      maxTurnsPerTopic: 50,
    });
  });

  it('shares the config queue when settings remount during a pending write', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-remount'));

    let resolveFirst!: (value: ReturnType<typeof shareRow>) => void;
    mocks.updateShareConfig
      .mockImplementationOnce(
        (agentId, config) =>
          new Promise((resolve) => {
            resolveFirst = () => resolve({ ...shareRow(agentId), shareConfig: config });
          }),
      )
      .mockImplementationOnce(async (agentId, config) => ({
        ...shareRow(agentId),
        shareConfig: config,
      }));

    const firstMount = renderHook(() => useAgentShare('agent-remount', true));
    await waitFor(() => expect(firstMount.result.current.shareInfo).toBeTruthy());

    let first!: Promise<void>;
    act(() => {
      first = firstMount.result.current.updateConfig({ allowReadMemory: true })!;
    });
    await waitFor(() => expect(mocks.updateShareConfig).toHaveBeenCalledOnce());
    firstMount.unmount();

    const secondMount = renderHook(() => useAgentShare('agent-remount', true));
    await waitFor(() => expect(secondMount.result.current.shareInfo).toBeTruthy());

    let second!: Promise<void>;
    act(() => {
      second = secondMount.result.current.updateConfig({ maxTurnsPerTopic: 50 })!;
    });

    expect(mocks.updateShareConfig).toHaveBeenCalledOnce();
    resolveFirst(shareRow('agent-remount'));
    await act(async () => Promise.all([first, second]));

    expect(mocks.updateShareConfig).toHaveBeenNthCalledWith(
      2,
      'agent-remount',
      expect.objectContaining({ allowReadMemory: true, maxTurnsPerTopic: 50 }),
    );
  });

  it('resolves functional patches from the latest queued config', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-functional'));
    mocks.updateShareConfig.mockImplementation(async (agentId, config) => ({
      ...shareRow(agentId),
      shareConfig: config,
    }));

    const { result } = renderHook(() => useAgentShare('agent-functional', true));
    await waitFor(() => expect(result.current.shareInfo).toBeTruthy());

    await act(async () => {
      await result.current.updateConfig({ enabledToolIds: ['dalle'] });
      await result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'search'],
      }));
    });

    expect(mocks.updateShareConfig).toHaveBeenLastCalledWith(
      'agent-functional',
      expect.objectContaining({ enabledToolIds: ['dalle', 'search'] }),
    );
  });
});
