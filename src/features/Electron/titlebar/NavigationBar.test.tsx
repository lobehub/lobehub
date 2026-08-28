import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavigationBar from './NavigationBar';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  navigate: vi.fn(),
  openAllAgentsDrawer: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: () => void) => mocks.handlers.set(event, handler),
}));

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStaticStyles: () => ({ clock: 'clock' }),
}));

vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/services/electron/system', () => ({ electronSystemService: {} }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => 0 }));
vi.mock('@/store/global/selectors', () => ({ systemStatusSelectors: {} }));
vi.mock('@/store/home', () => ({
  getHomeStoreState: () => ({ openAllAgentsDrawer: mocks.openAllAgentsDrawer }),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: unknown) => unknown) =>
    selector({ activeRecentScope: { slug: 'acme', type: 'workspace' } }),
}));
vi.mock('@/styles/electron', () => ({ electronStylish: { nodrag: 'nodrag' } }));
vi.mock('@/utils/platform', () => ({ isMacOS: () => false }));
vi.mock('../navigation/useNavigationHistory', () => ({
  useNavigationHistory: () => ({
    canGoBack: false,
    canGoForward: false,
    goBack: vi.fn(),
    goForward: vi.fn(),
  }),
}));
vi.mock('./RecentlyViewed', () => ({ default: () => <div>recently-viewed</div> }));
vi.mock('./TrayMenu/useTrayMenuSync', () => ({ useTrayMenuSync: vi.fn() }));

describe('NavigationBar tray broadcasts', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
  });

  it('opens the existing Recently Viewed popover', () => {
    render(<NavigationBar />);

    act(() => mocks.handlers.get('openRecentlyViewed')?.());

    expect(screen.getByText('recently-viewed')).toBeInTheDocument();
  });

  it('opens the workspace agent browser without creating a topic', () => {
    render(<NavigationBar />);

    act(() => mocks.handlers.get('openAllAgents')?.());

    expect(mocks.navigate).toHaveBeenCalledWith('/acme', { escape: true });
    expect(mocks.openAllAgentsDrawer).toHaveBeenCalled();
  });
});
