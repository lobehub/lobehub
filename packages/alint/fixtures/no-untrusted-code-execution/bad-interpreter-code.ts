import { execFile } from 'node:child_process';

export const runGeneratedCode = (input: { modelCode: string }) => {
  // alint-expect
  return execFile('node', ['-e', input.modelCode]);
};
