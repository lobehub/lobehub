import type { ChannelListItem } from '@lobechat/types';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';

import { useRemoveThread } from './useRemoveThread';

const { confirm, navigate, success, error, location } = vi.hoisted(() => ({
  confirm: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  location: {
    pathname: '/channels/chn_abcdefghijkl',
    search: '?thread=thread-1&keep=value',
    hash: '#anchor',
  },
}));
vi.mock('@lobehub/ui', () => ({ confirmModal: confirm, toast: { error, success } }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => ({ ...location }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const channel: ChannelListItem = {
  id: 'chn_abcdefghijkl',
  title: 'Channel',
  archived: false,
  canDelete: true,
  sequence: 0,
  status: 'active',
  createdAt: new Date(),
  workspaceId: null,
};

describe('Thread deletion confirmation', () => {
  beforeEach(() => {
    vi.spyOn(cacheScope, 'get').mockReturnValue('personal');
    vi.spyOn(channelActions, 'removeThread').mockResolvedValue();
    location.pathname = '/channels/' + channel.id;
    location.search = '?thread=thread-1&keep=value';
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  const open = () => {
    const hook = renderHook(useRemoveThread);
    act(() => {
      hook.result.current(channel, 'thread-1');
    });
    return { ...hook, onOk: confirm.mock.calls[0][0].onOk as () => Promise<void> };
  };

  it('requires explicit confirmation before writing', () => {
    open();
    expect(channelActions.removeThread).not.toHaveBeenCalled();
    expect(confirm.mock.calls[0][0]).toMatchObject({
      content: 'deleteThreadConfirm',
      okText: 'deleteThread',
      okButtonProps: { danger: true },
    });
  });
  it('closes only the deleted thread and preserves unrelated URL state after success', async () => {
    const { onOk } = open();
    await onOk();
    expect(navigate).toHaveBeenCalledWith(
      { pathname: location.pathname, search: 'keep=value', hash: '#anchor' },
      { replace: true },
    );
    expect(success).toHaveBeenCalledWith('deleteThreadSuccess');
  });
  it.each(['other-thread', 'main', 'other-channel'])(
    'does not navigate away from a later selection (%s)',
    async (selection) => {
      const gate = Promise.withResolvers<void>();
      vi.mocked(channelActions.removeThread).mockReturnValue(gate.promise);
      const { onOk, rerender } = open();
      const pending = onOk();
      if (selection === 'other-thread') location.search = '?thread=other-thread';
      if (selection === 'main') location.search = '';
      if (selection === 'other-channel') location.pathname = '/channels/chn_otherchannel';
      rerender();
      gate.resolve();
      await pending;
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it('keeps failures retryable without claiming success or leaving the conversation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelActions.removeThread).mockRejectedValueOnce({ data: { code: 'FORBIDDEN' } });
    const { onOk } = open();
    await expect(onOk()).rejects.toBeDefined();
    expect(error).toHaveBeenCalledWith('deleteThreadForbidden');
    expect(success).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    await onOk();
    expect(success).toHaveBeenCalledTimes(1);
  });
  it('does not expose deletion without the server capability', () => {
    const { result } = renderHook(useRemoveThread);
    result.current({ ...channel, canDelete: false }, 'thread-1');
    expect(confirm).not.toHaveBeenCalled();
  });
  it('does not confirm under a different identity', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onOk } = open();
    vi.mocked(cacheScope.get).mockReturnValue('different');
    await expect(onOk()).rejects.toThrow();
    expect(channelActions.removeThread).not.toHaveBeenCalled();
  });
  it('does not navigate or toast to another identity after a delayed completion', async () => {
    const gate = Promise.withResolvers<void>();
    vi.mocked(channelActions.removeThread).mockReturnValue(gate.promise);
    const { onOk } = open();
    const pending = onOk();
    vi.mocked(cacheScope.get).mockReturnValue('different');
    gate.resolve();
    await pending;
    expect(navigate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });
});
