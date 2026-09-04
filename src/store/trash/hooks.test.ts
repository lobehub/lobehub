import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { mutateTrash, useTrashDataSWR } from './hooks';
import { trashKeys } from './keys';

describe('trash SWR bridge', () => {
  it('isolates workspaces and revalidates concrete and predicate keys in the mounted provider', async () => {
    const fetcher = vi.fn(async ([, workspaceId]: readonly string[]) => workspaceId);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) =>
        useTrashDataSWR(trashKeys.list(workspaceId), fetcher),
      { initialProps: { workspaceId: 'workspace-a' }, wrapper },
    );

    await waitFor(() => expect(result.current.data).toBe('workspace-a'));
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await mutateTrash(trashKeys.list('workspace-a'));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    rerender({ workspaceId: 'workspace-b' });
    await waitFor(() => expect(result.current.data).toBe('workspace-b'));
    expect(fetcher).toHaveBeenCalledTimes(3);

    await act(async () => {
      await mutateTrash(trashKeys.list('workspace-a'));
    });
    expect(fetcher).toHaveBeenCalledTimes(3);

    await act(async () => {
      await mutateTrash(
        (key) => Array.isArray(key) && key[0] === 'trash:list' && key[1] === 'workspace-b',
      );
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
