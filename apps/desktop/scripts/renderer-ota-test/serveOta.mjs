import { closeSync, createReadStream, existsSync, openSync, readSync, statSync } from 'node:fs';
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

  const fd = openSync(file, 'r');
  const head = Buffer.alloc(2);
  const n = readSync(fd, head, 0, 2, 0);
  closeSync(fd);
  const gzip = n >= 2 && head[0] === 0x1f && head[1] === 0x8b;
  res.writeHead(200, {
    'cache-control': 'no-store',
    ...(gzip ? { 'content-encoding': 'gzip' } : {}),
  });
  createReadStream(file).pipe(res);
  console.log(`200 ${url.pathname}`);
});

server.listen(port, () => {
  console.log(`renderer OTA feed: http://127.0.0.1:${port}/ -> ${root}`);
});
