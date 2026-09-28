import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useThreadMoreMenu } from './useMoreMenu';

const mocks = vi.hoisted(() => ({
  closeThreadPortal: vi.fn(),
  confirmModal: vi.fn(),
  openRenameModal: vi.fn(),
  portalThreadId: 'thd_1' as string | undefined,
  refreshMessages: vi.fn(),
  refreshThreads: vi.fn(),
  removeThread: vi.fn(),
  thread: { agentId: null, id: 'thd_1', title: 'Side question', topicId: 'tpc_1' } as
    Record<string, unknown> | undefined,
  updateThreadTitle: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({ confirmModal: mocks.confirmModal }));
vi.mock('@/components/RenameModal', () => ({ openRenameModal: mocks.openRenameModal }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeAgentId: 'agt_1',
      closeThreadPortal: mocks.closeThreadPortal,
      portalThreadId: mocks.portalThreadId,
      refreshMessages: mocks.refreshMessages,
      refreshThreads: mocks.refreshThreads,
      removeThread: mocks.removeThread,
      updateThreadTitle: mocks.updateThreadTitle,
    }),
}));
vi.mock('@/store/chat/selectors', () => ({
  portalThreadSelectors: { portalCurrentThread: () => mocks.thread },
}));

describe('useThreadMoreMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.portalThreadId = 'thd_1';
    mocks.thread = { agentId: null, id: 'thd_1', title: 'Side question', topicId: 'tpc_1' };
  });

  it('links to the topic with the thread reopened in the side panel', () => {
    const { result } = renderHook(() => useThreadMoreMenu());

    expect(result.current).toMatchObject({
      copyId: 'thd_1',
      copyLink: 'https://app.lobehub.com/agent/agt_1/tpc_1?portalThread=thd_1',
    });
  });

  it('shows no menu while a thread is still being forked', () => {
    mocks.portalThreadId = undefined;
    mocks.thread = undefined;
    const { result } = renderHook(() => useThreadMoreMenu());

    expect(result.current).toBeUndefined();
  });

  it('closes the panel once the shown thread is deleted', async () => {
    const { result } = renderHook(() => useThreadMoreMenu());
    result.current!.delete!();

    await mocks.confirmModal.mock.calls[0][0].onOk();
    expect(mocks.removeThread).toHaveBeenCalledWith('thd_1');
    expect(mocks.closeThreadPortal).toHaveBeenCalledOnce();
  });

  it('renames the thread from its current title', async () => {
    const { result } = renderHook(() => useThreadMoreMenu());
    result.current!.rename!();

    const { defaultValue, onSave } = mocks.openRenameModal.mock.calls[0][0];
    expect(defaultValue).toBe('Side question');
    await onSave('Renamed');
    expect(mocks.updateThreadTitle).toHaveBeenCalledWith('thd_1', 'Renamed');
  });

  it('refreshes the thread list and the thread messages', async () => {
    const { result } = renderHook(() => useThreadMoreMenu());
    await result.current!.refresh!();

    expect(mocks.refreshThreads).toHaveBeenCalledOnce();
    expect(mocks.refreshMessages).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', threadId: 'thd_1', topicId: 'tpc_1' }),
    );
  });
});
