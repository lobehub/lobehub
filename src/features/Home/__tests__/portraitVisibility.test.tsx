import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortalViewType } from '@/store/chat/slices/portal/initialState';

interface RenderHomeOptions {
  isLogin?: boolean;
  portalViewType?: PortalViewType;
  search?: string;
  showHomePortrait?: boolean;
}

const stub = (testId: string) => ({ default: () => <div data-testid={testId} /> });
const modeStub = (testId: string) => ({
  default: ({ mode }: { mode?: string }) => <div data-mode={mode} data-testid={testId} />,
});

function translate() {
  return { i18n: { language: 'en-US' }, t: (key: string) => key };
}

const renderHome = async ({
  isLogin = true,
  portalViewType,
  search = '',
  showHomePortrait,
}: RenderHomeOptions = {}) => {
  vi.resetModules();
  window.history.replaceState(null, '', `/${search}`);

  vi.doMock('react-i18next', () => ({ useTranslation: translate }));
  vi.doMock('../HomeHeader', () => stub('home-header'));
  vi.doMock('../HomeModeContent', () => modeStub('home-mode-content'));
  vi.doMock('../HomePortrait', () => stub('home-portrait'));
  vi.doMock('../InputArea', () => modeStub('home-input-area'));
  vi.doMock('../PortraitBubble', () => stub('portrait-bubble'));
  vi.doMock('../AcceptancePortalDrawer', () => stub('acceptance-portal-drawer'));
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
    return selector({ status: { showHomePortrait } });
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
  }, 20000);

  it('opens the home dashboard in task mode for the post-onboarding entry', async () => {
    await renderHome({ search: '?onboarding=task' });

    expect(screen.getByTestId('home-input-area')).toHaveAttribute('data-mode', 'task');
    expect(screen.getByTestId('home-mode-content')).toHaveAttribute('data-mode', 'task');
    expect(window.location.search).toBe('');
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
