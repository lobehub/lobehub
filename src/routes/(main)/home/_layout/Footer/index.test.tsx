import type * as LobechatConst from '@lobechat/const';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const analyticsTrack = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) =>
      ({
        'agentOnboardingPromo.actionLabel': 'Try it now',
        'agentOnboardingPromo.description':
          'Set up your agent teams in a quick chat with Lobe AI. Your existing agents remain unchanged.',
        'agentOnboardingPromo.title': 'Quick Wizard',
        'changelog': 'Changelog',
        'getApp': 'Get App',
        'productHunt.actionLabel': 'Support us',
        'productHunt.description': 'Support us on Product Hunt.',
        'productHunt.title': "We're on Product Hunt!",
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
  agentFinished?: boolean;
  agentStarted?: boolean;
  billboardItems?: unknown[];
  classicFinished?: boolean;
  desktop?: boolean;
  enableBusinessFeatures?: boolean;
  enabled?: boolean;
  hideGitHub?: boolean;
  homeSidebar?: boolean;
  mobile?: boolean;
  readSlugs?: string[];
  serverConfigInit?: boolean;
}

let mockGlobalState: Record<string, unknown>;
let mockServerConfigState: Record<string, unknown>;
let mockUserState: Record<string, unknown>;

interface MockStoreHook {
  (selector: (state: Record<string, unknown>) => unknown): unknown;
  getState: () => Record<string, unknown>;
}

const createGlobalState = (readSlugs: string[] = []) => ({
  status: {
    readNotificationSlugs: readSlugs,
  },
  updateSystemStatus: vi.fn((patch: { readNotificationSlugs?: string[] }) => {
    mockGlobalState = {
      ...mockGlobalState,
      status: {
        ...(mockGlobalState.status as Record<string, unknown>),
        ...patch,
      },
    };
  }),
});

const renderFooter = async ({
  agentFinished = false,
  agentStarted = false,
  billboardItems = [],
  classicFinished = true,
  desktop = false,
  enabled = true,
  enableBusinessFeatures = false,
  homeSidebar = false,
  hideGitHub = true,
  mobile = false,
  readSlugs = [],
  serverConfigInit = true,
}: RenderFooterOptions = {}) => {
  vi.resetModules();
  analyticsTrack.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  });

  mockGlobalState = createGlobalState(readSlugs);
  mockServerConfigState = {
    enableBusinessFeatures,
    featureFlags: { enableAgentOnboarding: enabled },
    isMobile: mobile,
    serverConfigInit,
  };
  mockUserState = {
    agentOnboarding: {
      activeTopicId: agentStarted ? 'topic-1' : undefined,
      finishedAt: agentFinished ? '2026-04-15T00:00:00.000Z' : undefined,
    },
    defaultSettings: {},
    onboarding: classicFinished ? { finishedAt: '2026-04-14T00:00:00.000Z' } : undefined,
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
  vi.doMock('@/components/HighlightNotification', () => ({
    default: (props: {
      actionLabel?: string;
      description?: string;
      onAction?: () => void;
      onActionClick?: () => void;
      onClose?: () => void;
      open?: boolean;
      title?: string;
    }) =>
      props.open ? (
        <div data-testid="highlight-notification">
          <div>{props.title}</div>
          <div>{props.description}</div>
          <button type="button" onClick={props.onClose}>
            Close promo
          </button>
          {props.actionLabel && (
            <button
              type="button"
              onClick={() => {
                if (props.onAction) props.onAction();
                else props.onActionClick?.();
              }}
            >
              {props.actionLabel}
            </button>
          )}
        </div>
      ) : null,
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
  const selectFromGlobalStore = ((selector: (state: Record<string, unknown>) => unknown) =>
    selector(mockGlobalState)) as MockStoreHook;
  vi.doMock('@/store/global', () => {
    selectFromGlobalStore.getState = () => mockGlobalState;

    return { useGlobalStore: selectFromGlobalStore };
  });
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
        <Route element={<div>Agent onboarding route</div>} path="/onboarding/agent" />
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
  vi.doUnmock('@/components/HighlightNotification');
  vi.doUnmock('@/features/Billboard');
  vi.doUnmock('@/features/Billboard/MenuItems');
  vi.doUnmock('@/features/NavPanel');
  vi.doUnmock('@/features/User/UserPanel/ThemeButton');
  vi.doUnmock('@/features/Workspace/WorkspaceLink');
  vi.doUnmock('@/hooks/useNavLayout');
  vi.doUnmock('@/store/global');
  vi.doUnmock('@/store/serverConfig');
  vi.doUnmock('@/store/user');
});

describe('Footer agent onboarding promotion', () => {
  it('shows the agent onboarding promotion for eligible web users', async () => {
    await renderFooter();

    expect(screen.getByTestId('highlight-notification')).toBeInTheDocument();
    expect(screen.getByText('Quick Wizard')).toBeInTheDocument();
    expect(analyticsTrack).toHaveBeenCalledWith({
      name: 'agent_onboarding_promo_viewed',
      properties: {
        spm: 'homepage.agent_onboarding_promo.viewed',
        trigger: 'auto',
      },
    });
  }, 40000);

  it('stores the dismiss slug when the agent onboarding promotion is closed', async () => {
    const user = userEvent.setup();
    await renderFooter();
    const card = screen.getAllByTestId('highlight-notification').at(-1)!;

    await user.click(within(card).getByRole('button', { name: 'Close promo' }));

    expect(
      (mockGlobalState.status as { readNotificationSlugs: string[] }).readNotificationSlugs,
    ).toContain('agent-onboarding-promo-v1');
  }, 20000);

  it('marks the promotion as read and navigates into agent onboarding on CTA click', async () => {
    const user = userEvent.setup();
    await renderFooter();
    const card = screen.getAllByTestId('highlight-notification').at(-1)!;

    await user.click(within(card).getByRole('button', { name: 'Try it now' }));

    expect(
      (mockGlobalState.status as { readNotificationSlugs: string[] }).readNotificationSlugs,
    ).toContain('agent-onboarding-promo-v1');
    expect(screen.getByText('Agent onboarding route')).toBeInTheDocument();
    expect(analyticsTrack).toHaveBeenCalledWith({
      name: 'agent_onboarding_promo_clicked',
      properties: {
        spm: 'homepage.agent_onboarding_promo.clicked',
      },
    });
  }, 20000);

  it('does not show the promotion after agent onboarding has already started', async () => {
    await renderFooter({ agentStarted: true });

    expect(screen.queryByTestId('highlight-notification')).not.toBeInTheDocument();
  });

  it('does not show the promotion when classic onboarding is not finished', async () => {
    await renderFooter({ classicFinished: false });

    expect(screen.queryByTestId('highlight-notification')).not.toBeInTheDocument();
  });

  it('does not show the promotion after the current device has dismissed it', async () => {
    await renderFooter({ readSlugs: ['agent-onboarding-promo-v1'] });

    expect(screen.queryByTestId('highlight-notification')).not.toBeInTheDocument();
  });

  it('does not show the promotion on mobile web variants', async () => {
    await renderFooter({ mobile: true });

    expect(screen.queryByTestId('highlight-notification')).not.toBeInTheDocument();
  });

  it('does not show the promotion on desktop builds', async () => {
    await renderFooter({ desktop: true });

    expect(screen.queryByTestId('highlight-notification')).not.toBeInTheDocument();
  });
});

describe('Footer help menu tracking', () => {
  it('shows Get App immediately before GitHub on web', async () => {
    const user = userEvent.setup();
    await renderFooter({ hideGitHub: false });

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const getApp = await screen.findByRole('link', { name: 'Get App' });
    const github = screen.getByRole('link', { name: 'GitHub' });

    expect(getApp).toHaveAttribute('href', '/downloads');
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
