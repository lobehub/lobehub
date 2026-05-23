import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';

import AdvancedActions from './Advanced';

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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
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
              {item.desc && <span>{item.desc}</span>}
              {item.children}
            </div>
          ))}
        </section>
      ))}
    </div>
  ),
  Icon: () => null,
  ShikiLobeTheme: {},
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { success: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
  Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
    <button
      aria-checked={checked}
      role="switch"
      onClick={() => {
        onChange?.(!checked);
      }}
    />
  ),
}));

vi.mock('@/business/client/features/AccountDeletion', () => ({
  default: () => <div />,
}));

vi.mock('@/features/DataImporter', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/services/config', () => ({
  configService: {
    exportAll: vi.fn(),
  },
}));

const createWrapper = (hideDocs: boolean) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider
      createStore={() =>
        initServerConfigStore({
          featureFlags: {
            ...mapFeatureFlagsEnvToState({
              commercial_hide_docs: false,
            }),
            hideDocs,
          },
        })
      }
    >
      {children}
    </Provider>
  );

  return Wrapper;
};

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  useUserStore.setState(initialUserStoreState, true);
});

describe('AdvancedActions', () => {
  it('does not duplicate analytics when About settings are visible', () => {
    render(<AdvancedActions />, { wrapper: createWrapper(false) });

    expect(screen.queryByText('analytics.title')).toBeNull();
    expect(screen.getByText('storage.actions.title')).toBeDefined();
  });

  it('shows telemetry as a fallback when About settings are hidden', () => {
    const updateGeneralConfig = vi.fn();

    useUserStore.setState({
      settings: { general: { telemetry: true } },
      updateGeneralConfig,
    });

    render(<AdvancedActions />, { wrapper: createWrapper(true) });

    expect(screen.getByText('analytics.title')).toBeDefined();
    expect(screen.getByText('analytics.telemetry.title')).toBeDefined();

    fireEvent.click(screen.getByRole('switch'));

    expect(updateGeneralConfig).toHaveBeenCalledWith({ telemetry: false });
  });
});
