import type * as LobechatConst from '@lobechat/const';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
        'productHunt.actionLabel': 'Support us',
        'productHunt.description': 'Support us on Product Hunt.',
        'productHunt.title': "We're on Product Hunt!",
        'userPanel.discord': 'Discord',
        'userPanel.docs': 'Docs',
        'userPanel.feedback': 'Feedback',
        'userPanel.help': 'Help',
        'userPanel.setting': 'Settings',
      })[key] || key,
  }),
}));

interface RenderFooterOptions {
  agentFinished?: boolean;
  agentStarted?: boolean;
  classicFinished?: boolean;
  desktop?: boolean;
  enabled?: boolean;
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
  classicFinished = true,
  desktop = false,
  enabled = true,
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
    default: () => null,
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
  vi.doMock('@/features/User/UserPanel/ThemeButton', () => ({
    default: () => null,
  }));
  function createFeedbackModalApi() {
    return { open: vi.fn() };
  }
  vi.doMock('@/hooks/useFeedbackModal', () => ({
    useFeedbackModal: createFeedbackModalApi,
  }));
  function createNavLayoutState() {
    return {
      bottomMenuItems: [],
      footer: {
        hideGitHub: true,
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
  vi.doUnmock('@/components/HighlightNotification');
  vi.doUnmock('@/features/User/UserPanel/ThemeButton');
  vi.doUnmock('@/hooks/useFeedbackModal');
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
