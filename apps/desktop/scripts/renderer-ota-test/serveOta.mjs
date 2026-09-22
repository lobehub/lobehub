import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'release/renderer-ota');
const port = Number(process.argv[3] ?? 8787);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, `.${url.pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    console.log(`404 ${url.pathname}`);
    return;
  }

  const immutable = url.pathname.includes('/packs/');
  res.writeHead(200, {
    'cache-control': immutable ? 'public,max-age=31536000,immutable' : 'no-store',
    'content-type': url.pathname.endsWith('.zip') ? 'application/zip' : 'application/json',
  });
  createReadStream(file).pipe(res);
  console.log(`200 ${url.pathname}`);
});

server.listen(port, () => {
  console.log(`renderer OTA feed: http://127.0.0.1:${port}/ -> ${root}`);
});
