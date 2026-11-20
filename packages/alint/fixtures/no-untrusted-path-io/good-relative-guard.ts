import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Private application-owned directory; remote users cannot create symlinks here.
export const readAttachment = async (input: { path: string }) => {
  const root = '/srv/attachments';
  const target = path.resolve(root, input.path);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Forbidden');
  }
  return readFile(target);
};
