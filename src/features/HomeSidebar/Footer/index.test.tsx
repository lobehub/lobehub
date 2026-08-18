import type * as BusinessConst from '@lobechat/business-const';
import { DESKTOP_APP_ENABLED } from '@lobechat/business-const';
import type * as LobechatConst from '@lobechat/const';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
  hiddenMenuKeys?: readonly string[];
  hideGitHub?: boolean;
  homeSidebar?: boolean;
  isDevMode?: boolean;
}

let mockServerConfigState: Record<string, unknown>;
let mockUserState: Record<string, unknown>;

const renderFooter = async ({
  billboardItems = [],
  desktop = false,
  enableBusinessFeatures = false,
  hiddenMenuKeys,
  homeSidebar = false,
  hideGitHub = true,
  isDevMode = false,
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
    settings: { general: { isDevMode } },
  };

  // Partial mock so the rest of the branding surface stays real; overriding
  // only the deny-list keeps both halves of it testable whatever this build
  // ships.
  if (hiddenMenuKeys) {
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      FOOTER_HIDDEN_MENU_KEYS: hiddenMenuKeys,
    }));
  }
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
  vi.doMock('@/features/NavPanel/useActiveNavKey', () => ({
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

/**
 * Pay the module graph's first-import cost once, outside any test's clock.
 *
 * Footer pulls in a wide graph, and transforming it cold takes longer than the
 * per-test timeout on its own — enough that whichever test happened to run
 * first would time out while every test after it passed on the warm cache. That
 * reads as a flaky assertion in one test rather than a fixed cost paid by
 * whoever goes first, so it is paid here instead.
 */
beforeAll(async () => {
  await import('./index');
}, 120_000);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock('@lobechat/business-const');
  vi.doUnmock('@lobechat/const');
  vi.doUnmock('@lobehub/analytics/react');
  vi.doUnmock('@/components/ChangelogModal');
  vi.doUnmock('@/components/FeedbackModal');
  vi.doUnmock('@/features/Billboard');
  vi.doUnmock('@/features/Billboard/MenuItems');
  vi.doUnmock('@/features/NavPanel/useActiveNavKey');
  vi.doUnmock('@/features/User/UserPanel/ThemeButton');
  vi.doUnmock('@/features/Workspace/WorkspaceLink');
  vi.doUnmock('@/hooks/useNavLayout');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
});

// `hiddenMenuKeys: []` on the cases below is deliberate: they assert on entries
// (invite friend, GitHub) that FOOTER_HIDDEN_MENU_KEYS lets a distribution drop,
// so they state the upstream default rather than inheriting whatever this build
// ships. The deny-list itself is covered by its own cases.
describe('Footer help menu tracking', () => {
  // The entry only exists where the distribution actually ships an app to
  // download, so assert whichever half is true for this build rather than
  // pinning the upstream default.
  it.runIf(DESKTOP_APP_ENABLED)(
    'shows Get App immediately before GitHub on web',
    async () => {
      const user = userEvent.setup();
      await renderFooter({ hideGitHub: false });

      await user.click(screen.getByRole('button', { name: 'Help' }));

      const getApp = await screen.findByRole('link', { name: 'Get App' });
      const github = screen.getByRole('link', { name: 'GitHub' });

      expect(getApp).toHaveAttribute('href', '/apps');
      expect(
        getApp.compareDocumentPosition(github) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
    20000,
  );

  it.runIf(!DESKTOP_APP_ENABLED)(
    'omits Get App when the distribution ships no downloadable app',
    async () => {
      const user = userEvent.setup();
      await renderFooter({ hiddenMenuKeys: [], hideGitHub: false });

      await user.click(screen.getByRole('button', { name: 'Help' }));

      expect(screen.queryByRole('link', { name: 'Get App' })).not.toBeInTheDocument();
      // The rest of the menu is untouched.
      expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument();
    },
    20000,
  );

  it('does not show Get App in desktop builds', async () => {
    const user = userEvent.setup();
    await renderFooter({ desktop: true, hideGitHub: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.queryByRole('link', { name: 'Get App' })).not.toBeInTheDocument();
  }, 20000);

  it('drops the entries the distribution hides, and the separators they strand', async () => {
    const user = userEvent.setup();
    await renderFooter({
      enableBusinessFeatures: true,
      hiddenMenuKeys: ['inviteFriend', 'docs', 'feedback', 'discord', 'github'],
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    for (const name of ['Invite a friend', 'Docs', 'Feedback', 'Discord']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }

    // What the deployment does serve itself stays.
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Changelog')).toBeInTheDocument();

    // Settings and Changelog were separated by two rules with the hidden block
    // between them; one survives, and neither end of the menu is left with a
    // rule pointing at nothing.
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('[role="separator"], .lobe-dropdown-menu-separator')).toHaveLength(
      1,
    );
  }, 20000);

  it('reports only the surviving keys when the menu is opened', async () => {
    const user = userEvent.setup();
    await renderFooter({
      enableBusinessFeatures: true,
      hiddenMenuKeys: ['inviteFriend', 'docs', 'feedback', 'discord', 'github'],
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const openedCall = analyticsTrack.mock.calls.find(
      ([event]) => event?.name === 'home_footer_menu_opened',
    );
    const keys = (openedCall![0].properties.keys as string).split(',');

    // A key that can never be clicked must not sit in the CTR denominator.
    expect(keys).not.toContain('inviteFriend');
    expect(keys).not.toContain('docs');
    expect(keys).toContain('changelog');
  }, 20000);

  // Everything this menu can hold is conditional, so "all of it is gone" is a
  // reachable state rather than a theoretical one: a distribution hides most of
  // it, and `setting` — the entry meant to survive that — is itself dropped for
  // a dev-mode user, who gets a dedicated settings button beside this one.
  const ALL_OPTIONAL_KEYS = [
    'inviteFriend',
    'docs',
    'feedback',
    'discord',
    'github',
    'changelog',
    'get-app',
  ];

  it('hides the help trigger when nothing is left to put in it', async () => {
    await renderFooter({
      enableBusinessFeatures: true,
      hiddenMenuKeys: ALL_OPTIONAL_KEYS,
      isDevMode: true,
    });

    // An empty popover reads as a menu that failed to load, so the button that
    // opens it goes too.
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
    // The footer itself still works — dev mode puts settings next to it.
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  }, 20000);

  it('keeps the help trigger while a single entry survives', async () => {
    const user = userEvent.setup();
    await renderFooter({
      enableBusinessFeatures: true,
      hiddenMenuKeys: ALL_OPTIONAL_KEYS,
    });

    // Same deny-list as above; only `setting` differs, and one entry is enough.
    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.getByText('Settings')).toBeInTheDocument();
  }, 20000);

  it('opens the billboard group without a separator above it when it stands alone', async () => {
    const user = userEvent.setup();
    await renderFooter({
      billboardItems: [{ key: 'billboard-promo', label: 'Promo', onClick: vi.fn() }],
      enableBusinessFeatures: true,
      hiddenMenuKeys: ALL_OPTIONAL_KEYS,
      homeSidebar: true,
      isDevMode: true,
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(await screen.findByText('Promo')).toBeInTheDocument();
    // The rule divides the menu's own entries from the billboard's; with none of
    // the former left it has nothing to divide.
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('[role="separator"], .lobe-dropdown-menu-separator')).toHaveLength(
      0,
    );
  }, 20000);

  it('tracks menu open with the visible item keys', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: true, hiddenMenuKeys: [] });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const openedCall = analyticsTrack.mock.calls.find(
      ([event]) => event?.name === 'home_footer_menu_opened',
    );
    expect(openedCall).toBeTruthy();
    expect((openedCall![0].properties.keys as string).split(',')).toContain('inviteFriend');
  }, 20000);

  it('tracks a unified click event when the invite friend entry is clicked', async () => {
    const user = userEvent.setup();
    await renderFooter({ enableBusinessFeatures: true, hiddenMenuKeys: [] });

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
      hiddenMenuKeys: [],
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
