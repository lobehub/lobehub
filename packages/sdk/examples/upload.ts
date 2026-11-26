/** bun examples/upload.ts ./path/to/file — upload from a path, bytes and a Blob. */
/* eslint-disable no-console -- examples print their results */
import { lobehub } from './client';

const client = lobehub();
const path = process.argv[2] ?? new URL('../README.md', import.meta.url).pathname;

const fromPath = await client.files.upload(path, { throwOnError: true });
console.log('path  →', fromPath.data.data.file.id, fromPath.data.data.file.name);

const fromBytes = await client.files.upload(new TextEncoder().encode('# hello\n'), {
  name: 'hello.md',
  throwOnError: true,
  type: 'text/markdown',
});
console.log('bytes →', fromBytes.data.data.file.id);

const fromBlob = await client.files.upload(new Blob(['a,b\n1,2\n'], { type: 'text/csv' }), {
  name: 'table.csv',
  throwOnError: true,
});
console.log('blob  →', fromBlob.data.data.file.id);

for (const result of [fromPath, fromBytes, fromBlob]) {
  await client.files.delete({ path: { id: result.data.data.file.id } });
}
