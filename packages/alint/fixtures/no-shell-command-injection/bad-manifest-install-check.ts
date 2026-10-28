// Electron main helper: MCP Market manifest install metadata is interpolated into, or
// run as, a host exec command string.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export const checkSystemDependency = async (dependency: any) => {
  const checkCommand = dependency.checkCommand || `${dependency.name} --version`;
  try {
    // alint-expect
    const { stdout } = await execPromise(checkCommand);
    return { installed: true, name: dependency.name, version: String(stdout).trim() };
  } catch {
    return { installed: false, name: dependency.name };
  }
};

export const checkNpmPackageInstalled = async (details: any) => {
  const packageName = details?.packageName;
  if (!packageName) return { installed: false };
  try {
    // alint-expect
    const { stdout } = await execPromise(`npm list -g ${packageName} --depth=0`);
    return { installed: !stdout.includes('(empty)') && stdout.includes(packageName) };
  } catch {
    return { installed: false };
  }
};
