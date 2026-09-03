import { describe, expect, it } from 'vitest';

import { type ElectronState, initialState } from '../../initialState';
import { electronSyncSelectors } from '../sync';

const withConfig = (dataSyncConfig: ElectronState['dataSyncConfig']): ElectronState => ({
  ...initialState,
  dataSyncConfig,
});

describe('electronSyncSelectors.isOfficialServer', () => {
  it('is official in cloud mode regardless of remoteServerUrl', () => {
    expect(
      electronSyncSelectors.isOfficialServer(
        withConfig({ remoteServerUrl: 'http://localhost:3210', storageMode: 'cloud' }),
      ),
    ).toBe(true);
  });

  it('is official when self-hosting on a lobehub.com origin', () => {
    expect(
      electronSyncSelectors.isOfficialServer(
        withConfig({ remoteServerUrl: 'https://lobehub.com', storageMode: 'selfHost' }),
      ),
    ).toBe(true);
  });

  it('is not official for a third-party self-hosted server', () => {
    expect(
      electronSyncSelectors.isOfficialServer(
        withConfig({ remoteServerUrl: 'https://chat.example.com', storageMode: 'selfHost' }),
      ),
    ).toBe(false);
  });
});
