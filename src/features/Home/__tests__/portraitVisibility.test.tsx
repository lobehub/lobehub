import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';

interface RenderHomeOptions {
  hiddenWidgets?: string[];
  isLogin?: boolean;
  portalViewType?: PortalViewType;
  promo?: ReactNode;
  search?: string;
  showHomePortrait?: boolean;
}

const stub = (testId: string) => ({ default: () => <div data-testid={testId} /> });
const modeStub = (testId: string) => ({
  default: ({ mode }: { mode?: string }) => <div data-mode={mode} data-testid={testId} />,
});
const inputAreaStub = {
  default: ({
    mode,
    showNewModelShortcuts,
  }: {
    mode?: string;
    showNewModelShortcuts?: boolean;
  }) => (
    <div data-mode={mode} data-testid={'home-input-area'}>
      {mode === 'chat' && showNewModelShortcuts && <div data-testid={'new-model-shortcuts'} />}
    </div>
  ),
};
const homeHeaderStub = stub('home-header');
const portraitBubbleStub = {
  default: ({ promo }: { promo?: ReactNode }) => <div data-testid={'portrait-bubble'}>{promo}</div>,
};

function translate() {
  return { i18n: { language: 'en-US' }, t: (key: string) => key };
}

const renderHome = async ({
  hiddenWidgets = [],
  isLogin = true,
  portalViewType,
  promo,
  search = '',
  showHomePortrait,
}: RenderHomeOptions = {}) => {
  vi.resetModules();
  window.history.replaceState(null, '', `/${search}`);

  vi.doMock('react-i18next', () => ({ useTranslation: translate }));
  vi.doMock('../HomeHeader', () => homeHeaderStub);
  vi.doMock('../HomeModeContent', () => modeStub('home-mode-content'));
  vi.doMock('../HomePortrait', () => stub('home-portrait'));
  vi.doMock('../InputArea', () => inputAreaStub);
  vi.doMock('../PortraitBubble', () => portraitBubbleStub);
  vi.doMock('../AcceptancePortalDrawer', () => stub('acceptance-portal-drawer'));
  vi.doMock('@/business/client/features/useHomePromoLine', () => ({
    useHomePromoLine: vi.fn(() => promo),
  }));
  vi.doMock('@/features/HomeInbox', () => stub('home-inbox'));
  function selectFromChatStore(selector: (state: unknown) => unknown) {
    return selector({ portalViewType });
  }
  selectFromChatStore.getState = () => ({ mainInputEditor: undefined });
  selectFromChatStore.setState = vi.fn();
  vi.doMock('@/store/chat', () => ({ useChatStore: selectFromChatStore }));
  vi.doMock('@/store/chat/selectors', () => ({
    chatPortalSelectors: {
      currentViewType: (state: { portalViewType?: PortalViewType }) => state.portalViewType ?? null,
    },
  }));
  function selectFromGlobalStore(selector: (state: unknown) => unknown) {
    return selector({ status: { hiddenHomeWidgets: hiddenWidgets, showHomePortrait } });
  }
  vi.doMock('@/store/global', () => ({ useGlobalStore: selectFromGlobalStore }));
  function selectFromUserStore(selector: (state: unknown) => unknown) {
    return selector({ isSignedIn: isLogin });
  }
  vi.doMock('@/store/user', () => ({ useUserStore: selectFromUserStore }));

  const { default: Home } = await import('../index');

  render(<Home />);
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.doUnmock('react-i18next');
  vi.doUnmock('../HomeHeader');
  vi.doUnmock('../HomeModeContent');
  vi.doUnmock('../HomePortrait');
  vi.doUnmock('../InputArea');
  vi.doUnmock('../PortraitBubble');
  vi.doUnmock('../AcceptancePortalDrawer');
  vi.doUnmock('@/business/client/features/useHomePromoLine');
  vi.doUnmock('@/features/HomeInbox');
  vi.doUnmock('@/store/chat');
  vi.doUnmock('@/store/chat/selectors');
  vi.doUnmock('@/store/global');
  vi.doUnmock('@/store/user');
});

