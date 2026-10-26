import type { UIChatMessage } from '@lobechat/types';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDeepLinkBranchActivation } from './useDeepLinkBranchActivation';

const messages = [
  { id: 'u1', metadata: { activeBranchIndex: 1 }, role: 'user' },
  { id: 'a1', parentId: 'u1', role: 'assistant' },
  { id: 'a2', parentId: 'u1', role: 'assistant' },
] as UIChatMessage[];

const setup = (props: { navigationKey?: string; resolved?: boolean; targetId?: string }) => {
  const switchMessageBranch = vi.fn().mockResolvedValue(undefined);
  const initialProps = {
    deepLink: props.targetId
      ? { id: props.targetId, navigationKey: props.navigationKey ?? 'k1' }
      : undefined,
    messages,
    resolved: props.resolved ?? false,
    switchMessageBranch,
  };
  const hook = renderHook((current) => useDeepLinkBranchActivation(current), { initialProps });
  return { ...hook, initialProps, switchMessageBranch };
};

describe('useDeepLinkBranchActivation', () => {
  it('switches to the inactive branch holding a loaded target, once per navigation', async () => {
    const { initialProps, rerender, result, switchMessageBranch } = setup({ targetId: 'a1' });

    expect(result.current).toBe(true);
    await waitFor(() => expect(switchMessageBranch).toHaveBeenCalledWith('a1', 0));

    rerender({ ...initialProps, messages: [...messages] });
    expect(switchMessageBranch).toHaveBeenCalledTimes(1);

    rerender({ ...initialProps, deepLink: { id: 'a1', navigationKey: 'k2' } });
    await waitFor(() => expect(switchMessageBranch).toHaveBeenCalledTimes(2));
  });

  it('leaves branches alone when the target already renders or is not loaded', () => {
    expect(setup({ resolved: true, targetId: 'a1' }).switchMessageBranch).not.toHaveBeenCalled();

    const unloaded = setup({ targetId: 'older' });
    expect(unloaded.result.current).toBe(false);
    expect(unloaded.switchMessageBranch).not.toHaveBeenCalled();
  });
});
