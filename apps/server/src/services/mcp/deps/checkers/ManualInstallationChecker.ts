import { type InstallationChecker, type PackageInstallCheckResult } from '../types';

/**
 * Manual Installation Checker
 */
export class ManualInstallationChecker implements InstallationChecker {
  /**
   * Check if manually installed package is installed
   * Manually installed packages cannot be automatically detected, always returns not installed status, user needs to confirm manually
   */
  async checkPackageInstalled(details: {
    packageName?: string;
    repositoryUrlToClone?: string;
  }): Promise<PackageInstallCheckResult> {
    return {
      installed: false,
      packageName: details.packageName || details.repositoryUrlToClone || '',
    };
  }
}
