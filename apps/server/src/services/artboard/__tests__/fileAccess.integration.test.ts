// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { artboards, users } from '@/database/schemas';

import {
  ARTBOARD_FILE_CSP,
  serveArtboardFile,
  signArtboardFileToken,
  verifyArtboardFileToken,
} from '../fileAccess';
import { type ArtboardBlobStore, ArtboardFileService } from '../files';

const userId = 'artboard-file-access-user';
const artboardId = 'art_file_access';
const otherArtboardId = 'art_file_access_other';
const now = new Date('2026-11-18T00:00:00Z').getTime();

const db: LobeChatDatabase = await getTestDB();

const blobs = new Map<string, Uint8Array>();
const store: ArtboardBlobStore = {
  delete: async () => {},
  list: async () => [],
  presignWrite: async (key) => ({ url: `memory://${key}` }),
  read: async (key) => {
    const bytes = blobs.get(key);
    if (!bytes) throw new Error('missing');
    return bytes;
  },
  write: async (key, bytes) => {
    blobs.set(key, bytes);
  },
};

const html = '<!doctype html><link rel="stylesheet" href="../a.css"><h1 style="color:#f50">Hi</h1>';

const serve = (token: string, path: string) =>
  serveArtboardFile({ db, path, storeFor: () => store, token });

beforeEach(async () => {
  vi.stubEnv('KEY_VAULTS_SECRET', 'test-secret');
  blobs.clear();
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(artboards).values([
    { id: artboardId, title: 'A', userId },
    { id: otherArtboardId, title: 'B', userId },
  ]);
  await new ArtboardFileService({
    resolveImage: async () => undefined,
    resolveImport: async () => undefined,
    store,
  }).applyChanges(artboardId, {
    writes: [
      { content: html, path: 'pages/home.html' },
      { content: 'h1{font-size:40px}', path: 'a.css' },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('artboard file tokens', () => {
  it('round-trips the artboard id until it expires', () => {
    const token = signArtboardFileToken(artboardId, now)!;

    expect(verifyArtboardFileToken(token, now + 60_000)).toBe(artboardId);
    expect(verifyArtboardFileToken(token, now + 13 * 60 * 60 * 1000)).toBeUndefined();
  });

  it('issues the same token within one window so viewers keep their frames', () => {
    expect(signArtboardFileToken(artboardId, now + 1000)).toBe(
      signArtboardFileToken(artboardId, now + 60 * 60 * 1000),
    );
  });

  it('rejects a token whose payload was changed', () => {
    const token = signArtboardFileToken(artboardId, now)!;
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ a: otherArtboardId, e: now + 1e9 })).toString('base64url')}.${signature}`;

    expect(verifyArtboardFileToken(forged, now)).toBeUndefined();
  });

  it('issues nothing without a server secret', () => {
    vi.stubEnv('KEY_VAULTS_SECRET', '');
    expect(signArtboardFileToken(artboardId, now)).toBeUndefined();
  });
});

describe('serveArtboardFile', () => {
  it('serves the file bytes under a sandboxing CSP', async () => {
    const token = signArtboardFileToken(artboardId, Date.now())!;

    const response = await serve(token, 'pages/home.html');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(ARTBOARD_FILE_CSP);
    expect(ARTBOARD_FILE_CSP).toMatch(/^sandbox allow-scripts/);
    expect(ARTBOARD_FILE_CSP).toContain("connect-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('answers 404 under the sandbox CSP for a path nothing was written to', async () => {
    const token = signArtboardFileToken(artboardId, Date.now())!;

    const response = await serve(token, 'pages/not-yet.html');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toBe(ARTBOARD_FILE_CSP);
  });

  it('does not serve another artboard with a token for this one', async () => {
    const token = signArtboardFileToken(otherArtboardId, Date.now())!;

    const response = await serve(token, 'pages/home.html');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toBe(ARTBOARD_FILE_CSP);
  });

  it('refuses a bad token and a path that leaves the artboard', async () => {
    expect((await serve('nope', 'pages/home.html')).status).toBe(404);
    const token = signArtboardFileToken(artboardId, Date.now())!;
    expect((await serve(token, '../a.css')).status).toBe(404);
  });
});
