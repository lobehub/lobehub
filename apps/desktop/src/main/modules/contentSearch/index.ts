import * as os from 'node:os';

import { ToolDetectorManager } from '@/core/infrastructure/ToolDetectorManager';

import { BaseContentSearch } from './base';
import { LinuxContentSearchImpl } from './impl/linux';
import { MacOSContentSearchImpl } from './impl/macOS';
import { WindowsContentSearchImpl } from './impl/windows';

export { BaseContentSearch } from './base';
export { LinuxContentSearchImpl } from './impl/linux';
export { MacOSContentSearchImpl } from './impl/macOS';
export { UnixContentSearch } from './impl/unix';
export { WindowsContentSearchImpl } from './impl/windows';

/**
 * Create platform-specific content search implementation
 * @param toolDetectorManager Optional tool detector manager
 * @returns Platform-specific content search implementation
 */
export function createContentSearchImpl(
  toolDetectorManager?: ToolDetectorManager,
): BaseContentSearch {
  const platform = os.platform();

  switch (platform) {
    case 'darwin': {
      return new MacOSContentSearchImpl(toolDetectorManager);
    }
    case 'win32': {
      return new WindowsContentSearchImpl(toolDetectorManager);
    }
    default: {
      // Linux and other Unix-like systems
      return new LinuxContentSearchImpl(toolDetectorManager);
    }
  }
}
