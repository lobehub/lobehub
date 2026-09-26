import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicMoreMenu } from './useMoreMenu';

const mocks = vi.hoisted(() => ({
  allowed: true,
  closeTopicPortal: vi.fn(),
  confirmRemoveTopic: vi.fn(),
  openRenameModal: vi.fn(),
  portalTopicId: 'tpc_2' as string | undefined,
  refreshMessages: vi.fn(),
  removeTopic: vi.fn(),
  updateTopicTitle: vi.fn(),
  workspaceSlug: null as string | null,
}));

vi.mock('@/components/RenameModal', () => ({ openRenameModal: mocks.openRenameModal }));
vi.mock('@/features/DeleteTopicConfirm', () => ({ confirmRemoveTopic: mocks.confirmRemoveTopic }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.allowed }) }));
vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://app.lobehub.com' }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.workspaceSlug,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeAgentId: 'agt_1',
      closeTopicPortal: mocks.closeTopicPortal,
      refreshMessages: mocks.refreshMessages,
      removeTopic: mocks.removeTopic,
      updateTopicTitle: mocks.updateTopicTitle,
    }),
}));
vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: { portalTopicId: () => mocks.portalTopicId },
  topicSelectors: { getTopicById: () => () => ({ title: 'Second topic' }) },
}));

describe('useTopicMoreMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allowed = true;
    mocks.portalTopicId = 'tpc_2';
    mocks.workspaceSlug = null;
  });

  it('declares every capability the matrix marks available for a topic', () => {
    const { result } = renderHook(() => useTopicMoreMenu());

    expect(result.current).toMatchObject({
      copyId: 'tpc_2',
      copyLink: 'https://app.lobehub.com/agent/agt_1/tpc_2',
    });
    expect(result.current?.rename).toBeTypeOf('function');
    expect(result.current?.delete).toBeTypeOf('function');
    expect(result.current?.refresh).toBeTypeOf('function');
    // No full page for a topic panel — the capability is left out, not stubbed.
    expect(result.current?.openInPage).toBeUndefined();
  });

  it('links into the active workspace', () => {
    mocks.workspaceSlug = 'acme';
    const { result } = renderHook(() => useTopicMoreMenu());

    expect(result.current?.copyLink).toBe('https://app.lobehub.com/acme/agent/agt_1/tpc_2');
  });

  it('hides rename and delete without edit permission', () => {
    mocks.allowed = false;
    const { result } = renderHook(() => useTopicMoreMenu());

    expect(result.current?.rename).toBeUndefined();
    expect(result.current?.delete).toBeUndefined();
    expect(result.current?.copyId).toBe('tpc_2');
  });

  it('closes the panel once the shown topic is deleted', async () => {
    const { result } = renderHook(() => useTopicMoreMenu());
    result.current!.delete!();

    const { onConfirm, topicIds } = mocks.confirmRemoveTopic.mock.calls[0][0];
    expect(topicIds).toEqual(['tpc_2']);
    await onConfirm(true);

    expect(mocks.removeTopic).toHaveBeenCalledWith('tpc_2', true);
    expect(mocks.closeTopicPortal).toHaveBeenCalledOnce();
  });

  it('renames through the shared rename modal', async () => {
    const { result } = renderHook(() => useTopicMoreMenu());
    result.current!.rename!();

    const { defaultValue, onSave } = mocks.openRenameModal.mock.calls[0][0];
    expect(defaultValue).toBe('Second topic');
    await onSave('Renamed');
    expect(mocks.updateTopicTitle).toHaveBeenCalledWith('tpc_2', 'Renamed');
  });

  it('refreshes the messages of the panel topic, not the main column one', () => {
    const { result } = renderHook(() => useTopicMoreMenu());
    result.current!.refresh!();

    expect(mocks.refreshMessages).toHaveBeenCalledWith({ agentId: 'agt_1', topicId: 'tpc_2' });
  });

  it('shows no menu without a topic', () => {
    mocks.portalTopicId = undefined;
    const { result } = renderHook(() => useTopicMoreMenu());

    expect(result.current).toBeUndefined();
  });
});
