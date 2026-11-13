import type { InboundWebhookItem } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAutomationRowActions } from './useAutomationRowActions';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  confirmModal: vi.fn(),
  delete: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.reason ? `${key}:${String(options.reason)}` : key,
  }),
}));

vi.mock('@lobehub/ui', () => ({ confirmModal: mocks.confirmModal, toast: mocks.toast }));

vi.mock('@/services/inboundWebhook', () => ({
  inboundWebhookService: { check: mocks.check, delete: mocks.delete },
}));

const row = (patch: Partial<InboundWebhookItem> = {}): InboundWebhookItem => ({
  agent: { avatar: null, backgroundColor: null, id: 'agt_1', title: 'Release bot' },
  canCheck: true,
  canManage: true,
  connector: { avatar: null, id: 'con_1', identifier: 'github', name: 'GitHub' },
  createdAt: '2026-11-13T08:00:00.000Z',
  creatorId: 'user_1',
  expiresAt: null,
  id: 'wh_1',
  kind: 'mcp_events',
  lastDeliveryAt: null,
  lastError: 'delivery_suspended',
  name: 'check_run.failed',
  source: { arguments: {}, eventName: 'check_run.failed', kind: 'mcp_events' },
  status: 'error',
  topic: null,
  ...patch,
});

const setup = (item = row()) => {
  const onChecked = vi.fn();
  const onRemoved = vi.fn();
  const hook = renderHook(() => useAutomationRowActions(item, { onChecked, onRemoved }));
  return { hook, onChecked, onRemoved };
};

type ConfirmConfig = {
  content: string;
  okButtonProps: { danger: boolean };
  onOk: () => Promise<void>;
  title: string;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAutomationRowActions check', () => {
  it('shows progress, puts the refreshed row in place and confirms a healthy subscription', async () => {
    let resolve!: (item: InboundWebhookItem) => void;
    mocks.check.mockReturnValue(new Promise((r) => (resolve = r)));
    const { hook, onChecked } = setup();

    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.check();
    });
    expect(hook.result.current.checking).toBe(true);

    const resumed = row({ lastError: null, status: 'active' });
    await act(async () => {
      resolve(resumed);
      await pending;
    });

    expect(mocks.check).toHaveBeenCalledWith('wh_1');
    expect(onChecked).toHaveBeenCalledWith(resumed);
    expect(mocks.toast.success).toHaveBeenCalledWith('automations.check.healthy');
    expect(hook.result.current.checking).toBe(false);
  });

  it('names the problem a check found', async () => {
    mocks.check.mockResolvedValue(row({ lastError: 'auth', status: 'error' }));
    const { hook } = setup();

    await act(() => hook.result.current.check());

    expect(mocks.toast.error).toHaveBeenCalledWith(
      'automations.check.problem:automations.error.auth',
    );
  });

  it('asks to wait after a check that came too soon, and keeps the row', async () => {
    mocks.check.mockRejectedValue({ data: { code: 'TOO_MANY_REQUESTS' } });
    const { hook, onChecked, onRemoved } = setup();

    await act(() => hook.result.current.check());

    expect(mocks.toast.info).toHaveBeenCalledWith('automations.check.tooSoon');
    expect(onChecked).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(hook.result.current.checking).toBe(false);
  });

  it('drops a row the server no longer has', async () => {
    mocks.check.mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    const { hook, onRemoved } = setup();

    await act(() => hook.result.current.check());

    expect(mocks.toast.error).toHaveBeenCalledWith('automations.check.notFound');
    expect(onRemoved).toHaveBeenCalledWith('wh_1');
  });
});

describe('useAutomationRowActions delete', () => {
  const openDelete = (hook: ReturnType<typeof setup>['hook']) => {
    hook.result.current.confirmDelete();
    return mocks.confirmModal.mock.calls[0][0] as ConfirmConfig;
  };

  it('confirms with a danger button naming what stops, then drops the row', async () => {
    mocks.delete.mockResolvedValue({ success: true });
    const { hook, onRemoved } = setup();
    const config = openDelete(hook);

    expect(config.title).toBe('automations.delete.title');
    expect(config.content).toBe('automations.delete.content');
    expect(config.okButtonProps.danger).toBe(true);
    expect(mocks.delete).not.toHaveBeenCalled();

    await config.onOk();

    expect(mocks.delete).toHaveBeenCalledWith('wh_1');
    expect(onRemoved).toHaveBeenCalledWith('wh_1');
  });

  it('keeps the dialog open and the row in place when the delete fails', async () => {
    mocks.delete.mockRejectedValue(new Error('network'));
    const { hook, onRemoved } = setup();
    const config = openDelete(hook);

    await expect(config.onOk()).rejects.toThrow('network');
    expect(mocks.toast.error).toHaveBeenCalledWith('automations.delete.failed');
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('treats a row someone already deleted as done', async () => {
    mocks.delete.mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    const { hook, onRemoved } = setup();
    const config = openDelete(hook);

    await expect(config.onOk()).resolves.toBeUndefined();
    expect(mocks.toast.info).toHaveBeenCalledWith('automations.delete.alreadyGone');
    expect(onRemoved).toHaveBeenCalledWith('wh_1');
  });
});
