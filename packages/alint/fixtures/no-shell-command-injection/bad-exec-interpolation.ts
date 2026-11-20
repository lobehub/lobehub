import { exec } from 'node:child_process';

export const convertUpload = (input: { filename: string }) => {
  // alint-expect
  return exec(`convert "${input.filename}" output.png`);
};
