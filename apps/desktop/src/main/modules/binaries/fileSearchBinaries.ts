import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { BinarySpec, BinaryStatus } from '@/core/infrastructure/BinaryManager';
import { defineCommandBinary } from '@/core/infrastructure/BinaryManager';

const execPromise = promisify(exec);

/**
 * File search binaries
 *
 * Priority order: mdfind (1, macOS) > fd (2) > find (3)
 */

/**
 * mdfind - macOS Spotlight search
 * Only available on macOS, uses Spotlight index for fast searching
 */
export const mdfindBinary: BinarySpec = {
  description: 'macOS Spotlight search',
  async detect(): Promise<BinaryStatus> {
    if (process.platform !== 'darwin') {
      return {
        available: false,
        error: 'mdfind is only available on macOS',
      };
    }

    try {
      const { stdout } = await execPromise('mdfind -name test -onlyin ~ -count', {
        timeout: 5000,
      });

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
export const fdBinary: BinarySpec = defineCommandBinary('fd', {
  description: 'fd - fast find alternative',
  priority: 2,
});

/**
 * find - Standard Unix file search
 */
export const findBinary: BinarySpec = defineCommandBinary('find', {
  description: 'Unix find command',
  priority: 3,
  versionFlag: '--version',
});

/**
 * All file search binaries
 */
export const fileSearchBinaries: BinarySpec[] = [mdfindBinary, fdBinary, findBinary];
