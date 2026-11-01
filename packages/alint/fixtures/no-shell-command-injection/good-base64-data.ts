import { exec } from 'node:child_process';

export const encodeInput = (input: { text: string }) => {
  const encoded = Buffer.from(input.text).toString('base64');
  return exec(`printf '%s' '${encoded}'`);
};
