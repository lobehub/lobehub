import type { CoreUpdateStatus, UpdaterState } from '@lobechat/electron-client-ipc';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Version from './Version';

const autoUpdateService = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  getBuildChannel: vi.fn(),
  getUpdaterState: vi.fn(),
  installNow: vi.fn(),
}));
const rendererOtaService = vi.hoisted(() => ({
  applyNow: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  getElectronIpc: () => ({}),
  useWatchBroadcast: () => {},
}));
vi.mock('@/services/electron/autoUpdate', () => ({ autoUpdateService }));
vi.mock('@/services/electron/rendererOta', () => ({ rendererOtaService }));
vi.mock('@/components/Branding', () => ({ ProductLogo: () => null }));
vi.mock('@/features/User/UserPanel/useNewVersion', () => ({ useNewVersion: () => false }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) =>
    selector({
      latestVersion: undefined,
      serverVersion: undefined,
      useCheckLatestVersion: () => ({}),
      useCheckServerVersion: () => {},
    }),
}));
vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: () => ({ enableCheckUpdates: false }),
  useServerConfigStore: (selector: (s: unknown) => unknown) =>
    selector({ canAccessDevDock: false }),
}));

const coreStatus = (patch: Partial<CoreUpdateStatus> = {}): CoreUpdateStatus => ({
  applyMode: null,
  current: '2.3.4-canary.1-core.38',
  disabledReasons: [],
  enabled: true,
  lastCheckAt: null,
  lastError: null,
  needsFullRelease: false,
  running: '2.3.4-canary.1-core.38',
  staged: null,
  ...patch,
});

const setup = (shell: UpdaterState, core: CoreUpdateStatus) => {
  autoUpdateService.getUpdaterState.mockResolvedValue(shell);
  autoUpdateService.getBuildChannel.mockResolvedValue('canary');
  rendererOtaService.getStatus.mockResolvedValue(core);
  rendererOtaService.applyNow.mockResolvedValue(true);
  render(<Version />);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('About › Version update action (desktop)', () => {
  it('offers to apply a staged core update instead of claiming the app is up to date', async () => {
    setup(
      { stage: 'latest' },
      coreStatus({ applyMode: 'relaunch', staged: '2.3.4-canary.1-core.45' }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'restartToUpdate' }));

    expect(screen.queryByText('alreadyUpToDate')).toBeNull();
    expect(rendererOtaService.applyNow).toHaveBeenCalledTimes(1);
    expect(autoUpdateService.installNow).not.toHaveBeenCalled();
  });

  it('still reports up to date when neither the shell nor the core has an update', async () => {
    setup({ stage: 'latest' }, coreStatus());

    expect(await screen.findByRole('button', { name: 'alreadyUpToDate' })).toBeDisabled();
  });

  it('lets a downloaded full app release take precedence over a staged core update', async () => {
    setup(
      { stage: 'downloaded' },
      coreStatus({ applyMode: 'relaunch', staged: '2.3.4-canary.1-core.45' }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'restartToUpdate' }));

    expect(autoUpdateService.installNow).toHaveBeenCalledTimes(1);
    expect(rendererOtaService.applyNow).not.toHaveBeenCalled();
  });
});
