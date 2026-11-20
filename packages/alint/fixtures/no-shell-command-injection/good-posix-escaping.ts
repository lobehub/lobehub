import { execFile } from 'node:child_process';

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export const inspectUpload = (input: { filename: string }) =>
  execFile('/bin/sh', ['-c', `cat -- ${quote(input.filename)}`]);
