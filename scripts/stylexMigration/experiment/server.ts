import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export const serveProject = async (runDirectory: string) => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const match = pathname.match(/^\/(before|after)(?:\/(.*))?$/);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      const root = path.join(runDirectory, match[1], 'dist');
      const file = path.resolve(root, match[2] || 'index.html');
      if (!file.startsWith(`${root}/`)) {
        response.writeHead(403).end();
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate a local experiment port');
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    url: `http://127.0.0.1:${address.port}`,
  };
};
