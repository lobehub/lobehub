// @vitest-environment node
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock('node:dns', () => ({ promises: { lookup: mocks.lookup } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/envs/file', () => ({
  fileEnv: { S3_ENDPOINT: 'http://minio.internal:9000', S3_PUBLIC_DOMAIN: undefined },
}));

const { fetchPublicUrl, redactUrlForLog } = await import('./publicUrlFetch');

const ok = () => ({ headers: new Headers(), ok: true, status: 200 }) as any;

describe('fetchPublicUrl', () => {
  beforeEach(() => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fetches a public host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

    expect(result?.response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    await result!.dispose();
  });

  it.each([
    ['loopback', 'http://127.0.0.1/admin'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['RFC1918', 'http://10.1.2.3/internal'],
    ['RFC1918 (192.168)', 'http://192.168.0.1/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv6 unique-local', 'http://[fd00::1]/'],
    // `new URL()` canonicalizes these to ::ffff:a00:1 / ::ffff:a9fe:a9fe, so a
    // regex looking for a dotted quad never sees them.
    ['IPv4-mapped RFC1918', 'http://[::ffff:10.0.0.1]/'],
    ['IPv4-mapped metadata', 'http://[::ffff:169.254.169.254]/'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    ['already-canonical IPv4-mapped', 'http://[::ffff:a00:1]/'],
    ['IPv4-compatible loopback', 'http://[::127.0.0.1]/'],
  ])('refuses a literal %s address', async (_label, url) => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl(url, 1000)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a public hostname that resolves to a private address', async () => {
    // The classic DNS-based bypass: the name looks fine, the answer does not.
    mocks.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl('https://evil.example.com/x', 1000)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when any resolved address is private', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));

    expect(await fetchPublicUrl('https://evil.example.com/x', 1000)).toBeUndefined();
  });

  it.each([
    ['a non-HTTP protocol', 'file:///etc/passwd'],
    ['embedded credentials', 'https://user:pw@cdn.example.com/a.png'],
  ])('refuses %s', async (_label, url) => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl(url, 1000)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('trusts our own app origin only when the URL is server-generated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPublicUrl('https://app.example.com/f/file_1', 1000, {
      allowConfiguredOrigins: true,
    });

    expect(result).toBeTruthy();
    // Trusted origins skip resolution entirely.
    expect(mocks.lookup).not.toHaveBeenCalled();
    await result!.dispose();
  });

  it('trusts a private storage endpoint we configured ourselves, when opted in', async () => {
    // Self-hosted deployments legitimately run object storage on the LAN, and
    // dev hands back a localhost storage URL.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));

    const result = await fetchPublicUrl('http://minio.internal:9000/bucket/k', 1000, {
      allowConfiguredOrigins: true,
    });

    expect(result).toBeTruthy();
    await result!.dispose();
  });

  it('does NOT trust a configured private origin for a caller-supplied URL', async () => {
    // Regression: a configured origin is not proof of ownership. Without
    // provenance, any caller could name our internal storage host and walk
    // straight past the private-address guard.
    mocks.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl('http://minio.internal:9000/bucket/k', 1000)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still resolves our own app origin normally without the opt-in', async () => {
    // A public APP_URL keeps working for caller URLs — it just goes through the
    // same DNS check as anything else rather than skipping it.
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPublicUrl('https://app.example.com/f/file_1', 1000);

    expect(result).toBeTruthy();
    expect(mocks.lookup).toHaveBeenCalled();
    await result!.dispose();
  });

  it('trusts the virtual-hosted bucket subdomain of our own storage endpoint', async () => {
    // Regression: S3 (and every S3-compatible service) defaults to
    // virtual-hosted addressing, so our own presigned URL lives on
    // `<bucket>.<endpoint>` and never equals the endpoint origin. Falling
    // through to the private-address check made every attachment silently
    // degrade to a download link.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));

    const result = await fetchPublicUrl('http://my-bucket.minio.internal:9000/k', 1000, {
      allowConfiguredOrigins: true,
    });

    expect(result).toBeTruthy();
    expect(mocks.lookup).not.toHaveBeenCalled();
    await result!.dispose();
  });

  it.each([
    ['a look-alike sibling host', 'http://evil-minio.internal:9000/k'],
    ['a different port on the same host', 'http://bucket.minio.internal:9001/k'],
    ['a different scheme', 'https://bucket.minio.internal:9000/k'],
  ])('does not extend that trust to %s', async (_label, url) => {
    // The suffix match is anchored on a `.` boundary and still pins scheme and
    // port, so it trusts strictly more of OUR endpoint and nothing else. Asserted
    // WITH the opt-in, which is the stronger claim.
    mocks.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl(url, 1000, { allowConfiguredOrigins: true })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pins the request to the vetted address so a rebinding answer cannot be used', async () => {
    // Validating a hostname and then letting undici resolve it again is the
    // rebinding hole: the name answers publicly for our lookup and privately
    // for the connection.
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
    await result!.dispose();
  });

  it('keeps pinning when a proxy env var is set but nothing is actually proxied', async () => {
    // Regression: the decision used to read HTTPS_PROXY directly. The global
    // proxy dispatcher is only installed under NODE_ENV=development, so in
    // production a stray env var proxies nothing — and skipping the pin on that
    // basis handed the hostname back to undici, reopening the rebinding hole.
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.internal:3128');
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
    await result!.dispose();
    vi.unstubAllEnvs();
  });

  it('does not pin when a proxy dispatcher is actually installed', async () => {
    // The proxy resolves DNS itself, so pinning a locally resolved address
    // would bypass it and the egress policy it enforces, and mean nothing.
    const previous = getGlobalDispatcher();
    const proxy = new EnvHttpProxyAgent({ httpsProxy: 'http://proxy.internal:3128' });
    setGlobalDispatcher(proxy);
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

      expect(fetchMock.mock.calls[0][1].dispatcher).toBeUndefined();
      await result!.dispose();
    } finally {
      setGlobalDispatcher(previous);
      await proxy.close();
    }
  });

  it('hands back a dispose hook so the pinned pool is released', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));

    const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

    expect(result?.dispose).toBeTypeOf('function');
    await expect(result!.dispose()).resolves.toBeUndefined();
  });

  it('still pins a destination NO_PROXY tells the proxy to bypass', async () => {
    // Regression: the check was class-level, so an installed proxy marked every
    // request proxied — but a NO_PROXY destination is dispatched DIRECTLY, and
    // that is precisely where the pin is still needed.
    const previous = getGlobalDispatcher();
    const proxy = new EnvHttpProxyAgent({ httpsProxy: 'http://proxy.internal:3128' });
    setGlobalDispatcher(proxy);
    vi.stubEnv('NO_PROXY', 'cdn.example.com');
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

      expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
      await result!.dispose();
    } finally {
      vi.unstubAllEnvs();
      setGlobalDispatcher(previous);
      await proxy.close();
    }
  });

  it('still pins when NO_PROXY is a wildcard', async () => {
    const previous = getGlobalDispatcher();
    const proxy = new EnvHttpProxyAgent({ httpsProxy: 'http://proxy.internal:3128' });
    setGlobalDispatcher(proxy);
    vi.stubEnv('NO_PROXY', '*');
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

      expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
      await result!.dispose();
    } finally {
      vi.unstubAllEnvs();
      setGlobalDispatcher(previous);
      await proxy.close();
    }
  });

  it('still pins when NO_PROXY uses a wildcard suffix', async () => {
    // Regression: `*.example.com` kept its `*` through normalization, so the
    // bypass went unrecognized and the direct request lost its pin.
    const previous = getGlobalDispatcher();
    const proxy = new EnvHttpProxyAgent({ httpsProxy: 'http://proxy.internal:3128' });
    setGlobalDispatcher(proxy);
    vi.stubEnv('NO_PROXY', '*.example.com');
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

      expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
      await result!.dispose();
    } finally {
      vi.unstubAllEnvs();
      setGlobalDispatcher(previous);
      await proxy.close();
    }
  });

  it('does not pin a host the proxy actually handles', async () => {
    const previous = getGlobalDispatcher();
    const proxy = new EnvHttpProxyAgent({ httpsProxy: 'http://proxy.internal:3128' });
    setGlobalDispatcher(proxy);
    vi.stubEnv('NO_PROXY', 'other.example.com');
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await fetchPublicUrl('https://cdn.example.com/a.png', 1000);

      expect(fetchMock.mock.calls[0][1].dispatcher).toBeUndefined();
      await result!.dispose();
    } finally {
      vi.unstubAllEnvs();
      setGlobalDispatcher(previous);
      await proxy.close();
    }
  });

  it('re-validates every redirect hop', async () => {
    // Regression: our file proxy answers /f/:id with a 302, so redirects must be
    // followed — which means a public host could bounce us to the metadata IP.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        body: null,
        headers: new Headers({ location: 'http://169.254.169.254/latest/' }),
        status: 302,
      } as any)
      .mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl('https://cdn.example.com/a.png', 1000)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect that stays public', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        body: null,
        headers: new Headers({ location: 'https://cdn.example.com/real.png' }),
        status: 302,
      } as any)
      .mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl('https://cdn.example.com/a.png', 1000)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up on a redirect loop', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      body: null,
      headers: new Headers({ location: 'https://cdn.example.com/loop' }),
      status: 302,
    } as any);
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl('https://cdn.example.com/loop', 1000)).toBeUndefined();
  });
});

