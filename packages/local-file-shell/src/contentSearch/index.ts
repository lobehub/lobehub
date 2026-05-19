import * as os from 'node:os';

import type { ToolDetector } from '../toolDetector';
import type { BaseContentSearch } from './base';
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
 */
export function createContentSearchImpl(toolDetector?: ToolDetector): BaseContentSearch {
  const platform = os.platform();

  switch (platform) {
    case 'darwin': {
      return new MacOSContentSearchImpl(toolDetector);
    }
    case 'win32': {
      return new WindowsContentSearchImpl(toolDetector);
    }
    default: {
      return new LinuxContentSearchImpl(toolDetector);
    }
  }
}
