import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEDULED_TASKS_COLUMN_WIDTH } from '@/features/NavPanel/hidesNavPanel';

import { NAV_RAIL_TAB_INSET } from './layout';
import NavigationBar from './NavigationBar';

const mocks = vi.hoisted(() => ({
  communityShowcase: false,
  isMac: false,
  isMobile: false,
  handlers: new Map<string, () => void>(),
  leftPanelVisible: false,
  leftPanelWidth: 0,
  navigate: vi.fn(),
  navRailEnabled: false,
  openAllAgentsDrawer: vi.fn(),
  pathname: '/',
}));

vi.mock('@lobechat/business-const', () => ({
  get COMMUNITY_SHOWCASE_LAYOUT() {
    return mocks.communityShowcase;
  },
  get NAV_RAIL_ENABLED() {
    return mocks.navRailEnabled;
  },
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: mocks.pathname, search: '' }),
}));

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
    mocks.communityShowcase = false;
    mocks.handlers.clear();
    mocks.isMac = false;
    mocks.isMobile = false;
    mocks.leftPanelVisible = false;
    mocks.leftPanelWidth = 0;
    mocks.navRailEnabled = false;
    mocks.pathname = '/';
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

  // The tabs follow this bar, so its width is where they start. With the icon rail on,
  // the content area sits a rail (56px) further right, and the tabs start an inset
  // inside it rather than on the divider.
  it('spans the icon rail and the tab inset when the sidebar is expanded', () => {
    mocks.navRailEnabled = true;
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 280;

    const { container } = render(<NavigationBar />);
    const navigationBar = container.querySelector('.root');

    expect(navigationBar).toHaveStyle({ width: `${280 + 56 + NAV_RAIL_TAB_INSET}px` });
    // The inset goes into the end padding too, so the buttons stay left of the divider.
    expect(navigationBar).toHaveStyle({ paddingRight: `${8 + NAV_RAIL_TAB_INSET}px` });
  });

  it('adds no inset without the icon rail', () => {
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 280;

    const { container } = render(<NavigationBar />);

    expect(container.querySelector('.root')).toHaveStyle({ paddingRight: '8px', width: '268px' });
  });

  it('leaves the collapsed width alone when the icon rail is on', () => {
    mocks.navRailEnabled = true;

    const { container } = render(<NavigationBar />);

    expect(container.querySelector('.root')).toHaveStyle({ paddingRight: '8px', width: '150px' });
  });

  // The scheduled-task workspace unmounts the panel and draws a fixed column of its
  // own there, so the tabs start after that column whatever the stored panel width is.
  it('spans the page column on the scheduled-task workspace', () => {
    mocks.navRailEnabled = true;
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 380;
    mocks.pathname = '/tasks';

    const expanded = render(<NavigationBar />);
    const expectedWidth = `${SCHEDULED_TASKS_COLUMN_WIDTH + 56 + NAV_RAIL_TAB_INSET}px`;
    expect(expanded.container.querySelector('.root')).toHaveStyle({ width: expectedWidth });
    expanded.unmount();

    // The page draws its column even while the app sidebar is collapsed.
    mocks.leftPanelVisible = false;
    const collapsed = render(<NavigationBar />);
    expect(collapsed.container.querySelector('.root')).toHaveStyle({ width: expectedWidth });
  });

  it('does not reserve a fixed column for the narrow scheduled workspace', () => {
    mocks.navRailEnabled = true;
    mocks.isMobile = true;
    mocks.pathname = '/tasks';

    const { container } = render(<NavigationBar />);
    expect(container.querySelector('.root')).toHaveStyle({ width: '150px' });
  });

  it('keeps the application panel on a task detail with a slug of tasks', () => {
    mocks.navRailEnabled = true;
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 380;
    mocks.pathname = '/acme/task/T-501/tasks';

    const { container } = render(<NavigationBar />);
    expect(container.querySelector('.root')).toHaveStyle({
      width: String(380 + 56 + NAV_RAIL_TAB_INSET) + 'px',
    });
  });

  // The showcase market draws no column at all, so there is nothing to span.
  it('follows the showcase market flag on the community page', () => {
    mocks.navRailEnabled = true;
    mocks.leftPanelVisible = true;
    mocks.leftPanelWidth = 280;
    mocks.pathname = '/community';

    const kept = render(<NavigationBar />);
    expect(kept.container.querySelector('.root')).toHaveStyle({
      width: `${280 + 56 + NAV_RAIL_TAB_INSET}px`,
    });
    kept.unmount();

    mocks.communityShowcase = true;
    const hidden = render(<NavigationBar />);
    expect(hidden.container.querySelector('.root')).toHaveStyle({
      paddingRight: '8px',
      width: '150px',
    });
  });

  it('reserves the traffic light inset on macOS when the sidebar is collapsed', async () => {
    mocks.isMac = true;
    vi.resetModules();
    const { default: MacNavigationBar } = await import('./NavigationBar');

    const { container } = render(<MacNavigationBar />);

    expect(container.querySelector('.root')).toHaveStyle({ width: '184px' });
  });
});
