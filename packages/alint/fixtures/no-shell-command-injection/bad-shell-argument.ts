import { spawn } from 'node:child_process';

export const lookup = (input: { query: string }) => {
  // alint-expect
  return spawn('bash', ['-c', `grep ${input.query} index.txt`]);
};
