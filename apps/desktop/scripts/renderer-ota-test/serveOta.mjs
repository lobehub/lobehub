import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'release/renderer-ota');
const port = Number(process.argv[3] ?? 8787);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/renderer/')) {
    res.writeHead(404).end('not an ota path');
    return;
  }

  const file = path.join(root, url.pathname.slice('/renderer/'.length));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    console.log(`404 ${url.pathname}`);
    return;
  }

  res.writeHead(200, { 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
  console.log(`200 ${url.pathname}`);
});

server.listen(port, () => {
  console.log(`renderer OTA feed: http://127.0.0.1:${port}/renderer/ -> ${root}`);
});
