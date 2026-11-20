import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const saveUpload = async (upload: { data: Uint8Array; name: string }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'upload-'));
  await writeFile(path.join(root, path.basename(upload.name)), upload.data);
};
