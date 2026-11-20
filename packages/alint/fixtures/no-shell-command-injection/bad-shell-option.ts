import { spawn } from 'node:child_process';

export const inspectUpload = (input: { filename: string }) => {
  // alint-expect
  return spawn('file', [input.filename], { shell: true });
};
