import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const saveUpload = async (upload: { data: Uint8Array; name: string }) => {
  const target = path.join('/tmp/uploads', upload.name);
  // alint-expect
  await writeFile(target, upload.data);
};
