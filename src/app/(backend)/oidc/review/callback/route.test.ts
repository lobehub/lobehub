// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findAuthorizationCodeResource = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/oidc', () => ({
  OIDCService: { initialize: async () => ({ findAuthorizationCodeResource }) },
}));

const SITE = 'urn:lobehub:site:psite_7f3k9q2mAbCd:https%3A%2F%2Ffieldnotes.app';

const URL_BASE = 'http://localhost:3010/oidc/review/callback';

const call = async (query: string) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`${URL_BASE}?${query}`));
};

/** Runs the page's inline script as the popup would, and returns what it posted to the opener. */
const runPage = (html: string, query: string) => {
  const open = '<script>';
  const start = html.indexOf(open);
  const script = start < 0 ? '' : html.slice(start + open.length, html.lastIndexOf('</script>'));
  const postMessage = vi.fn();
  const window = { close: vi.fn(), opener: { postMessage } };
  new Function('window', 'location', script)(window, new URL(`${URL_BASE}?${query}`));
  return postMessage.mock.calls;
};

describe('GET /oidc/review/callback', () => {
  beforeEach(() => {
    findAuthorizationCodeResource.mockReset();
  });

  it('posts the code only to the origin bound into the authorization code', async () => {
    findAuthorizationCodeResource.mockResolvedValue(SITE);
    const query = 'code=abc123&state=st%3C%2Fscript%3E';
    const response = await call(query);
    const html = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(findAuthorizationCodeResource).toHaveBeenCalledWith('abc123');
    expect(runPage(html, query)).toEqual([
      [
        { code: 'abc123', state: 'st</script>', type: 'lobehub-review:authorized' },
        'https://fieldnotes.app',
      ],
    ]);
  });

  it('never reflects query values into the page', async () => {
    findAuthorizationCodeResource.mockResolvedValue(SITE);
    const authorized = await (await call('code=abc123&state=%22%29%3Balert%281%29%2F%2F')).text();
    expect(authorized).not.toContain('abc123');
    expect(authorized).not.toContain('alert');

    const denied = await (await call('error=%3Cimg%20src%3Dx%3E&state=%22%2Balert%281%29')).text();
    expect(denied).not.toContain('<img');
    expect(denied).not.toContain('alert');
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
    const deny = async (query: string) => runPage(await (await call(query)).text(), query);

    expect(await deny('error=access_denied&state=s1')).toEqual([
      [{ error: 'access_denied', state: 's1', type: 'lobehub-review:denied' }, '*'],
    ]);
    expect((await deny('error=invalid_target&state=s2'))[0][0]).toMatchObject({
      error: 'invalid_target',
    });
    expect((await deny('error=%3Cscript%3E&state=s3'))[0][0]).toMatchObject({
      error: 'error',
      state: 's3',
    });
  });
});
