import type * as LobechatConst from '@lobechat/const';
import { DOWNLOAD_URL } from '@lobechat/const';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const analyticsTrack = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) =>
      ({
        'changelog': 'Changelog',
        'getApp': 'Get App',
        'userPanel.discord': 'Discord',
        'userPanel.docs': 'Docs',
        'userPanel.feedback': 'Feedback',
        'userPanel.help': 'Help',
        'userPanel.inviteFriend': 'Invite a friend',
        'userPanel.setting': 'Settings',
      })[key] || key,
  }),
}));

interface RenderFooterOptions {
  billboardItems?: unknown[];
  desktop?: boolean;
  enableBusinessFeatures?: boolean;
  hideGitHub?: boolean;
  homeSidebar?: boolean;
}

let mockServerConfigState: Record<string, unknown>;
let mockUserState: Record<string, unknown>;

const renderFooter = async ({
  billboardItems = [],
  desktop = false,
  enableBusinessFeatures = false,
  homeSidebar = false,
  hideGitHub = true,
}: RenderFooterOptions = {}) => {
  vi.resetModules();
  analyticsTrack.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  });

  mockServerConfigState = {
    enableBusinessFeatures,
  };
  mockUserState = {
    defaultSettings: {},
    settings: { general: { isDevMode: false } },
  };

  vi.doMock('@lobechat/const', async (importOriginal) => {
    const actual = (await importOriginal()) as typeof LobechatConst;

    return {
      ...actual,
      isDesktop: desktop,
    };
  });
  function createAnalyticsApi() {
    return {
      analytics: { track: analyticsTrack },
    };
  }
  vi.doMock('@lobehub/analytics/react', () => ({
    useAnalytics: createAnalyticsApi,
  }));
  vi.doMock('@/components/ChangelogModal', () => ({
    default: vi.fn(),
    openChangelogModal: vi.fn(),
  }));
  vi.doMock('@/components/FeedbackModal', () => ({
    default: vi.fn(),
    openFeedbackModal: vi.fn(),
  }));
  vi.doMock('@/features/Billboard', () => ({
    default: () => null,
  }));
  vi.doMock('@/features/Billboard/MenuItems', () => ({
    useBillboardMenuItems: () => billboardItems,
  }));
  vi.doMock('@/features/NavPanel', () => ({
    useActiveNavKey: () => (homeSidebar ? 'home' : 'discover'),
  }));
  vi.doMock('@/features/User/UserPanel/ThemeButton', () => ({
    default: () => null,
  }));
  vi.doMock('@/features/Workspace/WorkspaceLink', () => ({
    default: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  }));
  function createNavLayoutState() {
    return {
      bottomMenuItems: [],
      footer: {
        hideGitHub,
        layout: 'compact',
        showEvalEntry: false,
        showSettingsEntry: true,
      },
      topNavItems: [],
      userPanel: {
        showDataImporter: false,
        showMemory: true,
      },
    };
  }
  vi.doMock('@/hooks/useNavLayout', () => ({
    useNavLayout: createNavLayoutState,
  }));
  function selectFromServerConfigStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(mockServerConfigState);
  }
  vi.doMock('@/store/serverConfig', () => ({
    serverConfigSelectors: {
      enableBusinessFeatures: (s: Record<string, unknown>) => !!s.enableBusinessFeatures,
    },
    useServerConfigStore: selectFromServerConfigStore,
  }));
  function selectFromUserStore(selector: (state: Record<string, unknown>) => unknown) {
    return selector(mockUserState);
  }
  vi.doMock('@/store/user', () => ({
    useUserStore: selectFromUserStore,
  }));

  const { default: Footer } = await import('./index');

  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Footer />} path="/" />
        <Route element={<div>Onboarding route</div>} path="/onboarding" />
      </Routes>
    </MemoryRouter>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@lobehub/analytics/react');
  vi.doUnmock('@/components/ChangelogModal');
  vi.doUnmock('@/components/FeedbackModal');
  vi.doUnmock('@/features/Billboard');
  vi.doUnmock('@/features/Billboard/MenuItems');
  vi.doUnmock('@/features/NavPanel');
  vi.doUnmock('@/features/User/UserPanel/ThemeButton');
  vi.doUnmock('@/features/Workspace/WorkspaceLink');
  vi.doUnmock('@/hooks/useNavLayout');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
});

describe('Footer help menu tracking', () => {
  it('shows Get App immediately before GitHub on web', async () => {
    const user = userEvent.setup();
    await renderFooter({ hideGitHub: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const getApp = await screen.findByRole('link', { name: 'Get App' });
    const github = screen.getByRole('link', { name: 'GitHub' });

    expect(getApp).toHaveAttribute('href', DOWNLOAD_URL.default);
    expect(getApp.compareDocumentPosition(github) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20000);

  it('does not show Get App in desktop builds', async () => {
    const user = userEvent.setup();
    await renderFooter({ desktop: true, hideGitHub: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.queryByRole('link', { name: 'Get App' })).not.toBeInTheDocument();
  }, 20000);

  it('tracks menu open with the visible item keys', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const openedCall = analyticsTrack.mock.calls.find(
      ([event]) => event?.name === 'home_footer_menu_opened',
    );
    expect(openedCall).toBeTruthy();
    expect((openedCall![0].properties.keys as string).split(',')).toContain('inviteFriend');
  }, 20000);

  it('tracks a unified click event when the invite friend entry is clicked', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: true });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(await screen.findByText('Invite a friend'));

    expect(analyticsTrack).toHaveBeenCalledWith({
      name: 'home_footer_menu_clicked',
      properties: { key: 'inviteFriend', spm: 'homepage.footer.inviteFriend.clicked' },
    });
  }, 20000);

  it('does not render the invite friend entry without business features', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.queryByText('Invite a friend')).not.toBeInTheDocument();
  }, 20000);

  it('excludes billboard items from the opened keys to keep per-key CTR aligned', async () => {
    const user = userEvent.setup();
    await renderFooter({
      billboardItems: [{ key: 'billboard-promo', label: 'Promo', onClick: vi.fn() }],
      enableBusinessFeatures: true,
      homeSidebar: true,
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const openedCall = analyticsTrack.mock.calls.find(
      ([event]) => event?.name === 'home_footer_menu_opened',
    );
    const keys = (openedCall![0].properties.keys as string).split(',');
    // own items are tracked and reported as exposure...
    expect(keys).toContain('inviteFriend');
    // ...but billboard items (which emit their own billboard_* events) are not,
    // so their CTR denominator never gets an orphaned exposure.
    expect(keys).not.toContain('billboard-promo');
  }, 20000);
});
