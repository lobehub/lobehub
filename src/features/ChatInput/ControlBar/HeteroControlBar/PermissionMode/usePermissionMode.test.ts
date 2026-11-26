import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { useChatStore } from '@/store/chat';
import {
  applyPermissionModeReport,
  clearSwitchUnapplied,
  pendingHeteroPermissionModeMetadata,
  registerLocalPermissionModeSwitcher,
} from '@/store/chat/heteroPermissionMode';
import { useUserStore } from '@/store/user';

import { usePermissionMode } from './usePermissionMode';

const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => null,
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    agencyConfig: { boundDeviceId: 'dev-1' },
    workspaceScoped: false,
  }),
}));
vi.mock('@/helpers/agentWorkingDirectory', () => ({ resolveTargetDeviceId: () => 'dev-1' }));
vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => '/repo',
}));
vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { setHeteroPermissionMode: vi.fn() },
}));

const setDir = vi.fn(async () => {});
// Writes the patch into the seeded topic, as the real action does optimistically.
const updateTopicMetadata = vi.fn(async (_id: string, patch: Record<string, unknown>) => {
  const item = (useChatStore.getState().topicDataMap as any).k.items[0];
  useChatStore.setState({
    topicDataMap: { k: { items: [{ ...item, metadata: { ...item.metadata, ...patch } }] } } as any,
  });
});

const seedTopic = (metadata: Record<string, unknown>) =>
  useChatStore.setState({
    topicDataMap: { k: { items: [{ id: 'topic-1', metadata, title: 't' }] } } as any,
    updateTopicMetadata,
  });

describe('usePermissionMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSwitchUnapplied('topic-1');
    useUserStore.setState({
      preference: {
        heteroPermissionModeDirs: [{ key: 'dev-1::/repo', mode: 'plan' }],
      } as any,
      setHeteroPermissionModeDir: setDir,
      useFetchWorkspaceUserPreference: () => {},
    } as any);
  });

  it('starts a new topic in the mode last picked for this device + directory', () => {
    const { result } = renderHook(() => usePermissionMode('agent-1', undefined));
    expect(result.current.mode).toBe('plan');
    // The topic the send creates is born with it.
    expect(pendingHeteroPermissionModeMetadata('agent-1', 'claude-code')).toEqual({
      heteroPermissionMode: 'plan',
    });
  });

  it('writes a pick to the topic, remembers it and switches the local run', async () => {
    seedTopic({ heteroPermissionMode: 'default' });
    const switcher = vi.fn(async () => {});
    const unregister = registerLocalPermissionModeSwitcher('topic-1', switcher);
    const { result } = renderHook(() => usePermissionMode('agent-1', 'topic-1'));
    expect(result.current.mode).toBe('default');

    await act(() => result.current.select('acceptEdits'));

    expect(setDir).toHaveBeenCalledWith('dev-1::/repo', 'acceptEdits');
    expect(updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      heteroPermissionMode: 'acceptEdits',
      heteroPermissionModeFallback: null,
    });
    expect(switcher).toHaveBeenCalledWith('acceptEdits');
    unregister();
  });

  it('switches a run hosted by lh, and says when that lh cannot', async () => {
    seedTopic({
      heteroPermissionMode: 'default',
      runningOperation: { assistantMessageId: 'a', operationId: 'op-remote' },
    });
    vi.mocked(aiAgentService.setHeteroPermissionMode).mockResolvedValue({
      status: 'unsupported',
    } as any);
    const { result } = renderHook(() => usePermissionMode('agent-1', 'topic-1'));

    await act(() => result.current.select('plan'));

    expect(aiAgentService.setHeteroPermissionMode).toHaveBeenCalledWith({
      mode: 'plan',
      operationId: 'op-remote',
    });
    expect(toast.info).toHaveBeenCalledWith('heteroAgent.permissionMode.switchUnsupported');
    // The running session never left "Ask every time": the chip says so, and the
    // pick waits for the next message.
    expect(result.current).toMatchObject({
      mode: 'plan',
      runningMode: 'default',
      switchPending: true,
    });

    // Claude Code reporting its mode again ends the guess.
    await act(() =>
      applyPermissionModeReport(
        () => useChatStore.getState(),
        'topic-1',
        { fallback: null, permissionMode: 'plan' },
        { persist: false },
      ),
    );
    expect(result.current.switchPending).toBe(false);
  });

  it('still switches the run when remembering the directory pick fails', async () => {
    seedTopic({ heteroPermissionMode: 'bypassPermissions' });
    setDir.mockRejectedValueOnce(new Error('offline'));
    const switcher = vi.fn(async () => 'plan' as const);
    const unregister = registerLocalPermissionModeSwitcher('topic-1', switcher);
    const { result } = renderHook(() => usePermissionMode('agent-1', 'topic-1'));

    await act(() => result.current.select('plan'));

    expect(switcher).toHaveBeenCalledWith('plan');
    expect(result.current).toMatchObject({
      mode: 'plan',
      runningMode: 'plan',
      switchPending: false,
    });
    expect(toast.error).toHaveBeenCalledWith('heteroAgent.permissionMode.saveFailed');
    unregister();
  });

  it('keeps a bypass pick but shows the root stand-in the session took', async () => {
    seedTopic({
      heteroPermissionMode: 'default',
      runningOperation: { assistantMessageId: 'a', operationId: 'op-root' },
    });
    vi.mocked(aiAgentService.setHeteroPermissionMode).mockResolvedValue({
      mode: 'acceptEdits',
      status: 'accepted',
    } as any);
    const { result } = renderHook(() => usePermissionMode('agent-1', 'topic-1'));

    await act(() => result.current.select('bypassPermissions'));

    expect(updateTopicMetadata).toHaveBeenLastCalledWith('topic-1', {
      heteroPermissionModeFallback: 'root',
    });
    expect(result.current).toMatchObject({
      fallback: 'root',
      mode: 'bypassPermissions',
      runningMode: 'acceptEdits',
    });
  });

  it('shows the mode a fallback ran in', () => {
    seedTopic({ heteroPermissionMode: 'plan', heteroPermissionModeFallback: 'outdatedCli' });
    const { result } = renderHook(() => usePermissionMode('agent-1', 'topic-1'));
    expect(result.current).toMatchObject({
      fallback: 'outdatedCli',
      mode: 'plan',
      runningMode: 'bypassPermissions',
    });
  });
});
