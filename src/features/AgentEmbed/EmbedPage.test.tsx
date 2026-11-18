import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ getEmbedHostBridge: vi.fn() }));
vi.mock('./hostBridge', () => bridge);

const { default: AgentEmbedPage } = await import('./EmbedPage');

const renderAt = (path: string) => {
  const router = createMemoryRouter(
    [
      { element: <AgentEmbedPage />, path: '/embed/agent/:slugOrId/:topicId?' },
      { element: <div>settings page</div>, path: '/settings' },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

const setFramed = (framed: boolean) =>
  Object.defineProperty(window, 'parent', { configurable: true, value: framed ? {} : window });

afterEach(() => {
  setFramed(false);
  vi.restoreAllMocks();
});

describe('AgentEmbedPage', () => {
  it('shows the unavailable state where the deployment has no embed chat, and starts the bridge after render', () => {
    renderAt('/embed/agent/my-bot');

    expect(screen.getByText('share.embed.unavailable.title')).toBeInTheDocument();
    expect(bridge.getEmbedHostBridge).toHaveBeenCalled();
  });

  it('opens an in-app navigation away from the embed page in a new tab while framed', async () => {
    setFramed(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const router = renderAt('/embed/agent/my-bot');

    await act(() => router.navigate('/settings?tab=1'));

    expect(open).toHaveBeenCalledWith('/settings?tab=1', '_blank', 'noopener,noreferrer');
    expect(router.state.location.pathname).toBe('/embed/agent/my-bot');

    await act(() => router.navigate('/embed/agent/my-bot/tpc_1'));
    expect(router.state.location.pathname).toBe('/embed/agent/my-bot/tpc_1');
  });

  it('lets the page navigate normally when it is not framed', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const router = renderAt('/embed/agent/my-bot');

    await act(() => router.navigate('/settings'));

    expect(open).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/settings');
  });
});
