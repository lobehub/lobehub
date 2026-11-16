import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { configService } from '@/services/config';
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

const createWrapper = (hideDocs: boolean, enableBusinessFeatures = false) => {
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
          serverConfig: { aiProvider: {}, enableBusinessFeatures, telemetry: {} },
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

  it('shows export progress on the button while the export runs', async () => {
    let finishExport!: () => void;
    vi.mocked(configService.exportAll).mockReturnValue(
      new Promise<void>((resolve) => {
        finishExport = resolve;
      }),
    );

    render(<AdvancedActions />, { wrapper: createWrapper(false, true) });

    fireEvent.click(screen.getByText('storage.actions.export.button'));

    expect(await screen.findByText('storage.actions.export.exporting')).toBeDefined();
    expect(screen.getByText('storage.actions.export.exportingDesc')).toBeDefined();

    await act(async () => {
      finishExport();
    });

    expect(await screen.findByText('storage.actions.export.button')).toBeDefined();
    expect(screen.queryByText('storage.actions.export.exportingDesc')).toBeNull();
  });
});
