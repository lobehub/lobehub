import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';

import { auth } from '@/auth';

import { createOpenRouterInternalApp } from './openrouterInternal';
import { createControlPlaneTrpcApp } from './platformTrpc';

const app = new Hono();

const resolveExistingDir = (...candidates: string[]) =>
  candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) || candidates[0];

// dist/index.js → ../web/spa ; src/hono/index.ts (vite-node) → ../../web/spa
const spaRoot = resolveExistingDir(
  fileURLToPath(new URL('../web/spa', import.meta.url)),
  fileURLToPath(new URL('../../web/spa', import.meta.url)),
);

const legacyAdminHtmlPath = [
  fileURLToPath(new URL('../web/admin.html', import.meta.url)),
  fileURLToPath(new URL('../../web/admin.html', import.meta.url)),
].find((p) => existsSync(p))!;

const MIME_BY_EXT: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const safeSpaPath = (requestPath: string): string | null => {
  const decoded = decodeURIComponent(requestPath.split('?')[0] || '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '');
  const rootResolved = path.resolve(spaRoot);
  const full = path.resolve(rootResolved, relative);
  const rootPrefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
  if (full !== rootResolved && !full.startsWith(rootPrefix)) return null;
  return full;
};

const readSpaFile = (requestPath: string): { body: Buffer; contentType: string } | null => {
  const full = safeSpaPath(requestPath);
  if (!full || !existsSync(full) || !statSync(full).isFile()) return null;
  return {
    body: readFileSync(full),
    contentType: MIME_BY_EXT[path.extname(full).toLowerCase()] || 'application/octet-stream',
  };
};

const respondFile = (file: { body: Buffer; contentType: string }) =>
  new Response(file.body, {
    headers: {
      'Cache-Control': file.contentType.includes('text/html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
      'Content-Type': file.contentType,
    },
    status: 200,
  });

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: '@aico/control-plane',
  }),
);

app.route('/internal/openrouter/v1/keys', createOpenRouterInternalApp());
app.route('/trpc/lambda', createControlPlaneTrpcApp());

/**
 * Better Auth on this origin (not proxied to product) so session cookies match
 * the control-plane host/port and work over local HTTP.
 */
app.all('/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/admin', (c) => c.redirect('/'));

/** Built Vite SPA (preferred) or legacy redirect HTML. */
app.get('/', (c) => {
  const spaIndex = readSpaFile('/');
  if (spaIndex) return respondFile(spaIndex);

  try {
    return c.html(readFileSync(legacyAdminHtmlPath, 'utf8'));
  } catch {
    return c.text('Aico control plane — UI missing. Run: bun run build:spa:control-plane', 500);
  }
});

app.get('/*', (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (
    pathname.startsWith('/trpc') ||
    pathname.startsWith('/internal') ||
    pathname.startsWith('/api') ||
    pathname === '/health'
  ) {
    return c.notFound();
  }

  const file = readSpaFile(pathname);
  if (file) return respondFile(file);

  // SPA client-side routes
  if (!path.extname(pathname)) {
    const spaIndex = readSpaFile('/');
    if (spaIndex) return respondFile(spaIndex);
  }

  return c.notFound();
});

export default app;
