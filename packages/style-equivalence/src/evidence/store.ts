import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const createRunDir = async (recordsDir: string, base: string, head: string) => {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const stem = `${stamp}-${base.slice(0, 7)}-${head.slice(0, 7)}`;
  await mkdir(recordsDir, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const runId = attempt === 1 ? stem : `${stem}-${attempt}`;
    try {
      await mkdir(path.join(recordsDir, runId));
      return { runDir: await realpath(path.join(recordsDir, runId)), runId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
};

export const writeEvidence = (runDir: string, name: string, value: unknown) =>
  writeFile(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);

export const readEvidence = async <T>(runDir: string, name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(runDir, name), 'utf8')) as T;
