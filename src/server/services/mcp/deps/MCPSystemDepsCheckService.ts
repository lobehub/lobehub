import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { type DeploymentOption, type SystemDependency } from '@lobehub/market-sdk';
import debug from 'debug';

import { type SystemDependencyCheckResult } from '@/types/plugins';

import { type InstallationChecker, type PackageInstallCheckResult } from './types';

const execPromise = promisify(exec);
const log = debug('lobe-mcp:deps-check');

// Helper function to get current platform install instructions
const getCurrentPlatformInstructions = (installInstructions: any) => {
  if (!installInstructions) return undefined;

  const platform = process.platform;
  let current: string | undefined;

  // Map platform to instruction key
  switch (platform) {
    case 'darwin': {
      current = installInstructions.macos;
      break;
    }
    case 'linux': {
      current = installInstructions.linux_debian || installInstructions.linux;
      break;
    }
    case 'win32': {
      current = installInstructions.windows;
      break;
    }
  }

  return {
    current,
    manual: installInstructions.manual,
  };
};

/**
 * MCP System Dependency Check Service
 */

class MCPSystemDepsCheckService {
  private checkers: Map<string, InstallationChecker> = new Map();

  /**
   * Register installation checker
   */
  registerChecker(method: string, checker: InstallationChecker) {
    this.checkers.set(method, checker);
    log(`Installation checker registered: ${method}`);
  }

  /**
   * Check system dependency version
   */
  async checkSystemDependency(dependency: SystemDependency): Promise<SystemDependencyCheckResult> {
    try {
      // If check command not provided, use generic command
      const checkCommand = dependency.checkCommand || `${dependency.name} --version`;
      log(`Checking system dependency: ${dependency.name}, command: ${checkCommand}`);

      const { stdout, stderr } = await execPromise(checkCommand);
      if (stderr && !stdout) {
        return {
          error: stderr,
          installInstructions: getCurrentPlatformInstructions(
            (dependency as any).installInstructions,
          ),
          installed: false,
          meetRequirement: false,
          name: dependency.name,
          requiredVersion: (dependency as any).requiredVersion,
        };
      }

      const output = stdout.trim();
      let version = output;

      // Process version parsing
      if (dependency.versionParsingRequired) {
        // Extract version number - usually in format vX.Y.Z or X.Y.Z
        const versionMatch = output.match(/v?(\d+(\.\d+)*)/i);
        if (versionMatch) {
          version = versionMatch[0];
        }
      }

      let meetRequirement = true;

      if (dependency.requiredVersion) {
        // Extract numeric part
        const currentVersion = version.replace(/^v/i, ''); // Remove possible v prefix
        const currentVersionNum = parseFloat(currentVersion);

        // Extract condition and number from required version
        const requirementMatch = dependency.requiredVersion.match(/([<=>]+)?(\d+(\.\d+)*)/);

        if (requirementMatch) {
          const [, operator = '=', requiredVersion] = requirementMatch;
          const requiredNum = parseFloat(requiredVersion);

          switch (operator) {
            case '>=': {
              meetRequirement = currentVersionNum >= requiredNum;
              break;
            }
            case '>': {
              meetRequirement = currentVersionNum > requiredNum;
              break;
            }
            case '<=': {
              meetRequirement = currentVersionNum <= requiredNum;
              break;
            }
            case '<': {
              meetRequirement = currentVersionNum < requiredNum;
              break;
            }
            default: {
              // Default equals
              meetRequirement = currentVersionNum === requiredNum;
              break;
            }
          }
        }
      }

      log(
        `System dependency check result: ${dependency.name}, installed: ${true}, meets requirement: ${meetRequirement}, version: ${version}`,
      );
      return {
        installInstructions: getCurrentPlatformInstructions(
          (dependency as any).installInstructions,
        ),
        installed: true,
        meetRequirement,
        name: dependency.name,
        requiredVersion: (dependency as any).requiredVersion,
        version,
      };
    } catch (error) {
      log(`System dependency check error: ${dependency.name}, ${error}`);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        installInstructions: getCurrentPlatformInstructions(
          (dependency as any).installInstructions,
        ),
        installed: false,
        meetRequirement: false,
        name: dependency.name,
        requiredVersion: (dependency as any).requiredVersion,
      };
    }
  }

  /**
   * Check deployment option
   */
  async checkDeployOption(option: DeploymentOption): Promise<{
    allDependenciesMet: boolean;
    configSchema?: any;
    connection: any;
    isRecommended?: boolean;
    needsConfig?: boolean;
    packageInstalled: boolean;
    systemDependencies: SystemDependencyCheckResult[];
  }> {
    const systemDependenciesResults: SystemDependencyCheckResult[] = [];

    // Check system dependencies
    if (option.systemDependencies && option.systemDependencies.length > 0) {
      for (const dep of option.systemDependencies) {
        const result = await this.checkSystemDependency(dep);
        systemDependenciesResults.push(result);
      }
    }

    // Get corresponding installation checker
    const checker = this.checkers.get(option.installationMethod);
    let packageInstalled = false;
    let packageResult: PackageInstallCheckResult | null = null;

    if (checker) {
      // Use specific installation checker to check package installation status
      packageResult = await checker.checkPackageInstalled(option.installationDetails);
      packageInstalled = packageResult.installed;
    } else {
      log(`Installation checker not found: ${option.installationMethod}`);
    }

    // Check if all system dependencies meet requirements
    const allDependenciesMet = systemDependenciesResults.every((dep) => dep.meetRequirement);

    // Check if configuration is required (has mandatory fields)
    const configSchema = option.connection?.configSchema;
    const needsConfig = Boolean(
      configSchema &&
      // Check if there's a non-empty required array
      ((Array.isArray(configSchema.required) && configSchema.required.length > 0) ||
        // Check if any field in properties is marked as required
        (configSchema.properties &&
          Object.values(configSchema.properties).some((prop: any) => prop.required === true))),
    );

    log(
      `Configuration check result: needsConfig=${needsConfig}, required=${configSchema?.required}, configSchema=%O`,
      configSchema,
    );

    // Create connection info
    const connection = option.connection.url
      ? {
          ...option.connection,
          type: 'http',
        }
      : {
          ...option.connection,
          type: 'stdio',
        };

    return {
      allDependenciesMet,
      configSchema,
      connection,
      isRecommended: option.isRecommended,
      needsConfig,
      packageInstalled,
      systemDependencies: systemDependenciesResults,
    };
  }
}

// Create singleton instance
export const mcpSystemDepsCheckService = new MCPSystemDepsCheckService();
