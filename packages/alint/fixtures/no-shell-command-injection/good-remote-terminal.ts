import { remoteSandbox } from './sandbox';

// Intentional arbitrary-command execution in an isolated remote sandbox.
export const runCommand = (input: { command: string }) =>
  remoteSandbox.execTerminal(`cd /workspace && ${input.command}`);
