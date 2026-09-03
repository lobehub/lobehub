import { OFFICIAL_URL } from '@lobechat/const';
import { afterEach, describe, expect, it } from 'vitest';

import { type ElectronState, initialState } from '../../initialState';
import { electronSyncSelectors } from '../sync';

const stateWith = (dataSyncConfig: ElectronState['dataSyncConfig']) =>
  ({ dataSyncConfig }) as ElectronState;

const withConfig = (dataSyncConfig: ElectronState['dataSyncConfig']): ElectronState => ({
  ...initialState,
  dataSyncConfig,
});

const originalCloudServer = process.env.OFFICIAL_CLOUD_SERVER;

afterEach(() => {
  if (originalCloudServer === undefined) delete process.env.OFFICIAL_CLOUD_SERVER;
  else process.env.OFFICIAL_CLOUD_SERVER = originalCloudServer;
});

describe('electronSyncSelectors.remoteServerUrl', () => {
  // Regression: this is the origin every "copy link" action renders. It used to
  // hardcode OFFICIAL_URL for cloud mode while the main process resolved the same
  // mode through OFFICIAL_CLOUD_SERVER, so a build configured for another
  // deployment pulled its data from one host and handed out links to another.
  it('names the cloud this build actually talks to', () => {
    process.env.OFFICIAL_CLOUD_SERVER = 'https://example.invalid';

    expect(electronSyncSelectors.remoteServerUrl(stateWith({ storageMode: 'cloud' }))).toBe(
      'https://example.invalid',
    );
  });

  it('falls back to the official cloud when the build configures none', () => {
    delete process.env.OFFICIAL_CLOUD_SERVER;

    expect(electronSyncSelectors.remoteServerUrl(stateWith({ storageMode: 'cloud' }))).toBe(
      OFFICIAL_URL,
    );
  });

  it('prefers the self-hosted url over both', () => {
    process.env.OFFICIAL_CLOUD_SERVER = 'https://example.invalid';

    expect(
      electronSyncSelectors.remoteServerUrl(
        stateWith({ remoteServerUrl: 'https://self.hosted', storageMode: 'selfHost' }),
      ),
    ).toBe('https://self.hosted');
  });

  it('returns an empty string for self-host with nothing configured', () => {
    expect(electronSyncSelectors.remoteServerUrl(stateWith({ storageMode: 'selfHost' }))).toBe('');
  });
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
