// Fixture: src/app/(backend)/api/usage/route.ts — a Next.js route handler, which
// runs on the server even though it lives under the web tree.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const GET = async () => {
  const content = await readFile(path.join(process.cwd(), 'usage.json'), 'utf8');
  return new Response(content, { headers: { 'content-type': 'application/json' } });
};
