import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { usePrivateAgentLinkNotice } from './index';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  warning: vi.fn(),
  workspaceId: 'ws-1' as string | undefined,
}));

vi.mock('@lobehub/ui', () => ({ toast: { warning: mocks.warning } }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));

vi.mock('./usePublishAgentToWorkspace', () => ({
  usePublishAgentToWorkspace: () => mocks.publish,
}));

const prefetch = vi.fn();

const setVisibility = (visibility: 'private' | 'public') =>
  useAgentStore.setState({
    agentMap: { agt_1: { id: 'agt_1', visibility } },
    prefetchAgentConfig: prefetch,
  });

describe('usePrivateAgentLinkNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceId = 'ws-1';
  });

  it('warns that other members cannot open a private agent link and offers publishing', async () => {
    setVisibility('private');
    const { result } = renderHook(() => usePrivateAgentLinkNotice());

    await expect(result.current('agt_1')).resolves.toBe(true);

    const options = mocks.warning.mock.calls[0][0];
    expect(options.title).toBe('privateAgentLink.title');
    expect(options.description).toBe('privateAgentLink.desc');
    options.actions[0].onClick();
    expect(mocks.publish).toHaveBeenCalledWith('agt_1');
  });

  it('stays quiet for a workspace agent', async () => {
    setVisibility('public');
    const { result } = renderHook(() => usePrivateAgentLinkNotice());

    await expect(result.current('agt_1')).resolves.toBe(false);
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('stays quiet outside a workspace', async () => {
    mocks.workspaceId = undefined;
    setVisibility('private');
    const { result } = renderHook(() => usePrivateAgentLinkNotice());

    await expect(result.current('agt_1')).resolves.toBe(false);
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('loads an uncached agent before deciding, so a cold project row still warns', async () => {
    prefetch.mockImplementationOnce(async () => setVisibility('private'));
    useAgentStore.setState({ agentMap: {}, prefetchAgentConfig: prefetch });
    const { result } = renderHook(() => usePrivateAgentLinkNotice());

    await expect(result.current('agt_1')).resolves.toBe(true);
    expect(prefetch).toHaveBeenCalledWith('agt_1');
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });
});
