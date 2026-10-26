/**
 * @vitest-environment node
 */
import type { Readable } from 'node:stream';

import { cookies, headers } from 'next/headers';
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
  headers: vi.fn(),
}));

const readStream = async (stream: Readable) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString();
};

describe('OIDC HTTP adapter', () => {
  describe('createContextForInteractionDetails', () => {
    it.each([
      ['Chinese', '用户的名字', '%E7%94%A8%E6%88%B7%E7%9A%84%E5%90%8D%E5%AD%97'],
      ['emoji', '😀', '%F0%9F%98%80'],
      ['encoded delimiters', 'value; injected=true', 'value%3B%20injected%3Dtrue'],
      ['percent encoding', '%E4%BD%A0', '%25E4%25BD%25A0'],
    ])('preserves the raw cookie header containing %s', async (_, decoded, encoded) => {
      const rawCookie = `display_name=${encoded}; _interaction=test-id; _interaction.sig=test-signature`;
      vi.mocked(headers).mockResolvedValue(new Headers({ cookie: rawCookie }));
      vi.mocked(cookies).mockResolvedValue({
        getAll: () => [
          { name: 'display_name', value: decoded },
          { name: '_interaction', value: 'test-id' },
          { name: '_interaction.sig', value: 'test-signature' },
        ],
      } as Awaited<ReturnType<typeof cookies>>);

      const { createContextForInteractionDetails } = await import('./http-adapter');
      const { req } = await createContextForInteractionDetails('test-id');

      expect(req.headers.cookie).toBe(rawCookie);
    });

    it('does not synthesize a cookie header when the request has none', async () => {
      vi.mocked(headers).mockResolvedValue(new Headers());
      vi.mocked(cookies).mockResolvedValue({
        getAll: () => [],
      } as Awaited<ReturnType<typeof cookies>>);

      const { createContextForInteractionDetails } = await import('./http-adapter');
      const { req } = await createContextForInteractionDetails('test-id');

      expect(req.headers.cookie).toBeUndefined();
    });
  });

  describe('createNodeResponse', () => {
    it('captures statusCode assignments made by Koa', async () => {
      const resolvePromise = vi.fn();
      const { createNodeResponse } = await import('./http-adapter');
      const responseCollector = createNodeResponse(resolvePromise);

      responseCollector.nodeResponse.statusCode = 500;
      responseCollector.nodeResponse.end('Internal Server Error');

      expect(responseCollector.responseStatus).toBe(500);
      expect(responseCollector.responseBody).toBe('Internal Server Error');
      expect(resolvePromise).toHaveBeenCalledOnce();
    });
  });

  describe('createNodeRequest', () => {
    it('hands discovery to the provider route it hardcodes', async () => {
      const request = new Request(
        'https://example.com/oidc/.well-known/openid-configuration',
      ) as unknown as NextRequest;

      const { createNodeRequest } = await import('./http-adapter');
      const nodeRequest = await createNodeRequest(request);

      expect(nodeRequest.url).toBe('/.well-known/openid-configuration');
    });

    it('leaves the prefixed routes untouched', async () => {
      const { createNodeRequest } = await import('./http-adapter');

      for (const path of ['/oidc/jwks', '/oidc/me', '/oidc/auth', '/oidc/token']) {
        const request = new Request(`https://example.com${path}`) as unknown as NextRequest;
        const nodeRequest = await createNodeRequest(request);

        expect(nodeRequest.url).toBe(path);
      }
    });

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
        /** oidc-provider only parses URL-encoded bodies for POST requests. */
        method: nodeRequest.method,
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
