/**
 * @vitest-environment node
 */
import type { Readable } from 'node:stream';

import type { NextRequest } from 'next/server';
import type { SelectiveBodyContext } from 'oidc-provider/lib/shared/selective_body.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

const readStream = async (stream: Readable) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString();
};

describe('OIDC HTTP adapter', () => {
  describe('createNodeRequest', () => {
    it('passes POST bodies through as a readable Node stream without pre-parsing', async () => {
      const body = 'grant_type=authorization_code&code=test-code';
      const request = new Request('https://example.com/oidc/token?client_id=test', {
        body,
        headers: {
          'content-length': String(Buffer.byteLength(body)),
          'content-type': 'application/x-www-form-urlencoded',
          'x-forwarded-for': '203.0.113.10',
        },
        method: 'POST',
      }) as unknown as NextRequest;

      const { createNodeRequest } = await import('./http-adapter');
      const nodeRequest = await createNodeRequest(request);

      expect(nodeRequest).toMatchObject({
        method: 'POST',
        url: '/oidc/token?client_id=test',
      });
      expect(nodeRequest.socket.remoteAddress).toBe('203.0.113.10');
      expect(nodeRequest.readable).toBe(true);
      expect('body' in nodeRequest).toBe(false);
      await expect(readStream(nodeRequest as unknown as Readable)).resolves.toBe(body);
    });

    it('keeps token endpoint form parameters parseable by oidc-provider', async () => {
      const body = new URLSearchParams({
        client_id: 'lobehub-desktop',
        code: 'test-code',
        code_verifier: 'test-verifier',
        grant_type: 'authorization_code',
        redirect_uri: 'https://example.com/oidc/callback/desktop',
      }).toString();
      const request = new Request('https://example.com/oidc/token', {
        body,
        headers: {
          'content-length': String(Buffer.byteLength(body)),
          'content-type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
      }) as unknown as NextRequest;

      const { createNodeRequest } = await import('./http-adapter');
      const { urlencoded } = await import('oidc-provider/lib/shared/selective_body.js');
      const nodeRequest = await createNodeRequest(request);
      const ctx: SelectiveBodyContext = {
        charset: 'utf-8',
        is: (contentType: string) => contentType === 'application/x-www-form-urlencoded',
        oidc: {},
        req: nodeRequest,
        request: { length: Buffer.byteLength(body) },
      };

      await urlencoded(ctx, async () => {});

      expect(ctx.oidc.body).toMatchObject({
        client_id: 'lobehub-desktop',
        code: 'test-code',
        code_verifier: 'test-verifier',
        grant_type: 'authorization_code',
        redirect_uri: 'https://example.com/oidc/callback/desktop',
      });
    });

    it('does not consume an explicitly empty request body', async () => {
      const arrayBuffer = vi.fn();
      const request = {
        arrayBuffer,
        body: new ReadableStream(),
        headers: new Headers({ 'content-length': '0' }),
        method: 'POST',
        url: 'https://example.com/oidc/token',
      } as unknown as NextRequest;

      const { createNodeRequest } = await import('./http-adapter');
      const nodeRequest = await createNodeRequest(request);

      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(nodeRequest.readable).toBe(true);
      await expect(readStream(nodeRequest as unknown as Readable)).resolves.toBe('');
    });
  });
});
