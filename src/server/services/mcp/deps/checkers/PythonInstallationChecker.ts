import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type {InstallationChecker, PackageInstallCheckResult} from '../types';

const execPromise = promisify(exec);

/**
 * Python Installation Checker
 */
export class PythonInstallationChecker implements InstallationChecker {
  /**
   * Check if Python package is installed
   */
  async checkPackageInstalled(details: {
    packageName?: string;
    pythonCommand?: string;
  }): Promise<PackageInstallCheckResult> {
    if (!details.packageName) {
      return {
        error: 'Package name not provided',
        installed: false,
        packageName: '',
      };
    }

    try {
      const packageName = details.packageName;
      const pythonCommand = details.pythonCommand || 'python';

      // Use pip list to check if package is installed
      const command = `${pythonCommand} -m pip list | grep -i "${packageName}"`;
      const { stdout } = await execPromise(command);

      // If there's output and it contains the package name, consider it installed
      if (stdout.trim() && stdout.toLowerCase().includes(packageName.toLowerCase())) {
        return {
          installed: true,
          packageName,
        };
      }

      // Try to directly import the package to verify
      const importCommand = `${pythonCommand} -c "import ${packageName.replace('-', '_')}; print('Package installed')"`;
      try {
        const { stdout: importStdout } = await execPromise(importCommand);
        if (importStdout.includes('Package installed')) {
          return {
            installed: true,
            packageName,
          };
        }
      } catch {
        // Import failed, package may not exist
      }

      return {
        installed: false,
        packageName,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        installed: false,
        packageName: details.packageName,
      };
    }
  }
}
