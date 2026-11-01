import { execFile } from 'node:child_process';

export const lookup = (input: { query: string }) =>
  execFile('grep', ['--', input.query, 'index.txt'], { shell: false });
