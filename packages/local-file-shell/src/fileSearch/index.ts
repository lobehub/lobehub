import { platform } from 'node:os';

import { createLogger } from '../logger';
import type { ToolDetector } from '../toolDetector';
import { LinuxSearchServiceImpl } from './impl/linux';
import { MacOSSearchServiceImpl } from './impl/macOS';
import { WindowsSearchServiceImpl } from './impl/windows';

const logger = createLogger('fileSearch:factory');

export { BaseFileSearch } from './base';

export const createFileSearchModule = (toolDetector?: ToolDetector) => {
  const currentPlatform = platform();

  switch (currentPlatform) {
    case 'darwin': {
      return new MacOSSearchServiceImpl(toolDetector);
    }
    case 'win32': {
      return new WindowsSearchServiceImpl(toolDetector);
    }
    case 'linux': {
      return new LinuxSearchServiceImpl(toolDetector);
    }
    default: {
      logger.warn(`Unsupported platform: ${currentPlatform}, using Linux fallback`);
      return new LinuxSearchServiceImpl(toolDetector);
    }
  }
};
