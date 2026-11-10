import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const newestMtime = async (target: string): Promise<number> => {
  const info = await stat(target).catch(() => undefined);
  if (!info) return 0;
  if (!info.isDirectory()) return info.mtimeMs;
  const entries = await readdir(target);
  const times = await Promise.all(entries.map((entry) => newestMtime(path.join(target, entry))));
  return Math.max(0, ...times);
};

export const uiBuildStale = async (distDir: string, sources: string[]) => {
  const built = await stat(path.join(distDir, 'index.html')).catch(() => undefined);
  if (!built) return true;
  const times = await Promise.all(sources.map(newestMtime));
  return Math.max(0, ...times) > built.mtimeMs;
};
