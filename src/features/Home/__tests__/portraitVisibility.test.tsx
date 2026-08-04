import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface RenderHomeOptions {
  isLogin?: boolean;
  showHomePortrait?: boolean;
}

const stub = (testId: string) => ({ default: () => <div data-testid={testId} /> });

function translate() {
  return { i18n: { language: 'en-US' }, t: (key: string) => key };
}

const renderHome = async ({ isLogin = true, showHomePortrait }: RenderHomeOptions = {}) => {
  vi.resetModules();

  vi.doMock('react-i18next', () => ({ useTranslation: translate }));
  vi.doMock('../HomeHeader', () => stub('home-header'));
  vi.doMock('../HomeModeContent', () => stub('home-mode-content'));
  vi.doMock('../HomePortrait', () => stub('home-portrait'));
  vi.doMock('../InputArea', () => stub('home-input-area'));
  vi.doMock('../PortraitBubble', () => stub('portrait-bubble'));
  vi.doMock('@/features/HomeInbox', () => stub('home-inbox'));
  vi.doMock('@/store/chat', () => ({
    useChatStore: {
      getState: () => ({ mainInputEditor: undefined }),
      setState: vi.fn(),
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
  vi.doUnmock('react-i18next');
  vi.doUnmock('../HomeHeader');
  vi.doUnmock('../HomeModeContent');
  vi.doUnmock('../HomePortrait');
  vi.doUnmock('../InputArea');
  vi.doUnmock('../PortraitBubble');
  vi.doUnmock('@/features/HomeInbox');
  vi.doUnmock('@/store/chat');
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

  it('shows no portrait to a signed-out visitor even with the preference on', async () => {
    await renderHome({ isLogin: false, showHomePortrait: true });

    expect(screen.queryByTestId('home-portrait')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portrait-bubble')).not.toBeInTheDocument();
  }, 20000);
});
