import { DEVICE_TERMINAL_METADATA_KEY } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { getDesktopDeviceMetadata } from './deviceMetadata';

vi.mock('electron', () => ({ app: { getVersion: () => '2.4.0' } }));

describe('getDesktopDeviceMetadata', () => {
  it('reports the app version and that this desktop serves remote terminals', () => {
    expect(getDesktopDeviceMetadata()).toMatchObject({
      appVersion: '2.4.0',
      [DEVICE_TERMINAL_METADATA_KEY]: '1',
    });
  });
});
