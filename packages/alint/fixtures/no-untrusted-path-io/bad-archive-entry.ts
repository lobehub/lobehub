import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const extractEntry = async (entry: { data: Uint8Array; name: string }) => {
  const target = path.resolve('/tmp/extracted', entry.name);
  // alint-expect
  await writeFile(target, entry.data);
};
