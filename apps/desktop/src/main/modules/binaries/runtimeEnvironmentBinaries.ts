import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import type { BinarySpec, BinaryStatus } from '@/core/infrastructure/BinaryManager';
import { defineCommandBinary } from '@/core/infrastructure/BinaryManager';

const execPromise = promisify(exec);

/**
 * Node.js runtime
 */
export const nodeBinary: BinarySpec = defineCommandBinary('node', {
  description: 'Node.js - JavaScript runtime',
  priority: 1,
});

/**
 * NPM package manager
 */
export const npmBinary: BinarySpec = defineCommandBinary('npm', {
  description: 'npm - Node.js package manager',
  priority: 2,
});

/**
 * Python runtime
 * Tries python3 (Unix) first, then python (cross-platform)
 */
export const pythonBinary: BinarySpec = {
  description: 'Python - programming language runtime',
  async detect(): Promise<BinaryStatus> {
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
 * Bun runtime
 */
export const bunBinary: BinarySpec = defineCommandBinary('bun', {
  description: 'Bun - fast JavaScript runtime and package manager',
  priority: 4,
});

/**
 * Bunx package runner
 */
export const bunxBinary: BinarySpec = defineCommandBinary('bunx', {
  description: 'bunx - Bun package runner for executing npm packages',
  priority: 5,
});

/**
 * pnpm package manager
 */
export const pnpmBinary: BinarySpec = defineCommandBinary('pnpm', {
  description: 'pnpm - fast, disk space efficient package manager',
  priority: 6,
});

/**
 * uv Python package manager
 */
export const uvBinary: BinarySpec = defineCommandBinary('uv', {
  description: 'uv - extremely fast Python package manager',
  priority: 7,
});

/**
 * LobeHub CLI
 * Tries lobehub, lobe, lh in order; validates via --help output containing "LobeHub"
 */
export const lobehubBinary: BinarySpec = {
  description: 'LobeHub CLI - manage and connect to LobeHub services',
  async detect(): Promise<BinaryStatus> {
    const commands = ['lobehub', 'lobe', 'lh'];
    const whichCmd = platform() === 'win32' ? 'where' : 'which';

    for (const cmd of commands) {
      try {
        const { stdout: pathOut } = await execPromise(`${whichCmd} ${cmd}`, { timeout: 3000 });
        const toolPath = pathOut.trim().split('\n')[0];

        // Validate it's actually LobeHub CLI by checking help output
        const { stdout: helpOut } = await execPromise(`${cmd} --help`, { timeout: 3000 });
        if (!helpOut.includes('LobeHub')) continue;

        const { stdout: versionOut } = await execPromise(`${cmd} --version`, { timeout: 3000 });
        const version = versionOut.trim().split('\n')[0];

        return { available: true, path: toolPath, version };
      } catch {
        continue;
      }
    }

    return { available: false };
  },
  name: 'lobehub',
  priority: 0,
};

/**
 * All runtime environment binaries
 */
export const runtimeEnvironmentBinaries: BinarySpec[] = [
  lobehubBinary,
  nodeBinary,
  npmBinary,
  pythonBinary,
  bunBinary,
  bunxBinary,
  pnpmBinary,
  uvBinary,
];
