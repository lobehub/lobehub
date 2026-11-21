import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRestoreInboxDefaultMenuItem } from './useRestoreInboxDefaultMenuItem';

const mocks = vi.hoisted(() => ({
  access: { canManageResource: true },
  confirmModal: vi.fn(),
  permission: { allowed: true },
  resetInboxAgent: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => mocks.permission }));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => mocks.access,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ resetInboxAgent: mocks.resetInboxAgent }),
}));

type Item = { onClick: (info?: unknown) => void } | null;

/** Click the entry and confirm the dialog it opens. */
const restore = async (agentId: string | null | undefined) => {
  const { result } = renderHook(() => useRestoreInboxDefaultMenuItem(agentId));
  (result.current as Item)?.onClick({ domEvent: { stopPropagation: vi.fn() } });
  await mocks.confirmModal.mock.calls[0]?.[0].onOk();
  return result.current;
};

describe('useRestoreInboxDefaultMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { canManageResource: true };
    mocks.permission = { allowed: true };
    mocks.resetInboxAgent.mockResolvedValue(undefined);
  });

  it('asks before restoring, then restores and confirms it', async () => {
    const item = await restore('agt_inbox');

    expect(item).toMatchObject({ key: 'restoreDefault', label: 'agent.restoreDefault' });
    expect(mocks.confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'agent.restoreDefault.confirm.content',
        title: 'agent.restoreDefault.confirm.title',
      }),
    );
    expect(mocks.resetInboxAgent).toHaveBeenCalledWith('agt_inbox');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('agent.restoreDefault.success');
  });

  it('does nothing until the dialog is confirmed', () => {
    const { result } = renderHook(() => useRestoreInboxDefaultMenuItem('agt_inbox'));
    (result.current as Item)?.onClick();

    expect(mocks.resetInboxAgent).not.toHaveBeenCalled();
  });

  it('reports a failed restore instead of claiming success', async () => {
    mocks.resetInboxAgent.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await restore('agt_inbox');

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('operationFailed');
  });

  it('explains a permission refusal', async () => {
    mocks.resetInboxAgent.mockRejectedValue({ data: { code: 'FORBIDDEN' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await restore('agt_inbox');

    expect(mocks.toastError).toHaveBeenCalledWith('manageOnlyCreator');
  });

  it.each([
    ['the agent id is not known yet', () => undefined, undefined],
    [
      'the role cannot edit content',
      () => void (mocks.permission = { allowed: false }),
      'agt_inbox',
    ],
    [
      'the member does not manage the shared agent',
      () => void (mocks.access = { canManageResource: false }),
      'agt_inbox',
    ],
  ])('offers no entry when %s', (_reason, arrange, agentId) => {
    arrange();
    const { result } = renderHook(() => useRestoreInboxDefaultMenuItem(agentId));

    expect(result.current).toBeNull();
  });
});
