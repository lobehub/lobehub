import type { ChannelListItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';

import { useRemoveChannel } from './useRemoveChannel';

const { confirm, navigate, success, error, location } = vi.hoisted(() => ({
  confirm: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  location: { pathname: '/channels/chn_abcdefghijkl', search: '?thread=thread-1' },
}));
vi.mock('@lobehub/ui', () => ({
  confirmModal: confirm,
  toast: { error, success },
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ ...location }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args?: { title?: string }) => (args?.title ? key + ':' + args.title : key),
  }),
}));
const channel: ChannelListItem = {
  canDelete: true,
  createdAt: new Date(),
  id: 'chn_abcdefghijkl',
  projectId: null,
  sequence: 0,
  status: 'active',
  title: 'Important channel',
  workspaceId: null,
};
describe('Channel deletion confirmation', () => {
  beforeEach(() => {
    vi.spyOn(cacheScope, 'get').mockReturnValue('personal');
    vi.spyOn(channelActions, 'remove').mockResolvedValue();
    location.pathname = '/channels/' + channel.id;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const open = () => {
    const hook = renderHook(useRemoveChannel);
    act(() => {
      hook.result.current(channel);
    });
    return { ...hook, onOk: confirm.mock.calls[0][0].onOk as () => Promise<void> };
  };

  it('does not mutate before confirmation, and names the target and destructive action', () => {
    open();
    expect(channelActions.remove).not.toHaveBeenCalled();
    expect(confirm.mock.calls[0][0]).toMatchObject({
      content: 'moveToTrashConfirm:Important channel',
      okButtonProps: { danger: true },
      okText: 'moveToTrash',
    });
  });

  it('leaves the active channel including a thread only after successful deletion', async () => {
    const { onOk } = open();
    await onOk();
    expect(channelActions.remove).toHaveBeenCalledWith(channel.id);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(success).toHaveBeenCalledWith('moveToTrashSuccess');
  });

  it('returns to the project after deleting the open project Channel', async () => {
    location.pathname = `/project/pro_1/channels/${channel.id}`;
    const hook = renderHook(useRemoveChannel);
    act(() => {
      hook.result.current({ ...channel, projectId: 'pro_1' });
    });
    await (confirm.mock.calls[0][0].onOk as () => Promise<void>)();
    expect(navigate).toHaveBeenCalledWith('/project/pro_1', { replace: true });
  });

  it('does not redirect if the user navigated elsewhere while confirmation was open', async () => {
    const { onOk, rerender } = open();
    location.pathname = '/channels/chn_otherchannel';
    rerender();
    await onOk();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the dialog retryable and stays on the page after failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(channelActions.remove).mockRejectedValueOnce({ data: { code: 'FORBIDDEN' } });
    const { onOk } = open();
    await expect(onOk()).rejects.toBeDefined();
    expect(error).toHaveBeenCalledWith('deleteForbidden');
    expect(navigate).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    await onOk();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not show a deletion dialog without the server capability', () => {
    const { result } = renderHook(useRemoveChannel);
    act(() => {
      result.current({ ...channel, canDelete: false });
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not submit a confirmation after the identity changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onOk } = open();
    vi.mocked(cacheScope.get).mockReturnValue('another-workspace');
    await expect(onOk()).rejects.toThrow();
    expect(channelActions.remove).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
