import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import Page from './index';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    labItem: 'lab-item',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Form: ({
    items,
  }: {
    items: {
      children: { children?: ReactNode; desc?: string; label: string }[];
      title: string;
    }[];
  }) => (
    <div>
      {items.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          {group.children.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              {item.children}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
  Skeleton: () => <div>loading</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Switch: () => <button />,
}));

vi.mock('@/routes/(main)/settings/features/SettingHeader', () => ({
  default: ({ description, title }: { description?: string; title: string }) => (
    <header>
      <h1>{title}</h1>
      {description}
    </header>
  ),
}));

const createWrapper = () => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider createStore={() => initServerConfigStore({})}>{children}</Provider>
  );

  return Wrapper;
};

const initialUserStoreState = useUserStore.getState();

const renderPage = () => {
  useUserStore.setState({
    isUserStateInit: true,
    updateLab: vi.fn(),
  });

  return render(<Page />, { wrapper: createWrapper() });
};

afterEach(() => {
  cleanup();
  useUserStore.setState(initialUserStoreState, true);
});

describe('Labs settings page', () => {
  it('explains that Labs features are experimental', () => {
    renderPage();

    expect(screen.getByText('description')).toBeDefined();
  });

  it('splits experiments into General and Desktop groups', () => {
    renderPage();

    expect(screen.getByText('group.general')).toBeDefined();
    // Desktop group only renders in the Electron shell (isDesktop mocked true).
    expect(screen.getByText('group.desktop')).toBeDefined();
  });

  it('renders the message text selection actions lab toggle', () => {
    renderPage();

    expect(screen.getByText('features.messageTextSelectionActions.title')).toBeDefined();
  });

  it('renders the OAuth Apps lab toggle', () => {
    renderPage();

    expect(screen.getByText('features.oauthApps.title')).toBeDefined();
  });

  it('renders the topic acceptance (tray) lab toggle', () => {
    renderPage();

    expect(screen.getByText('features.topicAcceptance.title')).toBeDefined();
  });

  it('does not render released task verify as a lab toggle', () => {
    renderPage();

    expect(screen.queryByText('features.taskVerify.title')).toBeNull();
  });
});
