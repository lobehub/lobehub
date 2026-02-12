import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import {
  IToolDetector,
  ToolStatus,
  createCommandDetector,
} from '@/core/infrastructure/ToolDetectorManager';

const execPromise = promisify(exec);

/**
 * File search tool detectors
 *
 * Priority order: mdfind (1, macOS) > fd (2) > find (3)
 */

/**
 * mdfind - macOS Spotlight search
 * Only available on macOS, uses Spotlight index for fast searching
 */
export const mdfindDetector: IToolDetector = {
  description: 'macOS Spotlight search',
  async detect(): Promise<ToolStatus> {
    // Only available on macOS
    if (process.platform !== 'darwin') {
      return {
        available: false,
        error: 'mdfind is only available on macOS',
      };
    }

    try {
      // Check if mdfind command exists and Spotlight is working
      const { stdout } = await execPromise('mdfind -name test -onlyin ~ -count', {
        timeout: 5000,
      });

      // If mdfind returns a number (even 0), Spotlight is available
      const count = parseInt(stdout.trim(), 10);
      if (Number.isNaN(count)) {
        return {
          available: false,
          error: 'Spotlight returned invalid response',
        };
      }

      return {
        available: true,
        path: '/usr/bin/mdfind',
      };
    } catch (error) {
      return {
        available: false,
        error: (error as Error).message,
      };
    }
  },
  name: 'mdfind',
  priority: 1,
};

/**
 * fd - Fast alternative to find
 * https://github.com/sharkdp/fd
 */
export const fdDetector: IToolDetector = createCommandDetector('fd', {
  description: 'fd - fast find alternative',
  priority: 2,
});

/**
 * find - Standard Unix file search
 */
export const findDetector: IToolDetector = createCommandDetector('find', {
  description: 'Unix find command',
  priority: 3,
  versionFlag: '--version', // GNU find supports this
});

/**
 * All file search detectors
 */
export const fileSearchDetectors: IToolDetector[] = [mdfindDetector, fdDetector, findDetector];
