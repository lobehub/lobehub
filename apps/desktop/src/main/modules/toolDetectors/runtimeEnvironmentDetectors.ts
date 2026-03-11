import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import type { IToolDetector, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

const execPromise = promisify(exec);

/**
 * Node.js runtime detector
 */
export const nodeDetector: IToolDetector = createCommandDetector('node', {
  description: 'Node.js - JavaScript runtime',
  priority: 1,
});

/**
 * NPM package manager detector
 */
export const npmDetector: IToolDetector = createCommandDetector('npm', {
  description: 'npm - Node.js package manager',
  priority: 2,
});

/**
 * Python runtime detector
 * Tries python3 (Unix) first, then python (cross-platform)
 */
export const pythonDetector: IToolDetector = {
  description: 'Python - programming language runtime',
  async detect(): Promise<ToolStatus> {
    const commands = platform() === 'win32' ? ['python', 'py'] : ['python3', 'python'];

    for (const cmd of commands) {
      try {
        const whichCmd = platform() === 'win32' ? 'where' : 'which';
        const { stdout: pathOut } = await execPromise(`${whichCmd} ${cmd}`, { timeout: 3000 });
        const toolPath = pathOut.trim().split('\n')[0];

        // Must successfully invoke --version to confirm usable runtime (e.g. avoid
        // Windows Microsoft Store alias which is found by where but fails to run)
        const { stdout: versionOut } = await execPromise(`${cmd} --version`, {
          timeout: 3000,
        });
        const version = versionOut.trim().split('\n')[0];

        return {
          available: true,
          path: toolPath,
          version,
        };
      } catch {
        continue;
      }
    }

    return {
      available: false,
    };
  },
  name: 'python',
  priority: 3,
};

/**
 * All runtime environment detectors
 */
export const runtimeEnvironmentDetectors: IToolDetector[] = [
  nodeDetector,
  npmDetector,
  pythonDetector,
];
