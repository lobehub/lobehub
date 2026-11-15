import os from 'node:os';

import { DEVICE_TERMINAL_METADATA_KEY } from '@lobechat/types';
import { app } from 'electron';

/** What this desktop reports about itself when it registers its device row. */
export const getDesktopDeviceMetadata = (): Record<string, string> => ({
  appVersion: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  osRelease: os.release(),
  // Its gateway connection serves the terminal RPCs (`modules/terminal/remote`).
  [DEVICE_TERMINAL_METADATA_KEY]: '1',
});
