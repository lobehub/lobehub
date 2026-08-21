import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { agentShareService } from '@/services/agentShare';

import { useAgentShare } from './useAgentShare';

type AgentShareStatus = NonNullable<Awaited<ReturnType<typeof agentShareService.getShareStatus>>>;

const mocks = vi.hoisted(() => ({
  enableShare: vi.fn(),
  getShareStatus: vi.fn(),
  updateShareConfig: vi.fn(),
  updateVisibility: vi.fn(),
}));

vi.mock('@/services/agentShare', () => ({
  agentShareService: mocks,
}));

const shareRow = (agentId: string): AgentShareStatus => ({
  accessedAt: new Date(0),
  agentId,
  createdAt: new Date(0),
  id: `share-${agentId}`,
  shareConfig: {
    allowReadMemory: false,
    enabledToolIds: [],
    filePermissionConfig: { agentFiles: 'none', knowledgeBase: 'none', uploadAllowed: false },
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
  },
  updatedAt: new Date(0),
  userViewCount: 0,
  visibility: 'private',
});

const applyConfigPatch = (
  agentId: string,
  patch: Partial<ReturnType<typeof shareRow>['shareConfig']>,
) => {
  const row = shareRow(agentId);
  return {
    ...row,
    shareConfig: {
      ...row.shareConfig,
      ...patch,
      filePermissionConfig: patch.filePermissionConfig
        ? { ...row.shareConfig.filePermissionConfig, ...patch.filePermissionConfig }
        : row.shareConfig.filePermissionConfig,
    },
  };
};

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

  it('keeps a committed visibility update when status revalidation would fail', async () => {
    const initial = shareRow('agent-visibility');
    const updated = { ...initial, visibility: 'link' };
    mocks.getShareStatus.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('offline'));
    mocks.updateVisibility.mockResolvedValue(updated);

    const { result } = renderHook(() => useAgentShare('agent-visibility', true));
    await waitFor(() => expect(result.current.shareInfo).toEqual(initial));

    await act(async () => result.current.updateVisibility('link'));

    expect(result.current.shareInfo).toEqual(updated);
  });

  it('submits only changed fields and accepts the server-normalized result', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-merge'));
    mocks.updateShareConfig.mockImplementation(async (agentId, config) =>
      applyConfigPatch(agentId, config),
    );

    const { result } = renderHook(() => useAgentShare('agent-merge', true));
    await waitFor(() => {
      expect(result.current.shareInfo).toBeTruthy();
    });

    await act(async () => {
      await result.current.updateConfig({ enabledToolIds: ['dalle'], maxTurnsPerTopic: 50 });
    });

    expect(mocks.updateShareConfig).toHaveBeenCalledWith('agent-merge', {
      enabledToolIds: ['dalle'],
      maxTurnsPerTopic: 50,
    });
    expect(result.current.shareInfo?.shareConfig).toEqual(
      applyConfigPatch('agent-merge', { enabledToolIds: ['dalle'], maxTurnsPerTopic: 50 })
        .shareConfig,
    );
  });

  it('serializes rapid config patches over the latest submitted snapshot', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-queue'));

    let resolveFirst!: (value: ReturnType<typeof shareRow>) => void;
    mocks.updateShareConfig
      .mockImplementationOnce(
        (agentId, config) =>
          new Promise((resolve) => {
            resolveFirst = () => resolve(applyConfigPatch(agentId, config));
          }),
      )
      .mockImplementationOnce(async (agentId, config) => applyConfigPatch(agentId, config));

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
            resolveFirst = () => resolve(applyConfigPatch(agentId, config));
          }),
      )
      .mockImplementationOnce(async (agentId, config) => applyConfigPatch(agentId, config));

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

    expect(mocks.updateShareConfig).toHaveBeenNthCalledWith(2, 'agent-remount', {
      maxTurnsPerTopic: 50,
    });
  });

  it('resolves functional patches from the latest queued config', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-functional'));
    mocks.updateShareConfig.mockImplementation(async (agentId, config) =>
      applyConfigPatch(agentId, config),
    );

    const { result } = renderHook(() => useAgentShare('agent-functional', true));
    await waitFor(() => expect(result.current.shareInfo).toBeTruthy());

    await act(async () => {
      await result.current.updateConfig({ enabledToolIds: ['dalle'] });
      await result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'search'],
      }));
    });

    expect(mocks.updateShareConfig).toHaveBeenLastCalledWith('agent-functional', {
      enabledToolIds: ['dalle', 'search'],
    });
  });

  it('reconciles an idle queue from same-share SWR revalidation before a functional patch', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-revalidate'));
    mocks.updateShareConfig.mockImplementation(async (agentId, config) =>
      applyConfigPatch(agentId, config),
    );

    const { result } = renderHook(() => useAgentShare('agent-revalidate', true));
    await waitFor(() => expect(result.current.shareInfo).toBeTruthy());

    const externalUpdate = applyConfigPatch('agent-revalidate', {
      enabledToolIds: ['external-tool'],
    });
    await act(async () => result.current.mutate(externalUpdate, { revalidate: false }));
    await waitFor(() => expect(result.current.shareInfo).toEqual(externalUpdate));

    await act(async () => {
      await result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'local-tool'],
      }));
    });

    expect(mocks.updateShareConfig).toHaveBeenLastCalledWith('agent-revalidate', {
      enabledToolIds: ['external-tool', 'local-tool'],
    });
  });

  it('restores a skipped server snapshot after a queued write rejects', async () => {
    mocks.getShareStatus.mockResolvedValue(shareRow('agent-rejected-revalidation'));

    let rejectFirst!: (error: Error) => void;
    mocks.updateShareConfig
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(async (agentId, config) => applyConfigPatch(agentId, config));

    const { result } = renderHook(() => useAgentShare('agent-rejected-revalidation', true));
    await waitFor(() => expect(result.current.shareInfo).toBeTruthy());

    let rejectedWrite!: Promise<void>;
    act(() => {
      rejectedWrite = result.current.updateConfig({ allowReadMemory: true })!;
    });
    await waitFor(() => expect(mocks.updateShareConfig).toHaveBeenCalledOnce());

    const externalUpdate = applyConfigPatch('agent-rejected-revalidation', {
      enabledToolIds: ['external-tool'],
    });
    await act(async () => result.current.mutate(externalUpdate, { revalidate: false }));

    rejectFirst(new Error('write failed'));
    await act(async () => expect(rejectedWrite).rejects.toThrow('write failed'));

    await act(async () => {
      await result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'local-tool'],
      }));
    });

    expect(mocks.updateShareConfig).toHaveBeenLastCalledWith('agent-rejected-revalidation', {
      enabledToolIds: ['external-tool', 'local-tool'],
    });
  });

  it('revalidates a deferred server snapshot after a delayed write succeeds', async () => {
    const initial = shareRow('agent-delayed-success');
    const authoritative = applyConfigPatch('agent-delayed-success', {
      allowReadMemory: true,
      enabledToolIds: ['external-tool'],
    });
    mocks.getShareStatus.mockResolvedValueOnce(initial).mockResolvedValueOnce(authoritative);

    let resolveFirst!: (value: ReturnType<typeof shareRow>) => void;
    mocks.updateShareConfig
      .mockImplementationOnce(
        (agentId, config) =>
          new Promise((resolve) => {
            resolveFirst = () => resolve(applyConfigPatch(agentId, config));
          }),
      )
      .mockImplementationOnce(async (agentId, config) => applyConfigPatch(agentId, config));

    const { result } = renderHook(() => useAgentShare('agent-delayed-success', true));
    await waitFor(() => expect(result.current.shareInfo).toEqual(initial));

    let delayedWrite!: Promise<void>;
    act(() => {
      delayedWrite = result.current.updateConfig({ allowReadMemory: true })!;
    });
    await waitFor(() => expect(mocks.updateShareConfig).toHaveBeenCalledOnce());

    const externalUpdate = applyConfigPatch('agent-delayed-success', {
      enabledToolIds: ['external-tool'],
    });
    await act(async () => result.current.mutate(externalUpdate, { revalidate: false }));

    resolveFirst(initial);
    await act(async () => delayedWrite);

    await act(async () => {
      await result.current.updateConfig((current) => ({
        enabledToolIds: [...(current.enabledToolIds ?? []), 'local-tool'],
      }));
    });

    expect(mocks.getShareStatus).toHaveBeenCalledTimes(2);
    expect(mocks.updateShareConfig).toHaveBeenLastCalledWith('agent-delayed-success', {
      enabledToolIds: ['external-tool', 'local-tool'],
    });
  });
});