describe('Home portrait visibility', () => {
  it('shows the portrait and its bubble by default for a signed-in viewer', async () => {
    await renderHome();

    expect(screen.getByTestId('home-portrait')).toBeInTheDocument();
    expect(screen.getByTestId('portrait-bubble')).toBeInTheDocument();
  }, 20000);

  it('keeps the portrait when the preference is explicitly on', async () => {
    await renderHome({ showHomePortrait: true });

    expect(screen.getByTestId('home-portrait')).toBeInTheDocument();
    expect(screen.getByTestId('portrait-bubble')).toBeInTheDocument();
  }, 20000);

  it('lets a live model promotion speak through the portrait without changing its shortcuts', async () => {
    await renderHome({ promo: <span>Campaign</span> });

    expect(screen.getByTestId('home-portrait')).toBeInTheDocument();
    expect(within(screen.getByTestId('portrait-bubble')).getByText('Campaign')).toBeInTheDocument();
    expect(screen.getByTestId('new-model-shortcuts')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('home-header')).queryByText('Campaign'),
    ).not.toBeInTheDocument();
  }, 20000);

  it('does not move the promotion elsewhere when the portrait is hidden', async () => {
    await renderHome({
      promo: <span>Campaign</span>,
      showHomePortrait: false,
    });

    expect(screen.queryByTestId('portrait-bubble')).not.toBeInTheDocument();
    expect(screen.queryByText('Campaign')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-model-shortcuts')).toBeInTheDocument();
  }, 20000);

  it('takes the bubble down with the portrait when the preference is off', async () => {
    await renderHome({ showHomePortrait: false });

    expect(screen.queryByTestId('home-portrait')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portrait-bubble')).not.toBeInTheDocument();
  }, 20000);

  it('leaves the rest of the dashboard standing without the portrait', async () => {
    await renderHome({ showHomePortrait: false });

    expect(screen.getByTestId('home-header')).toBeInTheDocument();
    expect(screen.getByTestId('home-main')).toBeInTheDocument();
    expect(screen.getByTestId('home-rail')).toBeInTheDocument();
  }, 20000);

  it('opens the home dashboard in chat mode by default', async () => {
    await renderHome();

    expect(screen.getByTestId('home-input-area')).toHaveAttribute('data-mode', 'chat');
    expect(screen.getByTestId('home-mode-content')).toHaveAttribute('data-mode', 'chat');
    expect(screen.getByTestId('new-model-shortcuts')).toBeInTheDocument();
  }, 20000);

  it('opens the home dashboard in task mode for the post-onboarding entry', async () => {
    await renderHome({ search: '?onboarding=task' });

    expect(screen.getByTestId('home-input-area')).toHaveAttribute('data-mode', 'task');
    expect(screen.getByTestId('home-mode-content')).toHaveAttribute('data-mode', 'task');
    expect(screen.queryByTestId('new-model-shortcuts')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  }, 20000);

  it('keeps model shortcuts out of the minimal layout', async () => {
    await renderHome({
      hiddenWidgets: [
        'goals',
        'needsYou',
        'unread',
        'running',
        'news',
        'suggestions',
        'recents',
        'tasks',
      ],
      showHomePortrait: false,
    });

    expect(screen.queryByTestId('new-model-shortcuts')).not.toBeInTheDocument();
  }, 20000);

  it('shows no portrait to a signed-out visitor even with the preference on', async () => {
    await renderHome({ isLogin: false, showHomePortrait: true });

    expect(screen.queryByTestId('home-portrait')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portrait-bubble')).not.toBeInTheDocument();
  }, 20000);

  it('loads the acceptance drawer only after an acceptance portal opens', async () => {
    await renderHome({ portalViewType: PortalViewType.Acceptance });

    expect(await screen.findByTestId('acceptance-portal-drawer')).toBeInTheDocument();
  }, 20000);

  it('does not load the acceptance drawer for unrelated portal views', async () => {
    await renderHome({ portalViewType: PortalViewType.TaskDetail });

    expect(screen.queryByTestId('acceptance-portal-drawer')).not.toBeInTheDocument();
  }, 20000);
});

describe('Home input banner queue', () => {
  it('reveals the next available segment after dismissing the current one', async () => {
    vi.resetModules();
    vi.doMock('@lobehub/ui/base-ui', () => ({
      ActionIcon: ({
        onClick,
        title,
      }: {
        onClick?: (e: React.MouseEvent) => void;
        title?: string;
      }) => <button aria-label={title} type={'button'} onClick={onClick} />,
    }));
    const { useGlobalStore } = await import('@/store/global');
    const originalDismissedIds = useGlobalStore.getState().status.dismissedBannerIds;
    const originalStatusInit = useGlobalStore.getState().isStatusInit;
    useGlobalStore.setState((state) => ({
      isStatusInit: true,
      status: { ...state.status, dismissedBannerIds: [] },
    }));

    try {
      const { InputBanner, InputBannerQueue, InputBannerSegment } =
        await import('../InputArea/InputBanner');
      const { container } = render(
        <InputBannerQueue>
          <InputBannerSegment dismissId={'first'}>
            <InputBanner dismissId={'first'} dismissTitle={'Dismiss first'} testId={'first'}>
              First
            </InputBanner>
          </InputBannerSegment>
          <InputBannerSegment dismissId={'second'}>
            <InputBanner dismissId={'second'} dismissTitle={'Dismiss second'} testId={'second'}>
              Second
            </InputBanner>
          </InputBannerSegment>
        </InputBannerQueue>,
      );

      expect(container.querySelector('[data-home-input-banner]')).toHaveTextContent('First');
      expect(screen.getByTestId('first')).toBeVisible();
      expect(screen.getByTestId('second')).not.toBeVisible();
      fireEvent.click(within(screen.getByTestId('first')).getByRole('button'));
      expect(container.querySelector('[data-home-input-banner]')).toHaveTextContent('Second');
      expect(screen.getByTestId('second')).toBeVisible();
    } finally {
      vi.doUnmock('@lobehub/ui/base-ui');
      useGlobalStore.setState((state) => ({
        isStatusInit: originalStatusInit,
        status: { ...state.status, dismissedBannerIds: originalDismissedIds },
      }));
    }
  }, 20000);
});
