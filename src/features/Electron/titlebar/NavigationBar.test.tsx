import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavigationBar from './NavigationBar';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => void>(),
  leftPanelVisible: false,
  leftPanelWidth: 0,
  navigate: vi.fn(),
  openAllAgentsDrawer: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: () => void) => mocks.handlers.set(event, handler),
}));

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStaticStyles: () => ({ clock: 'clock', root: 'root' }),
}));

vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/services/electron/system', () => ({ electronSystemService: {} }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    leftPanelWidth: () => mocks.leftPanelWidth,
    showLeftPanel: () => mocks.leftPanelVisible,
  },
}));
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
    mocks.leftPanelVisible = false;
    mocks.leftPanelWidth = 0;
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

  it('keeps titlebar navigation width animatable when the sidebar is collapsed', () => {
    const { container, unmount } = render(<NavigationBar />);
    const navigationBar = container.querySelector('.root') as HTMLElement;

    expect(navigationBar).toHaveStyle({ width: '150px' });
    unmount();

    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 280;
    const expanded = render(<NavigationBar />);

    expect(expanded.container.querySelector('.root')).toHaveStyle({ width: '268px' });
  });
});