describe('redactUrlForLog', () => {
  // Every log line in this chain goes through here. A presigned storage URL
  // carries `X-Amz-Credential` / `X-Amz-Signature` in its query string, logs
  // outlive the signature, and this module's loader is reachable from
  // `botMessage`, whose schema takes a caller-supplied URL.
  it('drops the query string but keeps the object identity', () => {
    expect(
      redactUrlForLog(
        'https://bucket.example.com/asset/1/photo.png?X-Amz-Credential=AKIAEXAMPLE&X-Amz-Signature=deadbeefcafe',
      ),
    ).toBe('https://bucket.example.com/asset/1/photo.png');
  });

  it('drops credentials embedded in the authority', () => {
    expect(redactUrlForLog('https://user:secret@example.com/a/b')).toBe('https://example.com/a/b');
  });

  it('drops the fragment as well', () => {
    expect(redactUrlForLog('https://example.com/a#token=abc')).toBe('https://example.com/a');
  });

  it('never echoes a value it cannot parse', () => {
    expect(redactUrlForLog('not a url?secret=abc')).toBe('(unparseable url)');
  });

  it('accepts an already-parsed URL', () => {
    expect(redactUrlForLog(new URL('https://example.com/x?y=1'))).toBe('https://example.com/x');
  });
});
