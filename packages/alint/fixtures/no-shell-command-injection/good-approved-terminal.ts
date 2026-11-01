import { spawn } from 'node:child_process';

import { requireExecutionApproval } from './executionPolicy';

// Intentional agent terminal: execution policy authorizes the exact command before dispatch.
export const runTerminal = async (input: { command: string }) => {
  await requireExecutionApproval(input.command);
  return spawn('bash', ['-c', input.command]);
};
