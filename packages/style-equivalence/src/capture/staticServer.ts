import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export const resolveInside = async (root: string, requestPath: string) => {
  const base = await realpath(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  const candidate = path.resolve(base, `.${path.posix.normalize(`/${decoded}`)}`);
  let file = candidate;
  try {
    if ((await stat(candidate)).isDirectory()) file = path.join(candidate, 'index.html');
    file = await realpath(file);
  } catch {
    return undefined;
  }
  return file === base || file.startsWith(base + path.sep) ? file : undefined;
};

export const serveDirectories = async (root: string) => {
  const server = createServer(async (request, response) => {
    const file = await resolveInside(root, new URL(request.url ?? '/', 'http://x').pathname);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    url: `http://127.0.0.1:${port}`,
  };
};
