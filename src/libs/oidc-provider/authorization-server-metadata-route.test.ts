// The route lives under `.well-known`, a dot directory vitest excludes, so its test sits here.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const oidcHandler = vi.hoisted(() => vi.fn());

vi.mock('@/app/(backend)/oidc/[...oidc]/route', () => ({ GET: oidcHandler }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.lobehub.com' } }));

const { GET: getAuthorizationServerMetadata } =
  await import('@/app/(backend)/.well-known/oauth-authorization-server/oidc/route');

const DISCOVERY = {
  authorization_endpoint: 'https://app.lobehub.com/oidc/auth',
  issuer: 'https://app.lobehub.com/oidc',
  token_endpoint: 'https://app.lobehub.com/oidc/token',
};

beforeEach(() => oidcHandler.mockReset());

describe('GET /.well-known/oauth-authorization-server/oidc', () => {
  it("serves the provider's own discovery document for the issuer", async () => {
    oidcHandler.mockResolvedValue(Response.json(DISCOVERY));

    const res = await getAuthorizationServerMetadata(
      new NextRequest('https://app.lobehub.com/.well-known/oauth-authorization-server/oidc'),
    );

    expect(await res.json()).toEqual(DISCOVERY);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const forwarded = oidcHandler.mock.calls[0]![0] as NextRequest;
    expect(forwarded.url).toBe('https://app.lobehub.com/oidc/.well-known/openid-configuration');
  });

  it('answers 404 like the provider when OIDC is disabled', async () => {
    oidcHandler.mockResolvedValue(new Response('OIDC is not enabled', { status: 404 }));

    const res = await getAuthorizationServerMetadata(
      new NextRequest('https://app.lobehub.com/.well-known/oauth-authorization-server/oidc'),
    );

    expect(res.status).toBe(404);
  });
});
