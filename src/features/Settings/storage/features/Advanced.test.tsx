import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { exportService } from '@/services/export';
import { initServerConfigStore, Provider } from '@/store/serverConfig/store';
import { useUserStore } from '@/store/user';
import { downloadFile } from '@/utils/client/downloadFile';

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

vi.mock('@/services/export', () => ({
  exportService: {
    getExportDownloadUrl: vi.fn(),
    getLatestExport: vi.fn(),
    startExport: vi.fn(),
  },
}));

vi.mock('@/utils/client/downloadFile', () => ({ downloadFile: vi.fn() }));

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

  it('starts a background export and shows it as running', async () => {
    vi.mocked(exportService.getLatestExport).mockResolvedValue(null);
    vi.mocked(exportService.startExport).mockResolvedValue({
      createdAt: new Date(),
      id: 'task-1',
      status: 'processing',
    });

    render(<AdvancedActions />, { wrapper: createWrapper(false, true) });

    fireEvent.click(await screen.findByText('storage.actions.export.button'));

    expect(await screen.findByText('storage.actions.export.exporting')).toBeDefined();
    expect(screen.getByText('storage.actions.export.exportingDesc')).toBeDefined();
    expect(exportService.startExport).toHaveBeenCalledTimes(1);
  });

  it('offers the finished export for download', async () => {
    vi.mocked(exportService.getLatestExport).mockResolvedValue({
      completedAt: new Date('2026-11-16T08:30:00Z'),
      createdAt: new Date('2026-11-16T08:29:00Z'),
      fileSize: 2048,
      id: 'task-1',
      status: 'success',
    });
    vi.mocked(exportService.getExportDownloadUrl).mockResolvedValue({
      fileName: 'export.json',
      url: 'https://s3/signed',
    });

    render(<AdvancedActions />, { wrapper: createWrapper(false, true) });

    expect(await screen.findByText('storage.actions.export.ready')).toBeDefined();
    expect(screen.getByText('storage.actions.export.rerun')).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByText('storage.actions.export.download'));
    });

    expect(exportService.getExportDownloadUrl).toHaveBeenCalledWith('task-1');
    expect(downloadFile).toHaveBeenCalledWith('https://s3/signed', 'export.json');
  });

  it('tells the user when the last export failed', async () => {
    vi.mocked(exportService.getLatestExport).mockResolvedValue({
      createdAt: new Date(),
      id: 'task-1',
      status: 'error',
    });

    render(<AdvancedActions />, { wrapper: createWrapper(false, true) });

    expect(await screen.findByText('storage.actions.export.failed')).toBeDefined();
    expect(screen.getByText('storage.actions.export.rerun')).toBeDefined();
  });
});
