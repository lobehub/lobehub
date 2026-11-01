import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const saveUpload = async (upload: { data: Uint8Array; name: string }) => {
  await writeFile(path.join('/tmp/uploads', `${randomUUID()}.bin`), upload.data);
};
