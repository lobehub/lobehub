// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findAuthorizationCodeResource = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/oidc', () => ({
  OIDCService: { initialize: async () => ({ findAuthorizationCodeResource }) },
}));

const SITE = 'urn:lobehub:site:psite_7f3k9q2mAbCd:https%3A%2F%2Ffieldnotes.app';

const call = async (query: string) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost:3010/oidc/review/callback?${query}`));
};

describe('GET /oidc/review/callback', () => {
  beforeEach(() => {
    findAuthorizationCodeResource.mockReset();
  });

  it('posts the code only to the origin bound into the authorization code', async () => {
    findAuthorizationCodeResource.mockResolvedValue(SITE);
    const response = await call('code=abc123&state=st%3C%2Fscript%3E');
    const html = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('"https://fieldnotes.app"');
    expect(html).toContain('"abc123"');
    expect(html).not.toContain('</script>"');
    expect(html).toContain('st\\u003c/script\\u003e');
    expect(findAuthorizationCodeResource).toHaveBeenCalledWith('abc123');
  });

  it('posts nothing when the code is not a site review code', async () => {
    findAuthorizationCodeResource.mockResolvedValue('urn:lobehub:acceptance:abc');
    const html = await (await call('code=abc123&state=s')).text();
    expect(html).not.toContain('postMessage');
  });

  it('posts nothing for an unknown code', async () => {
    findAuthorizationCodeResource.mockResolvedValue(undefined);
    expect(await (await call('code=nope&state=s')).text()).not.toContain('postMessage');
  });

  it('tells the opener why a sign-in was refused, without anything secret', async () => {
    const denied = await (await call('error=access_denied&state=s1')).text();
    expect(denied).toContain('"lobehub-review:denied"');
    expect(denied).toContain('"access_denied"');
    expect(denied).toContain('"s1"');
    expect(denied).toContain(',"*")');

    const unregistered = await (await call('error=invalid_target&state=s2')).text();
    expect(unregistered).toContain('"invalid_target"');

    const other = await (await call('error=%3Cscript%3E&state=s3')).text();
    expect(other).toContain('"error":"error"');
    expect(other).not.toContain('<script>"');
  });
});
