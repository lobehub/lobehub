import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavigationBar from './NavigationBar';

const mocks = vi.hoisted(() => ({
  imLayout: false,
  isMac: false,
  handlers: new Map<string, () => void>(),
  leftPanelVisible: false,
  leftPanelWidth: 0,
  navPanelResizing: false,
  navigate: vi.fn(),
  openAllAgentsDrawer: vi.fn(),
}));

vi.mock('@/features/NavRail/useImLayout', () => ({ useImLayout: () => mocks.imLayout }));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: () => void) => mocks.handlers.set(event, handler),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createStaticStyles: () => ({ clock: 'clock', root: 'root' }),
}));

vi.mock('@/features/NavPanel/ToggleLeftPanelButton', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/services/electron/system', () => ({ electronSystemService: {} }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({ isNavPanelResizing: mocks.navPanelResizing }),
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
vi.mock('@/utils/platform', () => ({
  getPlatform: () => 'Linux',
  isMacOS: () => mocks.isMac,
}));
vi.mock('./WindowsAppMenu', () => ({ default: () => null }));
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
    mocks.imLayout = false;
    mocks.isMac = false;
    mocks.leftPanelVisible = false;
    mocks.leftPanelWidth = 0;
    mocks.navPanelResizing = false;
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

  it('spans the icon rail too under the im_layout trial', () => {
    mocks.imLayout = true;
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 280;
    const { container } = render(<NavigationBar />);

    // Icon rail (48) plus the list column, minus the 12px gutter.
    expect(container.querySelector('.root')).toHaveStyle({ width: '316px' });
  });

  it('follows the sidebar width without a transition while it is being resized', () => {
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 280;
    const idle = render(<NavigationBar />);

    expect(idle.container.querySelector('.root')).not.toHaveAttribute('data-resizing');
    idle.unmount();

    mocks.navPanelResizing = true;
    const resizing = render(<NavigationBar />);

    expect(resizing.container.querySelector('.root')).toHaveAttribute('data-resizing');
  });

  it('reserves the traffic light inset on macOS when the sidebar is collapsed', async () => {
    mocks.isMac = true;
    vi.resetModules();
    const { default: MacNavigationBar } = await import('./NavigationBar');

    const { container } = render(<MacNavigationBar />);

    expect(container.querySelector('.root')).toHaveStyle({ width: '184px' });
  });
});
