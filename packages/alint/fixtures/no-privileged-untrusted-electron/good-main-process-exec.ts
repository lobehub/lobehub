// A main-process helper probes installed MCP dependencies with child_process. Command
// execution is the shell rule's concern; there is no window, preload or IPC policy here.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export const checkSystemDependency = async (dependency: any) => {
  const checkCommand = dependency.checkCommand || `${dependency.name} --version`;
  try {
    const { stdout } = await execPromise(checkCommand);
    return { installed: true, name: dependency.name, version: String(stdout).trim() };
  } catch {
    return { installed: false, name: dependency.name };
  }
};

export const checkPackageInstalled = async (installationMethod: string, details: any) => {
  const packageName = details?.packageName;
  if (!packageName) return { installed: false };

  try {
    if (installationMethod === 'npm') {
      const { stdout } = await execPromise(`npm list -g ${packageName} --depth=0`);
      return { installed: !stdout.includes('(empty)') && stdout.includes(packageName) };
    }

    const pythonCommand = details?.pythonCommand || 'python';
    const { stdout } = await execPromise(
      `${pythonCommand} -c "import ${packageName}; print('ok')"`,
    );
    return { installed: stdout.includes('ok') };
  } catch {
    return { installed: false };
  }
};
