// @vitest-environment node
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock('node:dns', () => ({ promises: { lookup: mocks.lookup } }));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));
vi.mock('@/envs/file', () => ({
  fileEnv: { S3_ENDPOINT: 'http://minio.internal:9000', S3_PUBLIC_DOMAIN: undefined },
}));

const { fetchPublicUrl } = await import('./publicUrlFetch');

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

  it('trusts our own app origin even though it is ours to serve', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPublicUrl('https://app.example.com/f/file_1', 1000)).toBeTruthy();
    // Trusted origins skip resolution entirely.
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('trusts a private storage endpoint we configured ourselves', async () => {
    // Self-hosted deployments legitimately run object storage on the LAN, and
    // dev hands back a localhost storage URL.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));

    expect(await fetchPublicUrl('http://minio.internal:9000/bucket/k', 1000)).toBeTruthy();
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
