import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'release/core-ota');
const port = Number(process.argv[3] ?? 8787);

const contentType = (pathname) => {
  if (pathname.endsWith('.pack')) return 'application/octet-stream';
  if (pathname.endsWith('.zip')) return 'application/zip';
  if (pathname.endsWith('.zst')) return 'application/zstd';
  return 'application/json';
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, `.${url.pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    console.log(`404 ${url.pathname}`);
    return;
  }
  const immutable = url.pathname.startsWith('/cas/') || url.pathname.includes('/packs/');
  const size = statSync(file).size;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return;
    }
    start = Number(match[1]);
    end = Number(match[2]);
    status = 206;
  }
  res.writeHead(status, {
    'accept-ranges': 'bytes',
    'cache-control': immutable ? 'public,max-age=31536000,immutable' : 'no-store',
    'content-length': end - start + 1,
    'content-type': contentType(url.pathname),
    ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
  });
  createReadStream(file, { start, end }).pipe(res);
  console.log(`${status} ${url.pathname} bytes=${start}-${end}/${size}`);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`core OTA feed: http://127.0.0.1:${port}/ -> ${root}`);
});
