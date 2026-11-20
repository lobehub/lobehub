import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SIGNOFF_DIR = '.style-equivalence/signoffs';

export interface SignoffRecord {
  hash: string;
  key: string;
  note: string;
  reason: string;
  reasons?: string[];
  signedAt: string;
  signer: string;
}

export const signoffPath = (root: string, file: string) =>
  path.join(root, SIGNOFF_DIR, `${file}.json`);

const readFileRecords = async (root: string, file: string): Promise<SignoffRecord[]> => {
  try {
    return JSON.parse(await readFile(signoffPath(root, file), 'utf8')) as SignoffRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export const readSignoffs = async (root: string, files: string[]) => {
  const records = new Map<string, SignoffRecord>();
  for (const file of new Set(files))
    for (const record of await readFileRecords(root, file)) records.set(record.key, record);
  return records;
};

export const writeSignoffs = async (root: string, file: string, records: SignoffRecord[]) => {
  const merged = new Map((await readFileRecords(root, file)).map((record) => [record.key, record]));
  for (const record of records) merged.set(record.key, record);
  const target = signoffPath(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify(
      [...merged.values()].sort((a, b) => a.key.localeCompare(b.key)),
      null,
      2,
    )}\n`,
  );
};
