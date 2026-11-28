// Fixture: the shell result persists the combined output next to both of the
// streams it was built from.
import type { RunCommandResult, ShellExecution } from './types';

export async function runCommand(
  shell: ShellExecution,
  command: string,
): Promise<RunCommandResult> {
  const { exitCode, stderr, stdout } = await shell.exec(command);

  return {
    content: `Exited with code ${exitCode}`,
    state: {
      exitCode,
      // alint-expect
      output: stdout + stderr,
      stderr,
      stdout,
    },
    success: exitCode === 0,
  };
}
