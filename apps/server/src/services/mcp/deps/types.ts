/**
 * Installation Check Result
 */
export interface InstallCheckResult {
  /**
   * Error message
   */
  error?: string;
  /**
   * Whether installed
   */
  installed: boolean;
  /**
   * Whether meets version requirements
   */
  meetRequirement: boolean;
  /**
   * Version information
   */
  version?: string;
}

/**
 * Package Installation Check Result
 */
export interface PackageInstallCheckResult {
  /**
   * Error message
   */
  error?: string;
  /**
   * Whether installed
   */
  installed: boolean;
  /**
   * Package name
   */
  packageName: string;
}

/**
 * Installation Checker Interface
 */
export interface InstallationChecker {
  /**
   * Check if package is installed
   */
  checkPackageInstalled: (details: any) => Promise<PackageInstallCheckResult>;
}
