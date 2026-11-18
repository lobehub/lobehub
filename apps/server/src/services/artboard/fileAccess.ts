import { createHmac, timingSafeEqual } from 'node:crypto';

import { artboardFileContentType, normalizeArtboardFilePath } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { artboards } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { type ArtboardBlobStore, artboardFileKey } from './files';

const DOMAIN = 'lobehub:artboard-file:v1';

const TOKEN_WINDOW_MS = 6 * 60 * 60 * 1000;

// `sandbox` makes the page an opaque origin even when the URL is opened in a tab of its own,
// so board HTML can never read the app's cookies or storage on this origin.
export const ARTBOARD_FILE_CSP = [
  'sandbox allow-scripts allow-popups allow-forms',
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
].join('; ');

const secret = () => process.env.KEY_VAULTS_SECRET?.trim() || undefined;

const sign = (key: string, payload: string) =>
  createHmac('sha256', key).update(`${DOMAIN}:${payload}`).digest('base64url');

export const signArtboardFileToken = (artboardId: string, now = Date.now()) => {
  const key = secret();
  if (!key) return;
  const payload = Buffer.from(
    JSON.stringify({ a: artboardId, e: (Math.floor(now / TOKEN_WINDOW_MS) + 2) * TOKEN_WINDOW_MS }),
  ).toString('base64url');
  return `${payload}.${sign(key, payload)}`;
};

export const verifyArtboardFileToken = (token: string, now = Date.now()) => {
  const key = secret();
  const [payload, signature] = token.split('.');
  if (!key || !payload || !signature) return;
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof a === 'string' && typeof e === 'number' && e > now ? a : undefined;
  } catch {
    return;
  }
};

export const artboardFileBasePath = (artboardId: string) => {
  const token = signArtboardFileToken(artboardId);
  return token ? `/artboard-files/${token}/` : undefined;
};

const baseHeaders = {
  'Content-Security-Policy': ARTBOARD_FILE_CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const notFound = () => new Response('Not found', { headers: baseHeaders, status: 404 });

interface ServeArtboardFileParams {
  db: LobeChatDatabase;
  path: string;
  storeFor: (owner: { userId: string; workspaceId: string | null }) => ArtboardBlobStore;
  token: string;
}

export const serveArtboardFile = async ({
  db,
  path,
  storeFor,
  token,
}: ServeArtboardFileParams): Promise<Response> => {
  const artboardId = verifyArtboardFileToken(token);
  const normalized = normalizeArtboardFilePath(path);
  if (!artboardId || !normalized) return notFound();

  // The token is the capability; the owner only picks whose storage holds the folder.
  const [owner] = await db
    .select({ userId: artboards.userId, workspaceId: artboards.workspaceId })
    .from(artboards)
    .where(eq(artboards.id, artboardId))
    .limit(1);
  if (!owner) return notFound();

  const bytes = await storeFor(owner)
    .read(artboardFileKey(artboardId, normalized))
    .catch(() => undefined);
  if (!bytes) return notFound();

  // The board URL carries ?v=<ETag>, so a changed file is a new URL; this one must not be reused.
  const headers = {
    ...baseHeaders,
    'Cache-Control': 'private, no-cache',
    'Content-Type': artboardFileContentType(normalized)!,
  };
  // Object-store reads are backed by a plain ArrayBuffer, never a SharedArrayBuffer.
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers, status: 200 });
};
