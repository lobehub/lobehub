import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const readAttachment = async (input: { path: string }) => {
  const root = '/srv/attachments';
  const target = path.resolve(root, input.path);
  if (!target.startsWith(root)) throw new Error('Forbidden');
  // alint-expect
  return readFile(target);
};
