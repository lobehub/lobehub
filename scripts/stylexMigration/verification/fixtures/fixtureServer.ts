import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const types: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Serves only the two explicit build roots, including realpath checks on assets. */
export const serveFixtures = async (builds: { base: string; candidate: string }) => {
  const roots = { base: await realpath(builds.base), candidate: await realpath(builds.candidate) };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const match = /^\/(base|candidate)\/(.*)$/.exec(url.pathname);
      if (!match || !['GET', 'HEAD'].includes(request.method ?? '')) {
        response.writeHead(404).end();
        return;
      }
      const root = roots[match[1] as keyof typeof roots];
      const file = await realpath(path.resolve(root, decodeURIComponent(match[2] || 'index.html')));
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      // Request failures are expected (missing asset, malformed URL, traversal).
      response.writeHead(404).end();
      if (!(error instanceof Error)) console.error(error);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('FIXTURE_PORT_UNAVAILABLE');
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    origin: `http://127.0.0.1:${address.port}`,
  };
};
