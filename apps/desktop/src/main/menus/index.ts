import { platform } from 'node:os';

import { App } from '@/core/App';

import { LinuxMenu } from './impls/linux';
import { MacOSMenu } from './impls/macOS';
import { WindowsMenu } from './impls/windows';
import { IMenuPlatform } from './types';

export type { IMenuPlatform, MenuOptions } from './types';

export const createMenuImpl = (app: App): IMenuPlatform => {
  const currentPlatform = platform();

  switch (currentPlatform) {
    case 'darwin': {
      return new MacOSMenu(app);
    }
    case 'win32': {
      return new WindowsMenu(app);
    }
    case 'linux': {
      return new LinuxMenu(app);
    }

    default: {
      // Provide a fallback or throw an error
      console.warn(
        `Unsupported platform for menu: ${currentPlatform}, using Windows implementation as fallback.`,
      );
      return new WindowsMenu(app);
    }
  }
};
