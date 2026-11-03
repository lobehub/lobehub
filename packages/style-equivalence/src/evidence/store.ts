import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const createRunDir = async (recordsDir: string, base: string, head: string) => {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const runId = `${stamp}-${base.slice(0, 7)}-${head.slice(0, 7)}`;
  await mkdir(path.join(recordsDir, runId), { recursive: true });
  return { runDir: await realpath(path.join(recordsDir, runId)), runId };
};

export const writeEvidence = (runDir: string, name: string, value: unknown) =>
  writeFile(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);

export const readEvidence = async <T>(runDir: string, name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(runDir, name), 'utf8')) as T;
