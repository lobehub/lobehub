/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasDeepLink } from './useCanvasDeepLink';

const mocks = vi.hoisted(() => ({
  location: {
    hash: '#section',
    pathname: '/acme/agent/agt_1/tpc_1',
    search: '?canvas=cvs_abc-1&source=tool',
  },
  navigate: vi.fn(),
  openCanvas: vi.fn(),
}));

vi.mock('react-router', () => ({ useLocation: () => mocks.location }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ openCanvas: mocks.openCanvas }) },
}));

describe('useCanvasDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location.search = '?canvas=cvs_abc-1&source=tool';
  });

  it('opens the canvas once and consumes only its query param', async () => {
    const { rerender } = renderHook(() => useCanvasDeepLink('tpc_1'));

    await waitFor(() => expect(mocks.openCanvas).toHaveBeenCalledWith('cvs_abc-1'));
    expect(mocks.navigate).toHaveBeenCalledWith('/acme/agent/agt_1/tpc_1?source=tool#section', {
      replace: true,
    });

    rerender();
    expect(mocks.openCanvas).toHaveBeenCalledTimes(1);
  });

  it('waits for the comment deep link to consume its params first', async () => {
    mocks.location.search = '?canvas=cvs_abc-1&comment=reply-1&commentThread=root-1';
    const { rerender } = renderHook(() => useCanvasDeepLink('tpc_1'));

    expect(mocks.openCanvas).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    mocks.location.search = '?canvas=cvs_abc-1';
    rerender();

    await waitFor(() => expect(mocks.openCanvas).toHaveBeenCalledWith('cvs_abc-1'));
    expect(mocks.navigate).toHaveBeenCalledWith('/acme/agent/agt_1/tpc_1#section', {
      replace: true,
    });
  });

  it('waits for the topic route', () => {
    renderHook(() => useCanvasDeepLink(undefined));

    expect(mocks.openCanvas).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each(['?source=tool', '?canvas=doc_1', '?canvas=cvs_../../x'])('ignores %s', (search) => {
    mocks.location.search = search;

    renderHook(() => useCanvasDeepLink('tpc_1'));

    expect(mocks.openCanvas).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
