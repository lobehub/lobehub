import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCopyAgentIdMenuItem } from './useCopyAgentIdMenuItem';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyToClipboard: mocks.copyToClipboard,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

const clickItem = async (agentId: string | null | undefined) => {
  const { result } = renderHook(() => useCopyAgentIdMenuItem(agentId));
  const item = result.current as { onClick: (info?: unknown) => Promise<void> } | null;
  await item?.onClick({ domEvent: { stopPropagation: vi.fn() } });
  return result.current;
};

describe('useCopyAgentIdMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyToClipboard.mockResolvedValue(undefined);
  });

  it('copies the agent id and confirms it', async () => {
    const item = await clickItem('agt_123');

    expect(item).toMatchObject({ key: 'copyAgentId', label: 'agent.copyId' });
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('agt_123');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('agent.copyIdSuccess');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('reports a failed copy instead of claiming success', async () => {
    mocks.copyToClipboard.mockRejectedValue(new Error('denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await clickItem('agt_123');

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('operationFailed');
  });

  it('offers no entry before the agent id is known', async () => {
    expect(await clickItem(undefined)).toBeNull();
  });
});
