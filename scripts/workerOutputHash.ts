import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const listFiles = (dir: string, prefix = ''): string[] =>
  readdirSync(path.join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(dir, relative);
    return entry.isFile() ? [relative] : [];
  });

export const hashBuildOutput = (dir: string): string => {
  const hash = createHash('sha256');
  for (const file of listFiles(dir).sort()) {
    const content = createHash('sha256')
      .update(readFileSync(path.join(dir, file)))
      .digest('hex');
    hash.update(`${file}\0${content}\n`);
  }
  return hash.digest('hex');
};

export const readOutputHash = (file: string | undefined): string | undefined => {
  if (!file || !existsSync(file)) return undefined;
  return readFileSync(file, 'utf8').trim() || undefined;
};
