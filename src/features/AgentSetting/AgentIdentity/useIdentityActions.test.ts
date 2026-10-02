import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  markAllInboxRead: vi.fn(),
  markInboxRead: vi.fn(),
  provision: vi.fn(),
  revoke: vi.fn(),
}));

const ui = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  createModal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  createModal: ui.createModal,
  toast: ui.toast,
}));

const { IDENTITY_CHANNELS } = await import('./const');
const { useAccountActions, useInboxActions } = await import('./useIdentityActions');

const mailChannel = IDENTITY_CHANNELS.find((channel) => channel.kind === 'mail')!;
const phoneChannel = IDENTITY_CHANNELS.find((channel) => channel.kind === 'phone')!;

const mailAccount = { id: 'acc_mail', identifier: 'research@lobe.id' } as any;
const unreadMessage = { id: 'msg_1', readAt: null } as any;
const readMessage = { id: 'msg_2', readAt: new Date('2026-10-02T02:00:00Z') } as any;

const lastConfirm = () => ui.confirmModal.mock.calls.at(-1)![0] as { onOk: () => Promise<void> };

describe('useAccountActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.provision.mockResolvedValue({ id: 'acc_new', identifier: 'support@lobe.id' });
    service.revoke.mockResolvedValue({ id: 'acc_mail' });
  });

  it('forwards the trimmed prefix and revalidates the addresses', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAccountActions({ agentId: 'agt_1', onChanged }));

    await result.current.provision(mailChannel, '  support  ');

    expect(service.provision).toHaveBeenCalledWith({
      agentId: 'agt_1',
      prefix: 'support',
      provider: 'agent-mail',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(ui.toast.success).toHaveBeenCalledTimes(1);
  });

  it('never sends a prefix down a channel that cannot honour one', async () => {
    const { result } = renderHook(() =>
      useAccountActions({ agentId: 'agt_1', onChanged: vi.fn() }),
    );

    await result.current.provision(phoneChannel, 'support');

    expect(service.provision).toHaveBeenCalledWith({
      agentId: 'agt_1',
      prefix: undefined,
      provider: 'linq',
    });
  });

  it("surfaces the provider's own reason and does not revalidate on failure", async () => {
    service.provision.mockRejectedValueOnce(new Error('prefix "support" is taken'));
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAccountActions({ agentId: 'agt_1', onChanged }));

    await expect(result.current.provision(mailChannel, 'support')).resolves.toBeUndefined();

    expect(onChanged).not.toHaveBeenCalled();
    expect(ui.toast.error).toHaveBeenCalledTimes(1);
  });

  it('releases only after the confirmation is accepted', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAccountActions({ agentId: 'agt_1', onChanged }));

    result.current.release(mailAccount);
    expect(service.revoke).not.toHaveBeenCalled();

    await lastConfirm().onOk();

    expect(service.revoke).toHaveBeenCalledWith('acc_mail');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('useInboxActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.markAllInboxRead.mockResolvedValue({ count: 1 });
    service.markInboxRead.mockResolvedValue({ count: 1 });
  });

  it('opens an unread message and clears its unread mark', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useInboxActions({ agentId: 'agt_1', onChanged }));

    await result.current.openMessage(unreadMessage);

    expect(ui.createModal).toHaveBeenCalledTimes(1);
    expect(service.markInboxRead).toHaveBeenCalledWith(['msg_1']);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not re-stamp a message that was already read', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useInboxActions({ agentId: 'agt_1', onChanged }));

    await result.current.openMessage(readMessage);

    expect(ui.createModal).toHaveBeenCalledTimes(1);
    expect(service.markInboxRead).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('clears the whole inbox and revalidates', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useInboxActions({ agentId: 'agt_1', onChanged }));

    await result.current.markAllRead();

    expect(service.markAllInboxRead).toHaveBeenCalledWith('agt_1');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
