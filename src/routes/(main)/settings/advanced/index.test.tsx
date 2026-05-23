import { render, screen } from '@testing-library/react';
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
  Icon: () => null,
  Skeleton: () => <div>loading</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Select: () => <button />,
  Switch: () => <button />,
}));

vi.mock('@/routes/(main)/settings/features/SettingHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('@/services/electron/autoUpdate', () => ({
  autoUpdateService: {
    getUpdateChannel: vi.fn().mockResolvedValue('stable'),
    setUpdateChannel: vi.fn(),
  },
}));

const createWrapper = () => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider createStore={() => initServerConfigStore({})}>{children}</Provider>
  );

  return Wrapper;
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  useUserStore.setState(initialUserStoreState, true);
});

describe('Advanced settings page', () => {
  it('uses distinct group titles for tools and app updates', () => {
    useUserStore.setState({
      isUserStateInit: true,
      setSettings: vi.fn(),
      updateLab: vi.fn(),
    });

    render(<Page />, { wrapper: createWrapper() });

    expect(screen.getByText('tab.advanced.toolsAndDiagnostics.title')).toBeDefined();
    expect(screen.getByText('tab.advanced.appUpdates.title')).toBeDefined();
  });
});
