// Manifest metadata reaches `python -c` only through an exec shell string. That is the
// shell injection rule's finding, not host code execution through eval/vm/argv.
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export const checkPythonPackageInstalled = async (details: any) => {
  const packageName = details?.packageName;
  if (!packageName) return { installed: false };

  const pythonCommand = details?.pythonCommand || 'python';

  try {
    const command = `${pythonCommand} -m pip list | grep -i "${packageName}"`;
    const { stdout } = await execPromise(command);
    if (stdout.trim()) return { installed: true };
  } catch {
    // not listed
  }

  try {
    const importCommand = `${pythonCommand} -c "import ${String(packageName).replace('-', '_')}; print('ok')"`;
    const { stdout } = await execPromise(importCommand);
    return { installed: stdout.includes('ok') };
  } catch {
    return { installed: false };
  }
};
