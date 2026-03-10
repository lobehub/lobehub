import { platform } from 'node:os';

import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';

import { LinuxSearchServiceImpl } from './impl/linux';
import { MacOSSearchServiceImpl } from './impl/macOS';
import { WindowsSearchServiceImpl } from './impl/windows';

export { BaseFileSearch } from './base';
export type { FileResult, SearchOptions } from './types';

export const createFileSearchModule = (toolDetectorManager?: ToolDetectorManager) => {
  const currentPlatform = platform();

  switch (currentPlatform) {
    case 'darwin': {
      return new MacOSSearchServiceImpl(toolDetectorManager);
    }
    case 'win32': {
      return new WindowsSearchServiceImpl(toolDetectorManager);
    }
    case 'linux': {
      return new LinuxSearchServiceImpl(toolDetectorManager);
    }
    default: {
      // Fallback to Linux implementation (uses fast-glob, no external dependencies)
      console.warn(`Unsupported platform: ${currentPlatform}, using Linux fallback`);
      return new LinuxSearchServiceImpl(toolDetectorManager);
    }
  }
};
