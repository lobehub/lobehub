import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

/**
 * MCP Install Check (local system) — extracted from McpCtr so the controller
 * stays under the 800-line source-layout limit. Pure dependency probing with
 * no controller state; same behavior as before the extraction.
 */

// ---------- MCP Install Check (local system) ----------

export const getInstallInstructions = (installInstructions: any) => {
  if (!installInstructions) return undefined;

  let current: string | undefined;

  switch (process.platform) {
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

  return { current, manual: installInstructions.manual };
};

export const checkSystemDependency = async (dependency: any) => {
  const checkCommand = dependency.checkCommand || `${dependency.name} --version`;

  try {
    const { stdout, stderr } = await execPromise(checkCommand);

    if (stderr && !stdout) {
      return {
        error: stderr,
        installInstructions: getInstallInstructions(dependency.installInstructions),
        installed: false,
        meetRequirement: false,
        name: dependency.name,
        requiredVersion: dependency.requiredVersion,
      };
    }

    const output = String(stdout || '').trim();
    let version = output;

    if (dependency.versionParsingRequired) {
      const versionMatch = output.match(/V?(\d+(\.\d+)*)/i);
      if (versionMatch) version = versionMatch[0];
    }

    let meetRequirement = true;

    if (dependency.requiredVersion) {
      const currentVersion = String(version).replace(/^V/i, '');
      const currentNum = Number.parseFloat(currentVersion);

      const requirementMatch = String(dependency.requiredVersion).match(/([<=>]+)?(\d+(\.\d+)*)/);
      if (requirementMatch) {
        const [, operator = '=', requiredVersion] = requirementMatch;
        const requiredNum = Number.parseFloat(requiredVersion);
        switch (operator) {
          case '>=': {
            meetRequirement = currentNum >= requiredNum;
            break;
          }
          case '>': {
            meetRequirement = currentNum > requiredNum;
            break;
          }
          case '<=': {
            meetRequirement = currentNum <= requiredNum;
            break;
          }
          case '<': {
            meetRequirement = currentNum < requiredNum;
            break;
          }
          default: {
            meetRequirement = currentNum === requiredNum;
            break;
          }
        }
      }
    }

    return {
      installInstructions: getInstallInstructions(dependency.installInstructions),
      installed: true,
      meetRequirement,
      name: dependency.name,
      requiredVersion: dependency.requiredVersion,
      version,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      installInstructions: getInstallInstructions(dependency.installInstructions),
      installed: false,
      meetRequirement: false,
      name: dependency.name,
      requiredVersion: dependency.requiredVersion,
    };
  }
};

export const checkPackageInstalled = async (installationMethod: string, details: any) => {
  if (installationMethod === 'npm') {
    const packageName = details?.packageName;
    if (!packageName) return { installed: false };

    // Only check global npm list - do NOT use npx as it may download packages
    try {
      const { stdout } = await execPromise(`npm list -g ${packageName} --depth=0`);
      if (!stdout.includes('(empty)') && stdout.includes(packageName)) {
        return { installed: true };
      }
    } catch {
      // ignore - package not found in global list
    }

    // For npm packages, we don't require pre-installation
    // npx will handle downloading and running on-demand during actual MCP connection
    return { installed: false };
  }

  if (installationMethod === 'python') {
    const packageName = details?.packageName;
    if (!packageName) return { installed: false };

    const pythonCommand = details?.pythonCommand || 'python';

    try {
      const command = `${pythonCommand} -m pip list | grep -i "${packageName}"`;
      const { stdout } = await execPromise(command);
      if (stdout.trim() && stdout.toLowerCase().includes(String(packageName).toLowerCase())) {
        return { installed: true };
      }
    } catch {
      // ignore
    }

    try {
      const importCommand = `${pythonCommand} -c "import ${String(packageName).replace('-', '_')}; print('Package installed')"`;
      const { stdout } = await execPromise(importCommand);
      if (stdout.includes('Package installed')) return { installed: true };
    } catch {
      // ignore
    }

    return { installed: false };
  }

  // manual or unknown
  return { installed: false };
};

export const checkDeployOption = async (option: any) => {
  const systemDependenciesResults = [];

  if (Array.isArray(option.systemDependencies) && option.systemDependencies.length > 0) {
    for (const dep of option.systemDependencies) {
      systemDependenciesResults.push(await checkSystemDependency(dep));
    }
  }

  const packageResult = await checkPackageInstalled(
    option.installationMethod,
    option.installationDetails,
  );
  const packageInstalled = Boolean((packageResult as any).installed);

  const allDependenciesMet = systemDependenciesResults.every((dep: any) => dep.meetRequirement);

  const configSchema = option.connection?.configSchema;
  const needsConfig = Boolean(
    configSchema &&
    ((Array.isArray(configSchema.required) && configSchema.required.length > 0) ||
      (configSchema.properties &&
        Object.values(configSchema.properties).some((prop: any) => prop.required === true))),
  );

  const connection = option.connection?.url
    ? { ...option.connection, type: 'http' }
    : { ...option.connection, type: 'stdio' };

  return {
    allDependenciesMet,
    configSchema,
    connection,
    isRecommended: option.isRecommended,
    needsConfig,
    packageInstalled,
    systemDependencies: systemDependenciesResults,
  };
};
